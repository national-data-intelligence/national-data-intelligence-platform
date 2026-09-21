"""Palladium Demo Console — backend.

WHAT IT IS. One place to find every project Palladium demos, know whether it is
up, change what country it is showing, fire a scripted demo action, and see who
did what. It is a CONDUCTOR: it knows nothing project-specific, and reaches each
project over the same five-endpoint contract
(/demo/health, /demo/profile GET+POST, /demo/action/{id}, /demo/job/{id}).

A project that never implements those still works here as a resource folder.
That is deliberate — it is the difference between a console that launches now
and one that waits on every team.

WHY NO BUILD STEP. The UI is hand-written HTML, CSS and JS served from web/.
Nothing here needs a bundler, so the app deploys as a container with a Python
base image and is editable in place during a demo week.

AUTH. A password account the console owns, or Keycloak OIDC where it is
configured. There is deliberately NO development sign-in: a way in that skips
the password is a way in, whatever it is called, and a console that holds the
keys to a client demo estate should not have one.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import asyncpg
import httpx
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
log = logging.getLogger("console")

HERE = Path(__file__).resolve().parent
WEB = HERE.parent / "web"

DB_DSN = os.environ.get("CONSOLE_DB_DSN", "")
CONSOLE_ENV = os.environ.get("CONSOLE_ENV", "dev")
SESSION_COOKIE = "console_session"

# Projects are reached over their PUBLIC API, always — never an in-cluster
# service name, never a shared database. The console runs outside every project
# it controls and is meant to keep working when they move to other hosts, so the
# only coupling allowed is the five demo endpoints over HTTP.
#
# TLS verification is on by default and switched off only for hosts with a
# self-signed certificate (the nip.io demo boxes). Naming them explicitly beats
# a blanket verify=False: the exception stays visible and stays scoped.
VERIFY_TLS = os.environ.get("CONSOLE_VERIFY_TLS", "true").lower() not in ("0", "false", "no")
INSECURE_HOSTS = {h.strip().lower() for h in
                  os.environ.get("CONSOLE_INSECURE_HOSTS", "").split(",") if h.strip()}


def _verify_for(url: str) -> bool:
    """Whether to verify TLS when calling this project's agent."""
    if not VERIFY_TLS:
        return False
    try:
        from urllib.parse import urlparse
        host = (urlparse(url).hostname or "").lower()
    except Exception:                                           # noqa: BLE001
        return True
    return not any(host == h or host.endswith("." + h) for h in INSECURE_HOSTS)

# ── Keycloak ────────────────────────────────────────────────────────────────
KC_BASE = os.environ.get("KEYCLOAK_PUBLIC_BASE", "").rstrip("/")
KC_REALM = os.environ.get("KEYCLOAK_REALM", "moh-staff")
KC_CLIENT = os.environ.get("KEYCLOAK_CLIENT_ID", "demo-console")
KC_SECRET = os.environ.get("KEYCLOAK_CLIENT_SECRET", "")
PUBLIC_URL = os.environ.get("CONSOLE_PUBLIC_URL", "http://localhost:8080").rstrip("/")

# Anyone may create an account; an account with no grant sees no projects at
# all, so registration hands out nothing. Set false to make the console
# invite-only, where an admin creates the account and issues a reset link.
OPEN_SIGNUP = os.environ.get("CONSOLE_OPEN_SIGNUP", "true").lower() not in ("0", "false", "no")

# Mail relay for reset links. DELIBERATELY UNSET by default: a console that
# starts sending real email the moment it boots is a bad surprise, and the
# honest alternative — tell the person an admin has to hand them the link — is
# available without it.
SMTP_HOST = os.environ.get("CONSOLE_SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("CONSOLE_SMTP_PORT", "587"))
SMTP_USER = os.environ.get("CONSOLE_SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("CONSOLE_SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("CONSOLE_SMTP_FROM", SMTP_USER)
RESET_TTL_MIN = int(os.environ.get("CONSOLE_RESET_TTL_MIN", "60"))

# ── uploaded material ───────────────────────────────────────────────────────
# Bytes live on a volume, not in the database: a demo deck is tens of megabytes
# and a row that size turns every backup and every query plan into a problem.
# The row keeps the key, so a resource stays versioned and access-controlled
# like anything else here.
DATA_DIR = Path(os.environ.get("CONSOLE_DATA_DIR", "/srv/data"))
MAX_UPLOAD_MB = int(os.environ.get("CONSOLE_MAX_UPLOAD_MB", "200"))

# What a browser can show in place, and what it can only hand over. A type not
# on this list is downloaded rather than guessed at.
INLINE_TYPES = {
    "application/pdf", "text/plain", "text/markdown", "text/csv",
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
    "video/mp4", "video/webm", "video/ogg",
    "audio/mpeg", "audio/ogg", "audio/wav",
}
# Office formats no browser renders. With LibreOffice in the image they get a
# PDF rendition on upload and become previewable; without it they stay
# download-only and the interface says so rather than showing a broken frame.
CONVERTIBLE = {
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/vnd.oasis.opendocument.presentation",
    "application/vnd.oasis.opendocument.text",
}


def _soffice() -> str | None:
    import shutil as _sh
    return _sh.which("soffice") or _sh.which("libreoffice")

_pool: asyncpg.Pool | None = None
# session token → identity. In memory: a console session is a working day, and a
# restart asking people to sign in again is an acceptable cost for not running a
# session store.
_sessions: dict[str, dict[str, Any]] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _pool
    if DB_DSN:
        for attempt in range(1, 11):
            try:
                _pool = await asyncpg.create_pool(DB_DSN, min_size=1, max_size=8)
                async with _pool.acquire() as c:
                    await c.execute((HERE / "schema.sql").read_text(encoding="utf-8"))
                log.info("console: database ready")
                break
            except Exception as exc:                            # noqa: BLE001
                log.warning("console: database not ready (%s/10): %s", attempt, exc)
                await _sleep(3)
        else:
            log.error("console: giving up on the database — running read-only")
    else:
        log.warning("console: CONSOLE_DB_DSN unset — running without persistence")
    yield
    if _pool:
        await _pool.close()


async def _sleep(s: float) -> None:
    import asyncio
    await asyncio.sleep(s)


app = FastAPI(title="Palladium Demo Console", lifespan=lifespan)


async def db() -> asyncpg.Pool:
    if _pool is None:
        raise HTTPException(503, "the console database is unavailable")
    return _pool


# ── identity ────────────────────────────────────────────────────────────────

class User(BaseModel):
    sub: str
    username: str
    full_name: str = ""
    email: str = ""
    org_role: str = "member"


async def current_user(request: Request) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    sess = _sessions.get(token or "")
    if not sess:
        raise HTTPException(401, "not signed in")
    if sess["expires"] < time.time():
        _sessions.pop(token, None)
        raise HTTPException(401, "session expired")
    return User(**sess["user"])


async def optional_user(request: Request) -> User | None:
    try:
        return await current_user(request)
    except HTTPException:
        return None


async def remember(user: User) -> None:
    """JIT-cache the identity. Keycloak stays authoritative for who you are; this
    row owns only what the console adds — the org role.

    org_role is written on INSERT and deliberately NOT touched on conflict. It
    carries the first-user-becomes-admin decision, and an update here would
    overwrite it with the column default on the next sign-in, quietly demoting
    the only admin on the console."""
    if _pool is None:
        return
    async with _pool.acquire() as c:
        await c.execute("""
            INSERT INTO console.person (kc_sub, username, full_name, email, org_role, last_seen)
            VALUES ($1, $2, $3, $4, $5, now())
            ON CONFLICT (kc_sub) DO UPDATE
               SET username = EXCLUDED.username,
                   full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), console.person.full_name),
                   email = COALESCE(NULLIF(EXCLUDED.email, ''), console.person.email),
                   last_seen = now()
        """, user.sub, user.username, user.full_name, user.email, user.org_role)


async def log_activity(*, user: User | None, verb: str, detail: str = "",
                       project: dict | None = None, result: str = "ok",
                       payload: dict | None = None) -> None:
    """Append-only. Never raises: an audit write that breaks the action it is
    recording would be worse than a gap in the log, and the gap is visible."""
    if _pool is None:
        return
    try:
        import json
        async with _pool.acquire() as c:
            await c.execute("""
                INSERT INTO console.activity
                    (person_sub, person_name, project_id, project_name,
                     verb, detail, result, payload)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
            """, user.sub if user else None,
                 (user.full_name or user.username) if user else None,
                 project["id"] if project else None,
                 project["name"] if project else None,
                 verb, detail[:500], result, json.dumps(payload or {}))
    except Exception:                                           # noqa: BLE001
        log.debug("console: activity write failed", exc_info=True)


# ── authorisation ───────────────────────────────────────────────────────────

ROLE_RANK = {"viewer": 1, "presenter": 2, "maintainer": 3, "admin": 4}


async def project_role(user: User, project_id: str) -> str | None:
    """The caller's role on one project. An org admin is admin everywhere —
    otherwise the first person to set the console up could lock themselves out
    of it."""
    if user.org_role == "admin":
        return "admin"
    if _pool is None:
        return None
    async with _pool.acquire() as c:
        return await c.fetchval(
            "SELECT role FROM console.grant WHERE person_sub=$1 AND project_id=$2",
            user.sub, project_id)


async def require_role(user: User, project_id: str, minimum: str) -> str:
    role = await project_role(user, project_id)
    if role is None or ROLE_RANK[role] < ROLE_RANK[minimum]:
        raise HTTPException(403, f"needs {minimum} on this project")
    return role


# ── sign in ─────────────────────────────────────────────────────────────────

@app.get("/auth/config")
async def auth_config() -> dict:
    return {"oidc": bool(KC_BASE and KC_SECRET), "env": CONSOLE_ENV,
            "realm": KC_REALM if KC_BASE else None,
            "passwords": True, "signup": OPEN_SIGNUP,
            # Without a mail relay the console cannot deliver a reset link, and
            # saying so is better than a "check your inbox" that never arrives.
            "can_email": bool(SMTP_HOST)}


# ── passwords ───────────────────────────────────────────────────────────────
# PBKDF2-HMAC-SHA256 from the standard library. Not the strongest KDF available,
# but it is the strongest one that adds NO dependency to an image that has to
# build on an air-gapped host, and the iteration count is written into every
# stored hash so it can be raised later without invalidating anything.

_PBKDF2_ITER = int(os.environ.get("CONSOLE_PBKDF2_ITER", "600000"))
_MIN_PASSWORD = 10


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ITER)
    return (f"pbkdf2_sha256${_PBKDF2_ITER}${base64.b64encode(salt).decode()}"
            f"${base64.b64encode(dk).decode()}")


def verify_password(password: str, stored: str | None) -> bool:
    """Constant-time, and False for every malformed or absent hash rather than
    raising — an OIDC identity simply has no password to check."""
    if not stored:
        return False
    try:
        algo, iters, salt_b64, dk_b64 = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(),
                                 base64.b64decode(salt_b64), int(iters))
        return hmac.compare_digest(dk, base64.b64decode(dk_b64))
    except Exception:                                           # noqa: BLE001
        return False


