"""Fayda Replica — external replica of Ethiopia's Fayda OIDC identity provider.

Lives OUTSIDE k8s (0_external/, like the source replicas): it models a
third-party national IdP the system integrates with, purely to assist the demo.

Implements just enough of OAuth 2.0 + OpenID Connect Core to back the public
dashboard's "Verify with Fayda" popup — the ONLY consumer. A non-registered
visitor verifies their national ID before submitting an access request; the
popup pre-fills the form and sets verified_via='fayda'. It is NOT a login
provider (there is no Keycloak Fayda realm / "sign in with Fayda"). The claim
shape matches what real Fayda issues; the auth flow shows a simple HTML form
with the synthetic citizens loaded from seed/citizens.yaml.

Endpoints implemented (Discovery exposes them):
    GET  /.well-known/openid-configuration
    GET  /jwks
    GET  /authorize    — login form + redirect with `code`
    POST /authorize    — handle form submit
    POST /token        — exchange code for tokens
    GET  /userinfo     — return claims for a bearer token

This is dev-only. Never deploy to production — swap to real Fayda by pointing
the public dashboard's FAYDA_* env vars at the production Fayda endpoints.
"""
from __future__ import annotations

import html as _html
import logging
import os
import secrets
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import yaml
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from jose import jwt

log = logging.getLogger("fayda-replica")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s | %(message)s")

ISSUER = os.environ.get("FAYDA_ISSUER", "http://localhost:8096")
CLIENT_ID = os.environ.get("FAYDA_CLIENT_ID", "nhdw-citizen-portal")
CLIENT_SECRET = os.environ.get("FAYDA_CLIENT_SECRET", "fake-fayda-secret")

SEED_DIR = Path(__file__).resolve().parent.parent / "seed"

# ─── Key material ──────────────────────────────────────────────────────────
# Generate a fresh RSA key per startup. For dev that's fine; in prod the
# real Fayda holds its own long-lived signing key.
_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_private_pem = _private_key.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.PKCS8,
    encryption_algorithm=serialization.NoEncryption(),
)
_public_numbers = _private_key.public_key().public_numbers()
KID = "fayda-replica-2026"


def _int_to_b64url(i: int) -> str:
    import base64
    n = (i.bit_length() + 7) // 8
    return base64.urlsafe_b64encode(i.to_bytes(n, "big")).rstrip(b"=").decode()


JWKS = {
    "keys": [
        {
            "kty": "RSA",
            "alg": "RS256",
            "use": "sig",
            "kid": KID,
            "n": _int_to_b64url(_public_numbers.n),
            "e": _int_to_b64url(_public_numbers.e),
        }
    ]
}


# ─── Citizen seed ──────────────────────────────────────────────────────────
def _load_citizens() -> dict[str, dict[str, Any]]:
    path = SEED_DIR / "citizens.yaml"
    if not path.exists():
        log.warning("citizens.yaml not found at %s — empty seed", path)
        return {}
    with path.open() as f:
        data = yaml.safe_load(f) or {}
    return {c["fayda_id"]: c for c in data.get("citizens", [])}


CITIZENS = _load_citizens()

# In-memory stores (dev only).
_AUTH_CODES: dict[str, dict[str, Any]] = {}
_ACCESS_TOKENS: dict[str, dict[str, Any]] = {}

app = FastAPI(title="Fayda Replica OIDC", description="Demo replica of Ethiopia's Fayda identity provider (external to NHDW).")


# ─── Discovery + JWKS ──────────────────────────────────────────────────────
@app.get("/.well-known/openid-configuration")
async def discovery() -> JSONResponse:
    return JSONResponse({
        "issuer": ISSUER,
        "authorization_endpoint": f"{ISSUER}/authorize",
        "token_endpoint": f"{ISSUER}/token",
        "userinfo_endpoint": f"{ISSUER}/userinfo",
        "jwks_uri": f"{ISSUER}/jwks",
        "response_types_supported": ["code"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["RS256"],
        "scopes_supported": ["openid", "profile"],
        "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post"],
        "claims_supported": [
            "sub", "iss", "aud", "exp", "iat",
            "fayda_id", "name", "given_name", "family_name",
            "gender", "birthdate", "phone_number",
        ],
    })


@app.get("/jwks")
async def jwks() -> JSONResponse:
    return JSONResponse(JWKS)