def password_problem(password: str) -> str | None:
    """What is wrong with this password, in the words shown to the person."""
    if len(password or "") < _MIN_PASSWORD:
        return f"Use at least {_MIN_PASSWORD} characters."
    if password.lower() in {"password12", "changeme123", "demoConsole".lower()}:
        return "That one is on every guess list. Pick something else."
    return None


@app.get("/auth/login")
async def auth_login(request: Request) -> Response:
    if not (KC_BASE and KC_SECRET):
        raise HTTPException(503, "OIDC is not configured on this console")
    state = secrets.token_urlsafe(24)
    _sessions[f"state:{state}"] = {"expires": time.time() + 600, "user": None}
    url = (f"{KC_BASE}/realms/{KC_REALM}/protocol/openid-connect/auth"
           f"?client_id={KC_CLIENT}&response_type=code&scope=openid%20profile%20email"
           f"&redirect_uri={PUBLIC_URL}/auth/callback&state={state}")
    return RedirectResponse(url)


@app.get("/auth/callback")
async def auth_callback(code: str = "", state: str = "") -> Response:
    if _sessions.pop(f"state:{state}", None) is None:
        raise HTTPException(400, "unknown or expired sign-in attempt")
    async with httpx.AsyncClient(timeout=15) as c:
        tok = await c.post(
            f"{KC_BASE}/realms/{KC_REALM}/protocol/openid-connect/token",
            data={"grant_type": "authorization_code", "code": code,
                  "client_id": KC_CLIENT, "client_secret": KC_SECRET,
                  "redirect_uri": f"{PUBLIC_URL}/auth/callback"})
        if tok.status_code != 200:
            raise HTTPException(401, "sign-in was rejected by the identity provider")
        access = tok.json().get("access_token", "")
        info = await c.get(f"{KC_BASE}/realms/{KC_REALM}/protocol/openid-connect/userinfo",
                           headers={"Authorization": f"Bearer {access}"})
    claims = info.json() if info.status_code == 200 else {}
    user = User(sub=claims.get("sub", ""),
                username=claims.get("preferred_username", "unknown"),
                full_name=claims.get("name", ""), email=claims.get("email", ""))
    return await _establish(user)


# ── local accounts: register, sign in, reset ────────────────────────────────

class RegisterIn(BaseModel):
    username: str = Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9._-]{2,39}$")
    password: str
    full_name: str = Field(default="", max_length=120)
    email: str = Field(default="", max_length=180)


class PasswordLoginIn(BaseModel):
    identifier: str                 # username or email, so nobody has to remember which
    password: str


class ForgotIn(BaseModel):
    identifier: str


class ResetIn(BaseModel):
    token: str
    password: str


async def _find_person(conn: asyncpg.Connection, identifier: str) -> asyncpg.Record | None:
    return await conn.fetchrow(
        "SELECT * FROM console.person "
        "WHERE lower(username) = lower($1) OR lower(email) = lower($1)",
        (identifier or "").strip())


def _user_from_row(row: asyncpg.Record) -> User:
    return User(sub=row["kc_sub"], username=row["username"],
                full_name=row["full_name"] or "", email=row["email"] or "",
                org_role=row["org_role"])


@app.post("/auth/register")
async def register(body: RegisterIn) -> Response:
    """Create an account. It reaches NOTHING until somebody grants it a project —
    that is what makes open registration safe rather than generous."""
    if not OPEN_SIGNUP:
        raise HTTPException(403, "this console is invite-only — ask an admin for an account")
    if (why := password_problem(body.password)):
        raise HTTPException(400, why)
    pool = await db()
    async with pool.acquire() as c:
        # First person in becomes a console admin; see _establish for the same
        # rule on the OIDC path.
        n = await c.fetchval("SELECT count(*) FROM console.person")
        sub = f"local-{uuid.uuid4()}"
        try:
            await c.execute("""
                INSERT INTO console.person
                    (kc_sub, username, full_name, email, org_role, password_hash)
                VALUES ($1,$2,$3,$4,$5,$6)
            """, sub, body.username.strip(), body.full_name.strip(),
                 body.email.strip().lower(), "admin" if n == 0 else "member",
                 hash_password(body.password))
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "that username or email is already registered")
        row = await c.fetchrow("SELECT * FROM console.person WHERE kc_sub=$1", sub)
    user = _user_from_row(row)
    await log_activity(user=user, verb="registered",
                       detail="first account — console admin" if n == 0 else "")
    return _issue_session(user)


@app.post("/auth/password-login")
async def password_login(body: PasswordLoginIn) -> Response:
    pool = await db()
    async with pool.acquire() as c:
        row = await _find_person(c, body.identifier)
    # One message for "no such account" and "wrong password" both, so this is not
    # a way to find out who has an account here.
    if not row or not verify_password(body.password, row["password_hash"]):
        await log_activity(user=None, verb="sign-in-failed",
                           detail=(body.identifier or "")[:60], result="denied")
        raise HTTPException(401, "that username or password is not right")
    if row["status"] != "active":
        await log_activity(user=_user_from_row(row), verb="sign-in-blocked",
                           detail="account disabled", result="denied")
        raise HTTPException(403, "this account is disabled — an admin can re-enable it")
    user = _user_from_row(row)
    await remember(user)
    await log_activity(user=user, verb="signed-in")
    return _issue_session(user)


def _reset_link(token: str) -> str:
    return f"{PUBLIC_URL}/#/reset/{token}"


async def _issue_reset(conn: asyncpg.Connection, person_sub: str,
                       issued_by: str | None) -> str:
    """Mint a single-use link and store only its hash."""
    token = secrets.token_urlsafe(32)
    await conn.execute("""
        INSERT INTO console.reset_token (token_hash, person_sub, issued_by, expires_at)
        VALUES ($1,$2,$3, now() + make_interval(mins => $4))
    """, hashlib.sha256(token.encode()).hexdigest(), person_sub, issued_by, RESET_TTL_MIN)
    return token


def _send_reset_email(to: str, link: str) -> bool:
    """Only ever called when a relay is configured. Returns whether it went."""
    if not (SMTP_HOST and to):
        return False
    try:
        import smtplib
        from email.message import EmailMessage
        msg = EmailMessage()
        msg["Subject"] = "Reset your Demo Console password"
        msg["From"] = SMTP_FROM or SMTP_USER
        msg["To"] = to
        msg.set_content(
            f"Someone asked to reset the password on your Demo Console account.\n\n"
            f"{link}\n\nThe link works once and expires in {RESET_TTL_MIN} minutes. "
            f"If this was not you, nothing has changed and you can ignore it.\n")
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as s:
            s.starttls()
            if SMTP_USER:
                s.login(SMTP_USER, SMTP_PASSWORD)
            s.send_message(msg)
        return True
    except Exception:                                           # noqa: BLE001
        log.warning("console: reset email could not be sent", exc_info=True)
        return False


@app.post("/auth/forgot")
async def forgot(body: ForgotIn) -> dict:
    """Always 200 and always the same shape, so this is not an account oracle."""
    pool = await db()
    delivered, link = False, None
    async with pool.acquire() as c:
        row = await _find_person(c, body.identifier)
        if row and row["password_hash"] and row["status"] == "active":
            token = await _issue_reset(c, row["kc_sub"], None)
            link = _reset_link(token)
            delivered = _send_reset_email(row["email"] or "", link)
            await log_activity(user=_user_from_row(row), verb="requested-password-reset",
                               detail="emailed" if delivered else "awaiting an admin")
    return {
        "ok": True,
        "emailed": delivered,
        "message": ("If that account exists, a reset link is on its way."
                    if SMTP_HOST else
                    "If that account exists, an admin can now issue its reset link "
                    "from People & access."),
        # A console with no mail relay has no way to hand the link over, and in
        # development that makes the flow untestable. Returning it here is scoped
        # to dev on purpose and is never the behaviour on a real deployment.
        "link": link if (CONSOLE_ENV == "dev" and not delivered) else None,
    }


@app.post("/auth/reset")
async def reset_password(body: ResetIn) -> Response:
    if (why := password_problem(body.password)):
        raise HTTPException(400, why)
    pool = await db()
    async with pool.acquire() as c:
        async with c.transaction():
            row = await c.fetchrow("""
                SELECT t.token_hash, p.*
                FROM console.reset_token t
                JOIN console.person p ON p.kc_sub = t.person_sub
                WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now()
                FOR UPDATE OF t
            """, hashlib.sha256(body.token.encode()).hexdigest())
            if not row:
                raise HTTPException(400, "that reset link has expired or has already been used")
            await c.execute("UPDATE console.person SET password_hash=$2 WHERE kc_sub=$1",
                            row["kc_sub"], hash_password(body.password))
            await c.execute("UPDATE console.reset_token SET used_at = now() WHERE token_hash=$1",
                            row["token_hash"])
            # Every other outstanding link for this person dies with it.
            await c.execute("""UPDATE console.reset_token SET used_at = now()
                               WHERE person_sub=$1 AND used_at IS NULL""", row["kc_sub"])
    user = _user_from_row(row)
    _drop_sessions(user.sub)          # a reset ends whatever else was signed in
    await log_activity(user=user, verb="reset-password")
    return _issue_session(user)


async def _establish(user: User) -> Response:
    if _pool is not None:
        async with _pool.acquire() as c:
            row = await c.fetchrow("SELECT org_role FROM console.person WHERE kc_sub=$1",
                                   user.sub)
            # First person in becomes a console admin — otherwise there is nobody
            # who can grant anything and the console is inert on arrival.
            n = await c.fetchval("SELECT count(*) FROM console.person")
        if row:
            user.org_role = row["org_role"]
        elif n == 0:
            user.org_role = "admin"
            log.info("console: %s is the first person here — granting console admin",
                     user.username)
    await remember(user)
    await log_activity(user=user, verb="signed-in")
    return _issue_session(user, redirect=True)


def _issue_session(user: User, *, redirect: bool = False) -> Response:
    """Set the session cookie. The OIDC callback is a browser navigation and
    needs a redirect; the password forms are fetches and want an answer."""
    token = secrets.token_urlsafe(32)
    _sessions[token] = {"user": user.model_dump(), "expires": time.time() + 12 * 3600}
    resp: Response = (RedirectResponse("/", status_code=303) if redirect
                      else JSONResponse({"ok": True, "user": user.model_dump()}))
    resp.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="lax",
                    max_age=12 * 3600, secure=PUBLIC_URL.startswith("https"))
    return resp


def _drop_sessions(sub: str, keep: str | None = None) -> None:
    """End every session this person holds — used when they are disabled and when
    their password changes, so neither is a change that takes effect tomorrow.

    `keep` spares one token: changing your own password should sign out the other
    places you are signed in, not the browser you are typing in."""
    for token, sess in list(_sessions.items()):
        if token != keep and (sess.get("user") or {}).get("sub") == sub:
            _sessions.pop(token, None)


@app.post("/auth/logout")
async def logout(request: Request) -> Response:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        _sessions.pop(token, None)
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(SESSION_COOKIE)
    return resp


@app.get("/api/me")
async def me(user: User = Depends(current_user)) -> dict:
    """Who am I. 401 when nobody — correct for an API consumer."""
    return user.model_dump()


@app.get("/auth/session")
async def session(request: Request) -> dict:
    """Am I signed in? Always 200.

    The app asks this on every load, and "not signed in yet" is the expected
    answer on a first visit — not a failure. Asking /api/me instead made the
    browser log a red 401 for the most ordinary thing a visitor does, which
    trains people to ignore their console and buries the errors that matter."""
    user = await optional_user(request)
    return {"signed_in": user is not None,
            "user": user.model_dump() if user else None}


# ── projects ────────────────────────────────────────────────────────────────

def _resource_row(r: asyncpg.Record) -> dict:
    """What the browser needs to decide how to OPEN a resource, decided here
    rather than by sniffing a file extension in the client."""
    d = dict(r)
    d["id"] = str(d["id"])
    d["project_id"] = str(d["project_id"])
    d.pop("object_key", None)               # the key never leaves the server
    has_preview = bool(d.pop("preview_key", None))
    mime = d.get("mime") or ""
    d["stored"] = bool(r["object_key"])
    # A link is not previewable HERE. Most sites refuse to be framed, and a
    # blank frame where GitHub should be is worse than sending somebody to it.
    d["preview"] = (
        "pdf" if mime == "application/pdf" or has_preview else
        "video" if mime.startswith("video/") else
        "image" if mime.startswith("image/") else
        "text" if mime.startswith("text/") else
        None) if r["object_key"] else None
    d["needs_rendition"] = bool(r["object_key"]) and not has_preview and mime in CONVERTIBLE
    d["created_at"] = r["created_at"].isoformat()
    return d


def _project_row(r: asyncpg.Record) -> dict:
    d = dict(r)
    d["id"] = str(d["id"])
    d.pop("agent_token", None)          # never leaves the server
    return d


@app.get("/api/projects")
async def list_projects(user: User = Depends(current_user)) -> dict:
    pool = await db()
    async with pool.acquire() as c:
        if user.org_role == "admin":
            rows = await c.fetch(
                "SELECT * FROM console.project WHERE NOT archived ORDER BY name")
            roles = {}
        else:
            rows = await c.fetch("""
                SELECT p.* FROM console.project p
                JOIN console.grant g ON g.project_id = p.id AND g.person_sub = $1
                WHERE NOT p.archived ORDER BY p.name
            """, user.sub)
            roles = {str(r["project_id"]): r["role"] for r in await c.fetch(
                "SELECT project_id, role FROM console.grant WHERE person_sub=$1", user.sub)}
        holds = {str(h["project_id"]): dict(h) for h in
                 await c.fetch("SELECT * FROM console.hold WHERE held_until > now()")}
        counts = {str(x["project_id"]): x["n"] for x in await c.fetch(
            "SELECT project_id, count(*) AS n FROM console.resource GROUP BY 1")}
        # Last activity, so "recently active" sorts on something real rather
        # than on updated_at, which only moves when a row is edited.
        touched = {str(x["project_id"]): x["at"] for x in await c.fetch(
            "SELECT project_id, max(at) AS at FROM console.activity "
            "WHERE project_id IS NOT NULL GROUP BY 1")}

    out = []
    for r in rows:
        p = _project_row(r)
        pid = p["id"]
        p["my_role"] = "admin" if user.org_role == "admin" else roles.get(pid)
        p["resource_count"] = counts.get(pid, 0)
        at = touched.get(pid)
        p["last_activity"] = at.isoformat() if at else None
        hold = holds.get(pid)
        p["hold"] = ({"by": hold["person_name"], "until": hold["held_until"].isoformat(),
                      "reason": hold["reason"]} if hold else None)
        out.append(p)
    return {"projects": out}


# The documentation sections, in the order they are written and shown. ONE
# list: the create form renders a field per entry, the Overview renders a
# section per entry, and the PATCH route accepts exactly these. A section added
# here appears in all three; a section that exists in only one of them cannot,
# which is the whole point — a heading with no source behind it is how a page
# starts lying.
DOC_SECTIONS = [
    ("what_it_is",   "What it is",
     "What the thing actually is, in a few sentences."),
    ("who_for",      "Who it is for",
     "Whose problem it solves, and who tends to be in the room."),
    ("what_to_show", "What to show",
     "The walk-through: the moments worth showing, in order."),
    ("how_built",    "How it is built",
     "What it is made of — the parts worth naming."),
    ("caveats",      "What to be careful about",
     "What is mock, missing, or must not be promised."),
]
DOC_FIELDS = [k for k, _, _ in DOC_SECTIONS]


@app.get("/api/doc-sections")
async def doc_sections(user: User = Depends(current_user)) -> dict:
    """The one list, served to the browser. The create form builds a field per
    entry and the Overview builds a section per entry from THIS — neither has
    its own copy, so they cannot come to disagree about what a project says."""
    return {"sections": [{"key": k, "label": lab, "hint": h}
                         for k, lab, h in DOC_SECTIONS]}


class ProjectIn(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,48}$")
    name: str = Field(min_length=2, max_length=120)
    client: str | None = None
    summary: str | None = None
    chip: str = Field(default="??", max_length=3)
    colour: str = Field(default="#3558e8", pattern=r"^#[0-9a-fA-F]{6}$")
    demo_url: str | None = None
    agent_url: str | None = None
    agent_token: str | None = None
    # documentation — the Overview tab
    what_it_is: str | None = None
    who_for: str | None = None
    what_to_show: str | None = None
    how_built: str | None = None
    caveats: str | None = None


@app.post("/api/projects")
async def create_project(body: ProjectIn, user: User = Depends(current_user)) -> dict:
    if user.org_role != "admin":
        raise HTTPException(403, "only a console admin can add a project")
    pool = await db()
    async with pool.acquire() as c:
        try:
            row = await c.fetchrow("""
                INSERT INTO console.project
                    (slug, name, client, summary, chip, colour, demo_url, agent_url,
                     agent_token, owner_sub,
                     what_it_is, who_for, what_to_show, how_built, caveats)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *
            """, body.slug, body.name, body.client, body.summary, body.chip.upper(),
                 body.colour, body.demo_url, body.agent_url, body.agent_token, user.sub,
                 *(getattr(body, f) for f in DOC_FIELDS))
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, f"a project with slug '{body.slug}' already exists")
        await c.execute("""
            INSERT INTO console.grant (person_sub, project_id, role, granted_by)
            VALUES ($1,$2,'admin',$1) ON CONFLICT DO NOTHING
        """, user.sub, row["id"])
    p = _project_row(row)
    await log_activity(user=user, verb="created-project", detail=body.name, project=p)
    return p


@app.get("/api/projects/{project_id}")
async def get_project(project_id: str, user: User = Depends(current_user)) -> dict:
    role = await require_role(user, project_id, "viewer")
    pool = await db()
    async with pool.acquire() as c:
        row = await c.fetchrow("SELECT * FROM console.project WHERE id=$1", project_id)
        if not row:
            raise HTTPException(404, "no such project")
        # kind='note' is excluded: those are attachments belonging to a note,
        # shown on the note itself. A shelf is curated material, not everything
        # that has ever been uploaded.
        resources = await c.fetch(
            "SELECT * FROM console.resource WHERE project_id=$1 AND kind <> 'note' "
            "ORDER BY ordering, created_at", project_id)
        activity = await c.fetch("""
            SELECT at, person_name, verb, detail, result FROM console.activity
            WHERE project_id=$1 ORDER BY at DESC LIMIT 25
        """, project_id)
        grants = await c.fetch("""
            SELECT g.role, p.username, p.full_name, p.kc_sub FROM console.grant g
            JOIN console.person p ON p.kc_sub = g.person_sub
            WHERE g.project_id=$1 ORDER BY p.full_name, p.username
        """, project_id)
        hold = await c.fetchrow(
            "SELECT * FROM console.hold WHERE project_id=$1 AND held_until > now()", project_id)

    p = _project_row(row)
    p["my_role"] = role
    p["has_agent"] = bool(row["agent_url"])
    p["resources"] = [_resource_row(r) for r in resources]
    p["activity"] = [{**dict(a), "at": a["at"].isoformat()} for a in activity]
    p["grants"] = [dict(g) for g in grants]
    p["hold"] = ({"by": hold["person_name"], "until": hold["held_until"].isoformat(),
                  "reason": hold["reason"]} if hold else None)
    return p