# ─── Authorize: login form + redirect ──────────────────────────────────────
@app.get("/authorize", response_class=HTMLResponse)
async def authorize_form(client_id: str, redirect_uri: str, state: str = "",
                         scope: str = "openid", response_type: str = "code") -> HTMLResponse:
    if response_type != "code":
        raise HTTPException(400, "only response_type=code supported")
    if client_id != CLIENT_ID:
        raise HTTPException(400, f"unknown client_id (expected {CLIENT_ID!r})")

    options = "\n".join(
        f'<option value="{fid}">{c["name"]} — FIN {fid}</option>'
        for fid, c in CITIZENS.items()
    )
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Fayda Replica — demo login</title>
<style>
  body {{ font-family: Inter, system-ui, sans-serif; max-width: 480px; margin: 4em auto; padding: 2em;
          background: #fafbfc; color: #222; }}
  .banner {{ background: #fff8c4; border-left: 4px solid #d4a72c; padding: 1em; border-radius: 6px;
             margin-bottom: 2em; font-size: 14px; }}
  h1 {{ font-size: 22px; margin-bottom: 0.2em; }}
  .sub {{ color: #666; margin-top: 0; }}
  label {{ display: block; font-size: 14px; margin-top: 1.5em; }}
  select, button {{ width: 100%; padding: 0.6em; margin-top: 0.4em; font-size: 14px;
                    border: 1px solid #ddd; border-radius: 4px; }}
  button {{ margin-top: 2em; background: #1D4ED8; color: white; border: none; cursor: pointer; }}
  button:hover {{ background: #1E40AF; }}
  code {{ background: #eee; padding: 1px 6px; border-radius: 3px; font-size: 13px; }}
</style>
</head>
<body>
  <div class="banner">
    <strong>⚠ Demo replica — Fayda.</strong> No real biometric flow; pick a
    citizen and click to issue a token. Production deploys swap this for
    Ethiopia&rsquo;s real Fayda OIDC.
  </div>
  <h1>Sign in with Fayda</h1>
  <p class="sub">Authenticating for client <code>{client_id}</code>.</p>
  <form method="post" action="/authorize">
    <input type="hidden" name="client_id" value="{_html.escape(client_id, quote=True)}">
    <input type="hidden" name="redirect_uri" value="{_html.escape(redirect_uri, quote=True)}">
    <input type="hidden" name="state" value="{_html.escape(state, quote=True)}">
    <input type="hidden" name="scope" value="{_html.escape(scope, quote=True)}">
    <label>Choose a citizen:
      <select name="fayda_id" required>
        {options}
      </select>
    </label>
    <button type="submit">Sign in</button>
  </form>
</body>
</html>"""
    return HTMLResponse(html)


@app.post("/authorize")
async def authorize_submit(
    client_id: str = Form(...),
    redirect_uri: str = Form(...),
    state: str = Form(""),
    scope: str = Form("openid"),
    fayda_id: str = Form(...),
) -> RedirectResponse:
    if fayda_id not in CITIZENS:
        raise HTTPException(400, f"unknown citizen FIN {fayda_id}")
    code = secrets.token_urlsafe(24)
    _AUTH_CODES[code] = {
        "fayda_id": fayda_id,
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": scope,
        "issued_at": time.time(),
    }
    params = {"code": code}
    if state:
        params["state"] = state
    url = f"{redirect_uri}?{urlencode(params)}"
    log.info("issued code for %s → %s", fayda_id, url)
    return RedirectResponse(url, status_code=302)


# ─── Token exchange ────────────────────────────────────────────────────────
@app.post("/token")
async def token(request: Request,
                grant_type: str = Form(...),
                code: str = Form(None),
                redirect_uri: str = Form(None),
                client_id: str = Form(None),
                client_secret: str = Form(None)) -> JSONResponse:
    if grant_type != "authorization_code":
        raise HTTPException(400, f"unsupported grant_type {grant_type!r}")

    # Allow client auth via either Basic header OR form body.
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("basic "):
        import base64
        decoded = base64.b64decode(auth_header.split(None, 1)[1]).decode()
        client_id, client_secret = decoded.split(":", 1)

    if client_id != CLIENT_ID or client_secret != CLIENT_SECRET:
        raise HTTPException(401, "invalid client credentials")

    entry = _AUTH_CODES.pop(code, None)
    if not entry:
        raise HTTPException(400, "invalid_grant")
    if redirect_uri != entry["redirect_uri"]:
        raise HTTPException(400, "redirect_uri mismatch")

    citizen = CITIZENS[entry["fayda_id"]]
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "sub": entry["fayda_id"],
        "aud": client_id,
        "exp": now + 900,
        "iat": now,
        "fayda_id": entry["fayda_id"],
        "name": citizen["name"],
        "given_name": citizen.get("given_name", ""),
        "family_name": citizen.get("family_name", ""),
        "gender": citizen.get("gender", ""),
        "birthdate": citizen.get("birthdate", ""),
        "phone_number": citizen.get("phone_number", ""),
    }
    id_token = jwt.encode(claims, _private_pem.decode(), algorithm="RS256",
                          headers={"kid": KID})
    access_token = secrets.token_urlsafe(32)
    _ACCESS_TOKENS[access_token] = {"sub": entry["fayda_id"], "exp": now + 900}

    return JSONResponse({
        "access_token": access_token,
        "id_token": id_token,
        "token_type": "Bearer",
        "expires_in": 900,
        "scope": entry["scope"],
    })


# ─── UserInfo ──────────────────────────────────────────────────────────────
@app.get("/userinfo")
async def userinfo(request: Request) -> JSONResponse:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(401, "missing bearer token")
    tok = auth.split(None, 1)[1]
    entry = _ACCESS_TOKENS.get(tok)
    if not entry or entry["exp"] < time.time():
        raise HTTPException(401, "invalid_token")
    c = CITIZENS[entry["sub"]]
    return JSONResponse({
        "sub": entry["sub"],
        "fayda_id": entry["sub"],
        "name": c["name"],
        "given_name": c.get("given_name", ""),
        "family_name": c.get("family_name", ""),
        "gender": c.get("gender", ""),
        "birthdate": c.get("birthdate", ""),
        "phone_number": c.get("phone_number", ""),
    })


@app.get("/")
async def index() -> JSONResponse:
    return JSONResponse({
        "service": "fayda-replica",
        "issuer": ISSUER,
        "citizens_loaded": len(CITIZENS),
        "note": "sandbox-only OIDC mock of Ethiopia's Fayda IdP",
    })