class ProjectPatch(BaseModel):
    """What a maintainer may change after a project exists.

    The documentation fields are here for the same reason they are on ProjectIn:
    a project created before a section existed, or created in a hurry, has to be
    fillable — otherwise the Overview has headings that can never be answered
    and the creation form becomes the only chance anyone gets."""
    name: str | None = Field(default=None, min_length=2, max_length=120)
    client: str | None = None
    summary: str | None = None
    chip: str | None = Field(default=None, max_length=3)
    colour: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    demo_url: str | None = None
    what_it_is: str | None = None
    who_for: str | None = None
    what_to_show: str | None = None
    how_built: str | None = None
    caveats: str | None = None


@app.patch("/api/projects/{project_id}")
async def patch_project(project_id: str, body: ProjectPatch,
                        user: User = Depends(current_user)) -> dict:
    await require_role(user, project_id, "maintainer")
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not fields:
        raise HTTPException(400, "nothing to change")
    if "chip" in fields and fields["chip"]:
        fields["chip"] = fields["chip"].upper()
    # Empty string clears a section; None means "not sent", which model_dump
    # with exclude_unset already keeps out of here.
    for k, v in list(fields.items()):
        if isinstance(v, str) and not v.strip():
            fields[k] = None

    cols = ", ".join(f"{k} = ${i}" for i, k in enumerate(fields, start=2))
    pool = await db()
    async with pool.acquire() as c:
        row = await c.fetchrow(
            f"UPDATE console.project SET {cols}, updated_at = now() "
            f"WHERE id = $1 RETURNING *", project_id, *fields.values())
    if not row:
        raise HTTPException(404, "no such project")
    changed = ", ".join(sorted(fields))
    await log_activity(user=user, verb="edited project", detail=changed,
                       project={"id": row["id"], "name": row["name"]})
    return _project_row(row)


# ── folders ─────────────────────────────────────────────────────────────────
# Organisation for the shelf. Everything here is scoped to one project and
# checked against it: a folder id from another project must never be reachable
# by guessing, so every lookup carries the project and 404s rather than leaking
# that the row exists somewhere else.

async def _folder_in(c: asyncpg.Connection, project_id: str, folder_id: str | None):
    if folder_id in (None, "", "root"):
        return None
    row = await c.fetchrow(
        "SELECT * FROM console.folder WHERE id=$1 AND project_id=$2", folder_id, project_id)
    if not row:
        raise HTTPException(404, "no such folder here")
    return row


async def _breadcrumb(c: asyncpg.Connection, folder) -> list[dict]:
    """Root-first trail to `folder`. Walks parents with a depth cap — a cycle
    should be impossible (see _would_cycle) but a loop in a web request is a
    hung worker, and a cap costs nothing."""
    trail: list[dict] = []
    cur, guard = folder, 0
    while cur is not None and guard < 64:
        trail.append({"id": str(cur["id"]), "name": cur["name"]})
        if cur["parent_id"] is None:
            break
        cur = await c.fetchrow("SELECT * FROM console.folder WHERE id=$1", cur["parent_id"])
        guard += 1
    return list(reversed(trail))


async def _would_cycle(c: asyncpg.Connection, folder_id: str, new_parent: str | None) -> bool:
    """Is `new_parent` inside `folder_id`'s own subtree? Moving a folder into
    its own descendant detaches the whole branch from the tree — the rows keep
    existing and nothing can ever reach them again."""
    if new_parent is None:
        return False
    if str(new_parent) == str(folder_id):
        return True
    cur, guard = new_parent, 0
    while cur is not None and guard < 64:
        row = await c.fetchrow("SELECT parent_id FROM console.folder WHERE id=$1", cur)
        if not row:
            return False
        if row["parent_id"] and str(row["parent_id"]) == str(folder_id):
            return True
        cur = row["parent_id"]
        guard += 1
    return False


@app.get("/api/projects/{project_id}/tree")
async def list_tree(project_id: str, folder: str | None = None,
                    user: User = Depends(current_user)) -> dict:
    """One level of the shelf: the folders and the files directly inside it."""
    await require_role(user, project_id, "viewer")
    pool = await db()
    async with pool.acquire() as c:
        here = await _folder_in(c, project_id, folder)
        fid = here["id"] if here else None
        # Direct counts for the row (the file-manager convention) AND subtree
        # totals for the delete warning. Delete is recursive, so a warning built
        # from direct counts would say "0 files" while removing ten one level
        # down — the one destructive action here, understating itself.
        folders = await c.fetch("""
            SELECT f.*,
                   (SELECT count(*) FROM console.folder s WHERE s.parent_id = f.id) AS n_folders,
                   (SELECT count(*) FROM console.resource r
                     WHERE r.folder_id = f.id AND r.kind <> 'note') AS n_files,
                   sub.deep_folders, sub.deep_files
            FROM console.folder f
            CROSS JOIN LATERAL (
                WITH RECURSIVE tree AS (
                    SELECT f.id
                    UNION ALL
                    SELECT c2.id FROM console.folder c2 JOIN tree ON c2.parent_id = tree.id
                )
                SELECT (SELECT count(*) FROM tree) - 1 AS deep_folders,
                       (SELECT count(*) FROM console.resource r
                         WHERE r.folder_id IN (SELECT id FROM tree)
                           AND r.kind <> 'note') AS deep_files
            ) sub
            WHERE f.project_id = $1 AND f.parent_id IS NOT DISTINCT FROM $2
            ORDER BY lower(f.name)
        """, project_id, fid)
        files = await c.fetch("""
            SELECT * FROM console.resource
            WHERE project_id = $1 AND folder_id IS NOT DISTINCT FROM $2 AND kind <> 'note'
            ORDER BY ordering, created_at
        """, project_id, fid)
        crumb = await _breadcrumb(c, here) if here else []
    return {
        "folder": ({"id": str(here["id"]), "name": here["name"]} if here else None),
        "breadcrumb": crumb,
        "folders": [{"id": str(f["id"]), "name": f["name"],
                     "n_folders": f["n_folders"], "n_files": f["n_files"],
                     "deep_folders": f["deep_folders"], "deep_files": f["deep_files"],
                     "created_at": f["created_at"].isoformat()} for f in folders],
        "files": [_resource_row(r) for r in files],
    }


@app.get("/api/projects/{project_id}/folders/all")
async def all_folders(project_id: str, user: User = Depends(current_user)) -> dict:
    """Every folder in the project, each with its full path — what a move
    dialogue needs. Paths are built in one pass from the parent map rather than
    a query per row."""
    await require_role(user, project_id, "viewer")
    pool = await db()
    async with pool.acquire() as c:
        rows = await c.fetch(
            "SELECT id, parent_id, name FROM console.folder WHERE project_id=$1", project_id)
    by_id = {str(r["id"]): {"id": str(r["id"]),
                            "parent_id": (str(r["parent_id"]) if r["parent_id"] else None),
                            "name": r["name"]} for r in rows}

    def path_of(fid: str) -> str:
        parts, cur, guard = [], fid, 0
        while cur and guard < 64:
            node = by_id.get(cur)
            if not node:
                break
            parts.append(node["name"])
            cur = node["parent_id"]
            guard += 1
        return " / ".join(reversed(parts))

    out = [{**v, "path": path_of(k)} for k, v in by_id.items()]
    out.sort(key=lambda f: f["path"].lower())
    return {"folders": out}


class FolderIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    parent_id: str | None = None


@app.post("/api/projects/{project_id}/folders")
async def create_folder(project_id: str, body: FolderIn,
                        user: User = Depends(current_user)) -> dict:
    await require_role(user, project_id, "maintainer")
    pool = await db()
    async with pool.acquire() as c:
        parent = await _folder_in(c, project_id, body.parent_id)
        try:
            row = await c.fetchrow("""
                INSERT INTO console.folder (project_id, parent_id, name, created_by)
                VALUES ($1,$2,$3,$4) RETURNING *
            """, project_id, (parent["id"] if parent else None), body.name.strip(), user.sub)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, f"there is already a folder called '{body.name.strip()}' here")
        project = await c.fetchrow("SELECT id, name FROM console.project WHERE id=$1", project_id)
    await log_activity(user=user, verb="created a folder", detail=body.name.strip(),
                       project={"id": project["id"], "name": project["name"]})
    return {"id": str(row["id"]), "name": row["name"]}


class FolderPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    parent_id: str | None = None
    move: bool = False          # explicit: parent_id=None means "to the top"


@app.patch("/api/folders/{folder_id}")
async def patch_folder(folder_id: str, body: FolderPatch,
                       user: User = Depends(current_user)) -> dict:
    """Rename, move, or both. `move` has to be set to act on parent_id, because
    a null parent is a legitimate destination (the top level) and is otherwise
    indistinguishable from "not sent"."""
    pool = await db()
    async with pool.acquire() as c:
        row = await c.fetchrow("SELECT * FROM console.folder WHERE id=$1", folder_id)
        if not row:
            raise HTTPException(404, "no such folder")
        pid = str(row["project_id"])
        await require_role(user, pid, "maintainer")

        new_parent = row["parent_id"]
        if body.move:
            dest = await _folder_in(c, pid, body.parent_id)
            new_parent = dest["id"] if dest else None
            if await _would_cycle(c, folder_id, new_parent):
                raise HTTPException(400, "a folder cannot be moved inside itself")
        try:
            out = await c.fetchrow("""
                UPDATE console.folder SET name = $2, parent_id = $3 WHERE id = $1 RETURNING *
            """, folder_id, (body.name or row["name"]).strip(), new_parent)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "something with that name is already there")
        project = await c.fetchrow("SELECT id, name FROM console.project WHERE id=$1", pid)
    await log_activity(user=user, verb=("moved a folder" if body.move else "renamed a folder"),
                       detail=out["name"],
                       project={"id": project["id"], "name": project["name"]})
    return {"id": str(out["id"]), "name": out["name"]}


@app.delete("/api/folders/{folder_id}")
async def delete_folder(folder_id: str, user: User = Depends(current_user)) -> dict:
    """Takes the subtree and its files with it. The bytes go too — see
    _delete_bytes_under; a row cascade that left files on disk would grow the
    volume forever with things nothing can reach."""
    pool = await db()
    async with pool.acquire() as c:
        row = await c.fetchrow("SELECT * FROM console.folder WHERE id=$1", folder_id)
        if not row:
            raise HTTPException(404, "no such folder")
        pid = str(row["project_id"])
        await require_role(user, pid, "maintainer")
        keys = await c.fetch("""
            WITH RECURSIVE sub AS (
                SELECT id FROM console.folder WHERE id = $1
                UNION ALL
                SELECT f.id FROM console.folder f JOIN sub ON f.parent_id = sub.id
            )
            SELECT r.object_key, r.preview_key FROM console.resource r
            WHERE r.folder_id IN (SELECT id FROM sub)
        """, folder_id)
        await c.execute("DELETE FROM console.folder WHERE id=$1", folder_id)
        project = await c.fetchrow("SELECT id, name FROM console.project WHERE id=$1", pid)
    for k in keys:
        for key in (k["object_key"], k["preview_key"]):
            if key:
                try:
                    (DATA_DIR / key).unlink(missing_ok=True)
                except OSError:
                    log.warning("could not remove %s", key)
    await log_activity(user=user, verb="removed a folder", detail=row["name"],
                       project={"id": project["id"], "name": project["name"]})
    return {"ok": True, "files_removed": len(keys)}


class CopyIn(BaseModel):
    target_parent_id: str | None = None


async def _copy_resource(c: asyncpg.Connection, row, folder_id, user: User) -> str:
    """Copy one resource row AND its bytes.

    The bytes are duplicated rather than the key shared. Sharing would be
    cheaper and is a trap: deleting either copy unlinks the file and leaves the
    other pointing at nothing."""
    new_key = new_preview = None
    for src_attr, dst in (("object_key", "obj"), ("preview_key", "prev")):
        key = row[src_attr]
        if not key:
            continue
        src = DATA_DIR / key
        if not src.is_file():
            continue
        folder = DATA_DIR / str(row["project_id"]) / uuid.uuid4().hex[:12]
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / src.name
        target.write_bytes(src.read_bytes())
        if dst == "obj":
            new_key = str(target.relative_to(DATA_DIR))
        else:
            new_preview = str(target.relative_to(DATA_DIR))
    out = await c.fetchrow("""
        INSERT INTO console.resource
            (project_id, folder_id, kind, title, note, object_key, url, mime,
             size_bytes, ordering, preview_key, uploaded_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id
    """, row["project_id"], folder_id, row["kind"], row["title"], row["note"],
         new_key, row["url"], row["mime"], row["size_bytes"], row["ordering"],
         new_preview, user.sub)
    return str(out["id"])


@app.post("/api/folders/{folder_id}/copy")
async def copy_folder(folder_id: str, body: CopyIn,
                      user: User = Depends(current_user)) -> dict:
    """Copy a folder and everything under it. Breadth-first rather than
    recursive so a deep tree cannot exhaust the stack in a request handler."""
    pool = await db()
    async with pool.acquire() as c:
        row = await c.fetchrow("SELECT * FROM console.folder WHERE id=$1", folder_id)
        if not row:
            raise HTTPException(404, "no such folder")
        pid = str(row["project_id"])
        await require_role(user, pid, "maintainer")
        dest = await _folder_in(c, pid, body.target_parent_id)
        dest_id = dest["id"] if dest else None
        if await _would_cycle(c, folder_id, dest_id):
            raise HTTPException(400, "a folder cannot be copied inside itself")

        name, n = row["name"], 0
        while await c.fetchval("""SELECT 1 FROM console.folder
                WHERE project_id=$1 AND parent_id IS NOT DISTINCT FROM $2
                  AND lower(name)=lower($3)""", pid, dest_id, name):
            n += 1
            name = f"{row['name']} (copy{'' if n == 1 else ' ' + str(n)})"

        new_root = await c.fetchrow("""
            INSERT INTO console.folder (project_id, parent_id, name, created_by)
            VALUES ($1,$2,$3,$4) RETURNING *
        """, pid, dest_id, name, user.sub)

        copied_files = 0
        queue = [(row["id"], new_root["id"])]
        while queue:
            src_id, dst_id = queue.pop(0)
            for r in await c.fetch(
                    "SELECT * FROM console.resource WHERE folder_id=$1", src_id):
                await _copy_resource(c, r, dst_id, user)
                copied_files += 1
            for sub in await c.fetch(
                    "SELECT * FROM console.folder WHERE parent_id=$1", src_id):
                made = await c.fetchrow("""
                    INSERT INTO console.folder (project_id, parent_id, name, created_by)
                    VALUES ($1,$2,$3,$4) RETURNING id
                """, pid, dst_id, sub["name"], user.sub)
                queue.append((sub["id"], made["id"]))
        project = await c.fetchrow("SELECT id, name FROM console.project WHERE id=$1", pid)
    await log_activity(user=user, verb="copied a folder", detail=name,
                       project={"id": project["id"], "name": project["name"]})
    return {"id": str(new_root["id"]), "name": name, "files_copied": copied_files}


class ResourceMove(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    folder_id: str | None = None
    move: bool = False


@app.patch("/api/resources/{resource_id}")
async def patch_resource(resource_id: str, body: ResourceMove,
                         user: User = Depends(current_user)) -> dict:
    pool = await db()
    async with pool.acquire() as c:
        row = await c.fetchrow("SELECT * FROM console.resource WHERE id=$1", resource_id)
        if not row:
            raise HTTPException(404, "no such resource")
        pid = str(row["project_id"])
        await require_role(user, pid, "maintainer")
        new_folder = row["folder_id"]
        if body.move:
            dest = await _folder_in(c, pid, body.folder_id)
            new_folder = dest["id"] if dest else None
        out = await c.fetchrow("""
            UPDATE console.resource SET title = $2, folder_id = $3 WHERE id = $1 RETURNING *
        """, resource_id, (body.title or row["title"]).strip(), new_folder)
        project = await c.fetchrow("SELECT id, name FROM console.project WHERE id=$1", pid)
    await log_activity(user=user, verb=("moved a file" if body.move else "renamed a file"),
                       detail=out["title"],
                       project={"id": project["id"], "name": project["name"]})
    return _resource_row(out)


@app.post("/api/resources/{resource_id}/copy")
async def copy_resource(resource_id: str, body: CopyIn,
                        user: User = Depends(current_user)) -> dict:
    pool = await db()
    async with pool.acquire() as c:
        row = await c.fetchrow("SELECT * FROM console.resource WHERE id=$1", resource_id)
        if not row:
            raise HTTPException(404, "no such resource")
        pid = str(row["project_id"])
        await require_role(user, pid, "maintainer")
        dest = await _folder_in(c, pid, body.target_parent_id)
        new_id = await _copy_resource(c, row, (dest["id"] if dest else None), user)
        project = await c.fetchrow("SELECT id, name FROM console.project WHERE id=$1", pid)
    await log_activity(user=user, verb="copied a file", detail=row["title"],
                       project={"id": project["id"], "name": project["name"]})
    return {"id": new_id}


# ── notes ───────────────────────────────────────────────────────────────────
# What somebody learned and wants the next presenter to know. Text, a file, or
# both — the file goes through the same store as every other resource.

def _note_row(r: asyncpg.Record) -> dict:
    d = {"id": str(r["id"]), "body": r["body"], "author_name": r["author_name"],
         "created_at": r["created_at"].isoformat(), "file": None}
    if r["resource_id"]:
        d["file"] = {"id": str(r["resource_id"]), "title": r["file_title"],
                     "mime": r["file_mime"], "size_bytes": r["file_size"],
                     "previewable": bool(r["file_preview"])
                                    or r["file_mime"] in INLINE_TYPES}
    return d


NOTE_SELECT = """
    SELECT n.*, r.title AS file_title, r.mime AS file_mime,
           r.size_bytes AS file_size, r.preview_key AS file_preview
    FROM console.note n
    LEFT JOIN console.resource r ON r.id = n.resource_id
"""


@app.get("/api/projects/{project_id}/notes")
async def list_notes(project_id: str, user: User = Depends(current_user)) -> dict:
    await require_role(user, project_id, "viewer")
    pool = await db()
    async with pool.acquire() as c:
        rows = await c.fetch(NOTE_SELECT + " WHERE n.project_id=$1 "
                             "ORDER BY n.created_at DESC", project_id)
    return {"notes": [_note_row(r) for r in rows]}


@app.post("/api/projects/{project_id}/notes")
async def add_note(project_id: str, body: str = Form(""),
                   file: UploadFile | None = File(None),
                   user: User = Depends(current_user)) -> dict:
    """A note is text, a file, or both — so this is multipart even when there is
    no file, and refuses only the case where there is neither."""
    await require_role(user, project_id, "presenter")
    text = (body or "").strip()
    has_file = file is not None and bool(file.filename)
    if not text and not has_file:
        raise HTTPException(400, "a note needs words, a file, or both")

    resource_id = None
    if has_file:
        stored = await _store_upload(project_id, file, title=file.filename or "note",
                                     kind="note", user=user)
        resource_id = stored["id"]

    pool = await db()
    async with pool.acquire() as c:
        row = await c.fetchrow("""
            INSERT INTO console.note (project_id, body, resource_id, author_sub,
                                      author_name)
            VALUES ($1,$2,$3,$4,$5) RETURNING id
        """, project_id, text or None, resource_id, user.sub,
             user.full_name or user.username)
        full = await c.fetchrow(NOTE_SELECT + " WHERE n.id=$1", row["id"])
        project = await c.fetchrow("SELECT id, name FROM console.project WHERE id=$1",
                                   project_id)
    await log_activity(user=user, verb="added a note",
                       detail=(text[:60] or (file.filename if has_file else "")),
                       project={"id": project["id"], "name": project["name"]})
    return _note_row(full)


@app.delete("/api/notes/{note_id}")
async def delete_note(note_id: str, user: User = Depends(current_user)) -> dict:
    """Your own note, or anyone's if you maintain the project. A note is somebody
    speaking to the next presenter; a passer-by does not get to edit that."""
    pool = await db()
    async with pool.acquire() as c:
        row = await c.fetchrow(
            "SELECT n.*, p.name AS project_name FROM console.note n "
            "JOIN console.project p ON p.id = n.project_id WHERE n.id=$1", note_id)
        if not row:
            raise HTTPException(404, "no such note")
        if row["author_sub"] != user.sub:
            await require_role(user, str(row["project_id"]), "maintainer")
        else:
            await require_role(user, str(row["project_id"]), "viewer")
        await c.execute("DELETE FROM console.note WHERE id=$1", note_id)
    await log_activity(user=user, verb="removed a note",
                       detail=(row["body"] or "")[:60],
                       project={"id": row["project_id"], "name": row["project_name"]})
    return {"ok": True}


# ── the demo contract, proxied ──────────────────────────────────────────────
# Every call to a project's agent goes through here, server-side, so the shared
# secret never reaches a browser and every mutation lands in the activity log.

async def _agent(project_id: str) -> tuple[dict, str, str]:
    pool = await db()
    async with pool.acquire() as c:
        row = await c.fetchrow("SELECT * FROM console.project WHERE id=$1", project_id)
    if not row:
        raise HTTPException(404, "no such project")
    if not row["agent_url"]:
        raise HTTPException(
            409, "this project has no demo agent — it is a resource folder. Add an "
                 "agent URL in project settings once it implements the demo contract.")
    return _project_row(row), row["agent_url"].rstrip("/"), row["agent_token"] or ""


@app.get("/api/projects/{project_id}/status")
async def project_status(project_id: str, user: User = Depends(current_user)) -> dict:
    await require_role(user, project_id, "viewer")
    try:
        _, base, _tok = await _agent(project_id)
    except HTTPException as exc:
        if exc.status_code == 409:
            return {"state": "no-agent", "ok": False, "components": []}
        raise
    try:
        async with httpx.AsyncClient(timeout=8, verify=_verify_for(base)) as c:
            r = await c.get(f"{base}/api/demo/health")
        return r.json() if r.status_code == 200 else {
            "state": "degraded", "ok": False,
            "components": [{"name": "demo agent", "ok": False,
                            "detail": f"HTTP {r.status_code}"}]}
    except Exception as exc:                                    # noqa: BLE001
        return {"state": "down", "ok": False,
                "components": [{"name": "demo agent", "ok": False, "detail": str(exc)[:120]}]}


@app.get("/api/projects/{project_id}/profiles")
async def project_profiles(project_id: str, user: User = Depends(current_user)) -> dict:
    await require_role(user, project_id, "viewer")
    _, base, _tok = await _agent(project_id)
    try:
        async with httpx.AsyncClient(timeout=8, verify=_verify_for(base)) as c:
            r = await c.get(f"{base}/api/demo/profile")
        return r.json() if r.status_code == 200 else {"active": None, "installed": []}
    except Exception:                                           # noqa: BLE001
        return {"active": None, "installed": []}


class SwapIn(BaseModel):
    profile: str
    layers: list[str] = Field(default_factory=lambda: ["presentation"])


@app.post("/api/projects/{project_id}/profile")
async def swap_profile(project_id: str, body: SwapIn,
                       user: User = Depends(current_user)) -> dict:
    """Switch a project's profile. Maintainer, because it changes what everyone
    else sees."""
    await require_role(user, project_id, "maintainer")
    project, base, token = await _agent(project_id)

    # Refuse if someone else is holding the project. Advisory, but the point is
    # that a collision becomes a conversation rather than a broken demo.
    pool = await db()
    async with pool.acquire() as c:
        hold = await c.fetchrow(
            "SELECT * FROM console.hold WHERE project_id=$1 AND held_until > now()",
            project_id)
    if hold and hold["person_sub"] != user.sub:
        await log_activity(user=user, verb="swapped-profile", result="denied",
                           project=project, detail=f"held by {hold['person_name']}")
        raise HTTPException(
            409, f"{hold['person_name']} is holding this project until "
                 f"{hold['held_until']:%H:%M} — ask them before swapping.")

    try:
        async with httpx.AsyncClient(timeout=30, verify=_verify_for(base)) as c:
            r = await c.post(f"{base}/api/demo/profile",
                             json={"profile": body.profile, "layers": body.layers},
                             headers={"X-Demo-Token": token})
    except Exception as exc:                                    # noqa: BLE001
        await log_activity(user=user, verb="swapped-profile", result="failed",
                           project=project, detail=str(exc)[:200])
        raise HTTPException(502, f"the project's agent did not answer: {exc}")

    body_json = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    ok = r.status_code == 200 and body_json.get("state") in ("succeeded", "partial")
    await log_activity(user=user, verb="swapped-profile",
                       result="ok" if ok else "failed", project=project,
                       detail=f"→ {body.profile} ({', '.join(body.layers)})",
                       payload={"job": body_json.get("id")})
    if r.status_code != 200:
        raise HTTPException(r.status_code, body_json.get("detail") or "the swap was refused")
    return body_json


@app.get("/api/projects/{project_id}/actions")
async def project_actions(project_id: str, user: User = Depends(current_user)) -> dict:
    await require_role(user, project_id, "viewer")
    _, base, _tok = await _agent(project_id)
    try:
        async with httpx.AsyncClient(timeout=8, verify=_verify_for(base)) as c:
            r = await c.get(f"{base}/api/demo/actions")
        return r.json() if r.status_code == 200 else {"actions": []}
    except Exception:                                           # noqa: BLE001
        return {"actions": []}


@app.post("/api/projects/{project_id}/action/{action_id}")
async def run_action(project_id: str, action_id: str,
                     user: User = Depends(current_user)) -> dict:
    """Fire a scripted demo action. Presenter — this is the thing the console
    exists to let a colleague press."""
    await require_role(user, project_id, "presenter")
    project, base, token = await _agent(project_id)
    try:
        async with httpx.AsyncClient(timeout=60, verify=_verify_for(base)) as c:
            r = await c.post(f"{base}/api/demo/action/{action_id}",
                             headers={"X-Demo-Token": token})
    except Exception as exc:                                    # noqa: BLE001
        await log_activity(user=user, verb="ran-action", result="failed",
                           project=project, detail=f"{action_id}: {exc}"[:200])
        raise HTTPException(502, f"the project's agent did not answer: {exc}")
    payload = r.json() if r.status_code == 200 else {}
    await log_activity(user=user, verb="ran-action",
                       result="ok" if r.status_code == 200 else "failed",
                       project=project, detail=action_id)
    if r.status_code != 200:
        raise HTTPException(r.status_code, "the action was refused")
    return payload


# ── holds ───────────────────────────────────────────────────────────────────

class HoldIn(BaseModel):
    minutes: int = Field(default=60, ge=5, le=480)
    reason: str | None = None


@app.post("/api/projects/{project_id}/hold")
async def take_hold(project_id: str, body: HoldIn,
                    user: User = Depends(current_user)) -> dict:
    await require_role(user, project_id, "presenter")
    pool = await db()
    async with pool.acquire() as c:
        existing = await c.fetchrow(
            "SELECT * FROM console.hold WHERE project_id=$1 AND held_until > now()",
            project_id)
        if existing and existing["person_sub"] != user.sub:
            raise HTTPException(409, f"{existing['person_name']} already holds this project")
        row = await c.fetchrow("""
            INSERT INTO console.hold (project_id, person_sub, person_name, reason, held_until)
            VALUES ($1,$2,$3,$4, now() + make_interval(mins => $5))
            ON CONFLICT (project_id) DO UPDATE
               SET person_sub = EXCLUDED.person_sub, person_name = EXCLUDED.person_name,
                   reason = EXCLUDED.reason, held_from = now(),
                   held_until = EXCLUDED.held_until
            RETURNING *
        """, project_id, user.sub, user.full_name or user.username, body.reason, body.minutes)
    return {"by": row["person_name"], "until": row["held_until"].isoformat(),
            "reason": row["reason"]}


@app.delete("/api/projects/{project_id}/hold")
async def release_hold(project_id: str, user: User = Depends(current_user)) -> dict:
    await require_role(user, project_id, "presenter")
    pool = await db()
    async with pool.acquire() as c:
        await c.execute(
            "DELETE FROM console.hold WHERE project_id=$1 AND (person_sub=$2 OR $3)",
            project_id, user.sub, user.org_role == "admin")
    return {"ok": True}


# ── resources ───────────────────────────────────────────────────────────────

class ResourceIn(BaseModel):
    kind: str = Field(pattern=r"^(deck|doc|video|image|link|code|other)$")
    title: str = Field(min_length=1, max_length=200)
    note: str | None = None
    url: str | None = None
    ordering: int = 100


@app.post("/api/projects/{project_id}/resources")
async def add_resource(project_id: str, body: ResourceIn,
                       user: User = Depends(current_user)) -> dict:
    await require_role(user, project_id, "maintainer")
    if not body.url:
        raise HTTPException(400, "a link resource needs a url; file upload is a "
                                 "separate endpoint")
    pool = await db()
    async with pool.acquire() as c:
        row = await c.fetchrow("""
            INSERT INTO console.resource
                (project_id, kind, title, note, url, ordering, uploaded_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
        """, project_id, body.kind, body.title, body.note, body.url,
             body.ordering, user.sub)
        project = await c.fetchrow("SELECT id, name FROM console.project WHERE id=$1",
                                   project_id)
    await log_activity(user=user, verb="added-resource", detail=body.title,
                       project={"id": project["id"], "name": project["name"]})
    return {**dict(row), "id": str(row["id"]), "project_id": str(row["project_id"]),
            "created_at": row["created_at"].isoformat()}


# ── uploaded files ──────────────────────────────────────────────────────────

def _store_path(key: str) -> Path:
    """Resolve an object key under the data directory, refusing to escape it."""
    p = (DATA_DIR / key).resolve()
    if DATA_DIR.resolve() not in p.parents and p != DATA_DIR.resolve():
        raise HTTPException(400, "bad object key")
    return p


async def _render_pdf(src: Path) -> str | None:
    """Convert an office file to PDF beside it, and return the rendition's key.

    Best effort by design: no LibreOffice means no preview, which the interface
    reports plainly. It must never stop an upload — the file itself is the thing
    the person came to store."""
    soffice = _soffice()
    if not soffice:
        return None
    import asyncio
    import tempfile
    out = src.parent
    # LibreOffice insists on a writable user installation, and the service user
    # has no home. A throwaway profile per conversion solves that AND the other
    # failure this hits in a server: two conversions at once contend for one
    # profile's lock and the second dies.
    with tempfile.TemporaryDirectory(prefix="lo-") as profile:
        try:
            proc = await asyncio.create_subprocess_exec(
                soffice, f"-env:UserInstallation=file://{profile}",
                "--headless", "--norestore", "--invisible", "--nolockcheck",
                "--convert-to", "pdf", "--outdir", str(out), str(src),
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                env={**os.environ, "HOME": profile})
            outp, _ = await asyncio.wait_for(proc.communicate(), timeout=180)
            if proc.returncode != 0:
                log.warning("console: soffice exited %s for %s: %s",
                            proc.returncode, src.name, (outp or b"").decode()[:300])
        except Exception:                                       # noqa: BLE001
            log.warning("console: could not render %s to pdf", src.name, exc_info=True)
            return None
    pdf = out / (src.stem + ".pdf")
    return str(pdf.relative_to(DATA_DIR)) if pdf.is_file() else None


@app.post("/api/projects/{project_id}/resources/upload")
async def upload_resource(project_id: str, request: Request,
                          file: UploadFile = File(...),
                          title: str = Form(""), note: str = Form(""),
                          kind: str = Form(""), folder_id: str = Form(""),
                          rel_path: str = Form(""),
                          user: User = Depends(current_user)) -> dict:
    """Store one file. A folder upload is this, once per file in it, with the
    path the browser reports kept as the note — which is how the shelf stays a
    flat list of things people can open rather than a tree nobody navigates."""
    await require_role(user, project_id, "maintainer")
    pool = await db()
    async with pool.acquire() as c:
        here = await _folder_in(c, project_id, folder_id or None)
        dest = here["id"] if here else None
        # A folder upload sends each file with the path the browser reports
        # (`webkitRelativePath`). Rebuilding that tree here is what makes
        # "upload a folder" put a folder on the shelf rather than a flat heap of
        # files whose names happen to contain slashes.
        if rel_path:
            dest = await _ensure_path(c, project_id, dest, rel_path, user)
    stored = await _store_upload(project_id, file, title=title, note=note,
                                 kind=kind, user=user, folder_id=dest)
    async with pool.acquire() as c:
        project = await c.fetchrow("SELECT id, name FROM console.project WHERE id=$1",
                                   project_id)
    await log_activity(user=user, verb="added resource", detail=stored["title"],
                       project={"id": project["id"], "name": project["name"]})
    return {k: stored[k] for k in ("id", "mime", "size_bytes", "previewable")}


async def _ensure_path(c: asyncpg.Connection, project_id: str, parent,
                       rel_path: str, user: User):
    """Create (or find) the folder chain a browser reported for one file.

    `rel_path` is `webkitRelativePath`, which includes the file's own name — the
    last segment is dropped. Segments are matched case-insensitively against
    what is already there, so re-uploading a folder merges into it rather than
    creating a second one beside it with different capitalisation."""
    parts = [seg.strip() for seg in rel_path.replace("\\", "/").split("/")[:-1]]
    for seg in [x for x in parts if x and x not in (".", "..")][:12]:
        found = await c.fetchrow("""
            SELECT * FROM console.folder
            WHERE project_id=$1 AND parent_id IS NOT DISTINCT FROM $2 AND lower(name)=lower($3)
        """, project_id, parent, seg)
        if found:
            parent = found["id"]
            continue
        made = await c.fetchrow("""
            INSERT INTO console.folder (project_id, parent_id, name, created_by)
            VALUES ($1,$2,$3,$4) RETURNING id
        """, project_id, parent, seg, user.sub)
        parent = made["id"]
    return parent


async def _store_upload(project_id: str, file: UploadFile, *, title: str = "",
                        note: str = "", kind: str = "", user: User,
                        folder_id=None) -> dict:
    """Take one uploaded file to rest: on disk, rendered if it can be, and a row
    in console.resource. Both the resources shelf and a note's attachment come
    through here, so an attachment gets the same size limit, the same PDF
    rendition and the same range-serving as anything else — rather than a second
    path that quietly does less."""
    raw = await file.read()
    if len(raw) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"that file is over the {MAX_UPLOAD_MB}MB limit")
    if not raw:
        raise HTTPException(400, "that file is empty")

    import mimetypes
    mime = file.content_type or mimetypes.guess_type(file.filename or "")[0] \
        or "application/octet-stream"
    safe = "".join(c for c in (file.filename or "file")
                   if c.isalnum() or c in "._- ").strip() or "file"
    folder = DATA_DIR / project_id
    folder.mkdir(parents=True, exist_ok=True)
    key_dir = uuid.uuid4().hex[:12]
    (folder / key_dir).mkdir()
    dest = folder / key_dir / safe
    dest.write_bytes(raw)
    key = str(dest.relative_to(DATA_DIR))

    preview_key = await _render_pdf(dest) if mime in CONVERTIBLE else None

    guessed = ("video" if mime.startswith("video/") else
               "image" if mime.startswith("image/") else
               "deck" if "presentation" in mime or "powerpoint" in mime else
               "doc")
    pool = await db()
    async with pool.acquire() as c:
        row = await c.fetchrow("""
            INSERT INTO console.resource
                (project_id, folder_id, kind, title, note, object_key, mime, size_bytes,
                 preview_key, uploaded_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            RETURNING id
        """, project_id, folder_id, kind or guessed, title.strip() or safe,
             note.strip() or None, key, mime, len(raw), preview_key, user.sub)
    return {"id": str(row["id"]), "title": title.strip() or safe, "mime": mime,
            "size_bytes": len(raw),
            "previewable": bool(preview_key) or mime in INLINE_TYPES}


@app.get("/api/resources/{resource_id}/file")
async def resource_file(resource_id: str, request: Request, preview: int = 0,
                        download: int = 0,
                        user: User = Depends(current_user)) -> Response:
    """Serve the bytes. Honours Range, because a video the operator cannot seek
    is a video they will not use in front of a client."""
    pool = await db()
    async with pool.acquire() as c:
        r = await c.fetchrow("SELECT * FROM console.resource WHERE id=$1", resource_id)
    if not r:
        raise HTTPException(404, "no such resource")
    await require_role(user, str(r["project_id"]), "viewer")

    key, mime = r["object_key"], r["mime"] or "application/octet-stream"
    if preview and r["preview_key"]:
        key, mime = r["preview_key"], "application/pdf"
    if not key:
        raise HTTPException(409, "this resource is a link, not a stored file")
    path = _store_path(key)
    if not path.is_file():
        raise HTTPException(410, "the stored file is missing")

    inline = (not download) and (mime in INLINE_TYPES)
    disp = "inline" if inline else "attachment"
    name = path.name if not (preview and r["preview_key"]) else path.stem + ".pdf"
    size = path.stat().st_size
    headers = {
        "Content-Disposition": f'{disp}; filename="{name}"',
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=300",
    }

    rng = request.headers.get("range")
    if rng and rng.startswith("bytes="):
        try:
            first, _, last = rng[6:].partition("-")
            start = int(first) if first else 0
            end = int(last) if last else size - 1
            end = min(end, size - 1)
            if start > end:
                raise ValueError
        except ValueError:
            raise HTTPException(416, "bad range")
        with path.open("rb") as fh:
            fh.seek(start)
            chunk = fh.read(end - start + 1)
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        return Response(chunk, status_code=206, media_type=mime, headers=headers)

    return FileResponse(path, media_type=mime, headers=headers, filename=None)


@app.delete("/api/resources/{resource_id}")
async def delete_resource(resource_id: str, user: User = Depends(current_user)) -> dict:
    pool = await db()
    async with pool.acquire() as c:
        row = await c.fetchrow("""
            SELECT r.*, p.name AS project_name FROM console.resource r
            JOIN console.project p ON p.id = r.project_id WHERE r.id=$1
        """, resource_id)
        if not row:
            raise HTTPException(404, "no such resource")
        await require_role(user, str(row["project_id"]), "maintainer")
        await c.execute("DELETE FROM console.resource WHERE id=$1", resource_id)
    # The bytes go with the row. A volume that only ever grows is a volume that
    # fills, and nothing else references these files.
    for key in (row["object_key"], row["preview_key"]):
        if not key:
            continue
        try:
            path = _store_path(key)
            path.unlink(missing_ok=True)
            if path.parent != DATA_DIR and not any(path.parent.iterdir()):
                path.parent.rmdir()
        except Exception:                                       # noqa: BLE001
            log.warning("console: could not remove %s", key, exc_info=True)
    await log_activity(user=user, verb="removed-resource", detail=row["title"],
                       project={"id": row["project_id"], "name": row["project_name"]})
    return {"ok": True}


# ── my own account ──────────────────────────────────────────────────────────

class ProfileIn(BaseModel):
    full_name: str = Field(default="", max_length=120)
    email: str = Field(default="", max_length=180)


class ChangePasswordIn(BaseModel):
    current: str
    password: str


@app.get("/api/me/account")
async def my_account(user: User = Depends(current_user)) -> dict:
    """What KIND of account this is. The Settings screen needs it to know whether
    to offer a password at all — an SSO identity has none to change here."""
    pool = await db()
    async with pool.acquire() as c:
        row = await c.fetchrow("""
            SELECT status, org_role, (password_hash IS NOT NULL) AS local_account,
                   first_seen
            FROM console.person WHERE kc_sub=$1
        """, user.sub)
    return {"local_account": bool(row and row["local_account"]),
            "status": row["status"] if row else "active",
            "org_role": row["org_role"] if row else user.org_role,
            "since": row["first_seen"].isoformat() if row else None}


@app.patch("/api/me")
async def update_me(body: ProfileIn, user: User = Depends(current_user)) -> dict:
    pool = await db()
    async with pool.acquire() as c:
        try:
            await c.execute("UPDATE console.person SET full_name=$2, email=$3 WHERE kc_sub=$1",
                            user.sub, body.full_name.strip(), body.email.strip().lower())
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "another account already uses that email")
        row = await c.fetchrow("SELECT * FROM console.person WHERE kc_sub=$1", user.sub)
    fresh = _user_from_row(row)
    # The session carries the identity; leaving it stale would show the old name
    # in the topbar until the next sign-in.
    for sess in _sessions.values():
        if (sess.get("user") or {}).get("sub") == user.sub:
            sess["user"] = fresh.model_dump()
    await log_activity(user=fresh, verb="updated-profile")
    return fresh.model_dump()


@app.post("/api/me/password")
async def change_my_password(body: ChangePasswordIn, request: Request,
                             user: User = Depends(current_user)) -> dict:
    if (why := password_problem(body.password)):
        raise HTTPException(400, why)
    pool = await db()
    async with pool.acquire() as c:
        row = await c.fetchrow("SELECT password_hash FROM console.person WHERE kc_sub=$1",
                               user.sub)
        if not row or not row["password_hash"]:
            raise HTTPException(409, "this account signs in through single sign-on, "
                                     "so its password lives there")
        if not verify_password(body.current, row["password_hash"]):
            await log_activity(user=user, verb="change-password-failed", result="denied")
            raise HTTPException(403, "the current password is not right")
        await c.execute("UPDATE console.person SET password_hash=$2 WHERE kc_sub=$1",
                        user.sub, hash_password(body.password))
    # Every other place this person is signed in goes with the old password.
    _drop_sessions(user.sub, keep=request.cookies.get(SESSION_COOKIE))
    await log_activity(user=user, verb="changed-password")
    return {"ok": True}


# ── activity + access ───────────────────────────────────────────────────────

@app.get("/api/activity")
async def activity(limit: int = 80, user: User = Depends(current_user)) -> dict:
    """The estate-wide log. Admin only — it names every person and every project,
    including the ones the caller has no grant on. A project's own history is on
    the project, where the grant already gates it."""
    if user.org_role != "admin":
        raise HTTPException(403, "only a console admin can read the estate-wide log")
    pool = await db()
    async with pool.acquire() as c:
        rows = await c.fetch("""
            SELECT at, person_name, project_name, verb, detail, result
            FROM console.activity ORDER BY at DESC LIMIT $1
        """, min(limit, 300))
    return {"activity": [{**dict(r), "at": r["at"].isoformat()} for r in rows]}


def _require_console_admin(user: User) -> None:
    if user.org_role != "admin":
        raise HTTPException(403, "this is a console-admin area")


@app.get("/api/people")
async def people(user: User = Depends(current_user)) -> dict:
    _require_console_admin(user)
    pool = await db()
    async with pool.acquire() as c:
        rows = await c.fetch("""
            SELECT p.kc_sub, p.username, p.full_name, p.email, p.org_role, p.status,
                   p.first_seen, p.last_seen,
                   (p.password_hash IS NOT NULL) AS local_account,
                   count(g.project_id) AS projects
            FROM console.person p
            LEFT JOIN console.grant g ON g.person_sub = p.kc_sub
            GROUP BY p.kc_sub ORDER BY p.full_name NULLS LAST, p.username
        """)
        grants = await c.fetch("""
            SELECT g.person_sub, g.role, pr.id, pr.name
            FROM console.grant g JOIN console.project pr ON pr.id = g.project_id
            ORDER BY pr.name
        """)
    by_person: dict[str, list[dict]] = {}
    for g in grants:
        by_person.setdefault(g["person_sub"], []).append(
            {"project_id": str(g["id"]), "project_name": g["name"], "role": g["role"]})
    return {"people": [{**dict(r),
                        "kc_sub": r["kc_sub"],
                        "first_seen": r["first_seen"].isoformat(),
                        "last_seen": r["last_seen"].isoformat(),
                        "grants": by_person.get(r["kc_sub"], [])} for r in rows]}


class OrgRoleIn(BaseModel):
    org_role: str = Field(pattern=r"^(member|admin)$")


@app.post("/api/people/{sub}/org-role")
async def set_org_role(sub: str, body: OrgRoleIn, request: Request,
                       user: User = Depends(current_user)) -> dict:
    _require_console_admin(user)
    pool = await db()
    async with pool.acquire() as c:
        async with c.transaction():
            target = await c.fetchrow("SELECT * FROM console.person WHERE kc_sub=$1", sub)
            if not target:
                raise HTTPException(404, "no such person")
            if target["org_role"] == body.org_role:
                return {"ok": True, "unchanged": True}   # nothing to do, nobody to sign out
            # Never leave the console with nobody who can administer it.
            if target["org_role"] == "admin" and body.org_role != "admin":
                admins = await c.fetchval(
                    "SELECT count(*) FROM console.person WHERE org_role='admin' AND status='active'")
                if admins <= 1:
                    raise HTTPException(409, "this is the last console admin — promote "
                                             "somebody else first")
            await c.execute("UPDATE console.person SET org_role=$2 WHERE kc_sub=$1",
                            sub, body.org_role)
    # The new role applies now rather than at the next sign-in. Changing your
    # OWN role keeps the browser you are typing in — signing yourself out for
    # editing your own row is a surprise, not a safeguard.
    _drop_sessions(sub, keep=request.cookies.get(SESSION_COOKIE) if sub == user.sub else None)
    await log_activity(user=user, verb="set-console-role",
                       detail=f"{target['username']} → {body.org_role}")
    return {"ok": True}


class StatusIn(BaseModel):
    status: str = Field(pattern=r"^(active|disabled)$")


@app.post("/api/people/{sub}/status")
async def set_status(sub: str, body: StatusIn, user: User = Depends(current_user)) -> dict:
    _require_console_admin(user)
    if sub == user.sub and body.status == "disabled":
        raise HTTPException(409, "disabling your own account would lock you out")
    pool = await db()
    async with pool.acquire() as c:
        async with c.transaction():
            target = await c.fetchrow("SELECT * FROM console.person WHERE kc_sub=$1", sub)
            if not target:
                raise HTTPException(404, "no such person")
            if target["status"] == body.status:
                return {"ok": True, "unchanged": True}
            if target["org_role"] == "admin" and body.status == "disabled":
                admins = await c.fetchval(
                    "SELECT count(*) FROM console.person WHERE org_role='admin' AND status='active'")
                if admins <= 1:
                    raise HTTPException(409, "this is the last active console admin")
            await c.execute("UPDATE console.person SET status=$2 WHERE kc_sub=$1",
                            sub, body.status)
    if body.status == "disabled":
        _drop_sessions(sub)
    await log_activity(user=user, verb="set-account-status",
                       detail=f"{target['username']} → {body.status}")
    return {"ok": True}


@app.post("/api/people/{sub}/reset-link")
async def admin_reset_link(sub: str, user: User = Depends(current_user)) -> dict:
    """Issue a single-use reset link for somebody else. This is how a console
    with no mail relay gets a person back in: the admin hands over the link."""
    _require_console_admin(user)
    pool = await db()
    async with pool.acquire() as c:
        target = await c.fetchrow("SELECT * FROM console.person WHERE kc_sub=$1", sub)
        if not target:
            raise HTTPException(404, "no such person")
        if not target["password_hash"]:
            raise HTTPException(409, "this account signs in through single sign-on — "
                                     "reset it there")
        token = await _issue_reset(c, sub, user.sub)
    link = _reset_link(token)
    emailed = _send_reset_email(target["email"] or "", link)
    await log_activity(user=user, verb="issued-reset-link",
                       detail=f"{target['username']}{' (emailed)' if emailed else ''}")
    return {"link": link, "emailed": emailed, "expires_in_minutes": RESET_TTL_MIN,
            "username": target["username"]}


class GrantIn(BaseModel):
    person_sub: str
    role: str = Field(pattern=r"^(viewer|presenter|maintainer|admin)$")


@app.post("/api/projects/{project_id}/grants")
async def add_grant(project_id: str, body: GrantIn,
                    user: User = Depends(current_user)) -> dict:
    await require_role(user, project_id, "admin")
    pool = await db()
    async with pool.acquire() as c:
        await c.execute("""
            INSERT INTO console.grant (person_sub, project_id, role, granted_by)
            VALUES ($1,$2,$3,$4)
            ON CONFLICT (person_sub, project_id) DO UPDATE SET role = EXCLUDED.role
        """, body.person_sub, project_id, body.role, user.sub)
        project = await c.fetchrow("SELECT id, name FROM console.project WHERE id=$1",
                                   project_id)
        # The log is read by people, so it names the person. A subject id in the
        # detail column is a row nobody can act on without a second lookup.
        who = await c.fetchval(
            "SELECT coalesce(nullif(full_name, ''), username) FROM console.person WHERE kc_sub=$1",
            body.person_sub) or body.person_sub
    await log_activity(user=user, verb="granted-access",
                       detail=f"{who} — {body.role}",
                       project={"id": project["id"], "name": project["name"]})
    return {"ok": True}


@app.delete("/api/projects/{project_id}/grants/{person_sub}")
async def revoke_grant(project_id: str, person_sub: str,
                       user: User = Depends(current_user)) -> dict:
    await require_role(user, project_id, "admin")
    pool = await db()
    async with pool.acquire() as c:
        gone = await c.fetchval("""
            DELETE FROM console.grant WHERE person_sub=$1 AND project_id=$2
            RETURNING role
        """, person_sub, project_id)
        project = await c.fetchrow("SELECT id, name FROM console.project WHERE id=$1",
                                   project_id)
        who = await c.fetchval(
            "SELECT coalesce(nullif(full_name, ''), username) FROM console.person WHERE kc_sub=$1",
            person_sub) or person_sub
    if not gone:
        raise HTTPException(404, "that person has no grant on this project")
    await log_activity(user=user, verb="revoked-access",
                       detail=f"{who} — {gone}",
                       project={"id": project["id"], "name": project["name"]})
    return {"ok": True}


# ── static ──────────────────────────────────────────────────────────────────

@app.get("/health")
async def health() -> dict:
    return {"ok": True, "db": _pool is not None}


if WEB.is_dir():
    app.mount("/assets", StaticFiles(directory=WEB / "assets"), name="assets")


@app.get("/{path:path}")
async def spa(path: str, request: Request) -> Response:
    """Serve the app shell for anything that is not an API route — the SPA owns
    its own routing."""
    if path.startswith(("api/", "auth/")):
        raise HTTPException(404, "no such endpoint")
    candidate = WEB / path
    if path and candidate.is_file() and WEB.resolve() in candidate.resolve().parents:
        return FileResponse(candidate)
    index = WEB / "index.html"
    if not index.is_file():
        return JSONResponse({"detail": "UI not built into this image"}, status_code=500)
    return FileResponse(index)
