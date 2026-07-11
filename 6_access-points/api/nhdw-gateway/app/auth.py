"""JWT validation against Keycloak (with dev / demo fallbacks).

Three credential paths, highest-priority first:

  1. PAT      — `Authorization: Bearer nhdw_pat_<prefix>_<secret>`.
                Looked up in ops_perm.api_token; scope narrows the user.

  2. JWT      — `Authorization: Bearer <keycloak access token>`. Validated
                against the issuer's JWKS. The token's `iss` claim picks
                which realm (= which JWKS) to verify against; only
                issuers listed in `settings.KEYCLOAK_ALLOWED_ISSUERS` are
                accepted. JWKS is fetched on demand and cached per-iss.

  3. Mock     — `X-Mock-User: <kc_sub>` + `X-Mock-Role: R-…` headers.
                Active in either of two modes:
                  · `DEV_AUTH=true`  → general dev convenience
                  · `GATEWAY_DEMO_IMPERSONATION=true` → demo dashboard
                    triggers impersonate arbitrary roles to show what
                    different operators see (off by default).
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

import httpx
from fastapi import Header, HTTPException, Request

from .settings import settings

log = logging.getLogger("gateway.auth")

# Per-issuer JWKS cache. Keyed by the token's `iss` claim. Refreshed on
# signature failure via _invalidate_jwks(iss).
_jwks_by_iss: dict[str, dict[str, Any]] = {}


def _allowed_issuers() -> set[str]:
    return {s.strip() for s in settings.KEYCLOAK_ALLOWED_ISSUERS.split(",")
            if s.strip()}


@dataclass(frozen=True)
class UserCtx:
    kc_sub: str
    username: str
    realm: str
    primary_role: str
    roles: list[str]
    email: str = ""
    full_name: str = ""
    locale: str = "en"
    geographies: list[str] = field(default_factory=list)
    programs: list[str] = field(default_factory=list)
    purpose_of_use: str = "public-health"
    # Federated-identity trust tier (P1.3). `idp` = the brokering IdP alias (empty
    # for direct password logins); `idp_trust` ∈ {high, low}. Internal credentials
    # (password login, PAT, dev/mock) are "high"; a low-trust federated login
    # (e.g. public Google) is stamped "low" by a Keycloak mapper and gated off
    # sensitive actions by the OPA trust guard. Absent claim ⇒ "high" (fail-open
    # for internal identities, never for the low-trust federated ones which are
    # explicitly stamped).
    idp: str = ""
    idp_trust: str = "high"
    # A PAT's declared scope, normalised to user_scope kinds ({geography, programme}
    # → value lists), or None for interactive principals. permissions.
    # effective_user_scope AND-intersects it with the owner's DB scope so a key can
    # only NARROW (never widen) its owner's data reach.
    token_scope: dict[str, list[str]] | None = None

    def scope_dict(self) -> dict[str, Any]:
        return {
            "geographies": list(self.geographies),
            "programs": list(self.programs),
            "purpose_of_use": self.purpose_of_use,
            "role": self.primary_role,
        }


def _internal_url_for_iss(iss: str) -> str:
    """Rewrite an external issuer URL to the internal-network equivalent
    the gateway can actually reach. Tokens carry Keycloak's KC_HOSTNAME
    (e.g. http://127.0.0.1:8090/realms/X) but the gateway lives inside
    the docker network where 127.0.0.1 is itself, not the host."""
    pub = settings.KEYCLOAK_PUBLIC_BASE.rstrip("/")
    intl = settings.KEYCLOAK_INTERNAL_BASE.rstrip("/")
    if iss.startswith(pub):
        return intl + iss[len(pub):]
    return iss


async def _load_jwks_for_iss(iss: str) -> dict[str, Any]:
    """Fetch + cache the JWKS for one issuer (= realm). Rewrites the
    well-known URL to the internal-network host before fetching."""
    cached = _jwks_by_iss.get(iss)
    if cached is not None:
        return cached
    internal = _internal_url_for_iss(iss)
    async with httpx.AsyncClient(timeout=5) as c:
        disc = (await c.get(
            f"{internal}/.well-known/openid-configuration")).json()
        # The discovery doc points at the public jwks_uri; rewrite the
        # same way before fetching.
        jwks_uri = _internal_url_for_iss(disc["jwks_uri"])
        jwks = (await c.get(jwks_uri)).json()
    _jwks_by_iss[iss] = jwks
    return jwks


def _invalidate_jwks(iss: str) -> None:
    _jwks_by_iss.pop(iss, None)


def _dev_user(x_mock_user: str | None, x_mock_role: str | None) -> UserCtx:
    if not x_mock_user:
        # Anonymous: useful for the public dashboard.
        return UserCtx(
            kc_sub="", username="anonymous", realm="public",
            primary_role="R-PUB-ANON", roles=["R-PUB-ANON"])
    role = x_mock_role or "R-DEV"
    return UserCtx(
        kc_sub=x_mock_user, username=f"dev:{x_mock_user[:8]}",
        realm="dev", primary_role=role, roles=[role],
        full_name=f"Dev user {x_mock_user[:8]}")


async def get_user(
    request: Request,
    authorization: str | None = Header(default=None),
    x_mock_user: str | None = Header(default=None, alias="X-Mock-User"),
    x_mock_role: str | None = Header(default=None, alias="X-Mock-Role"),
    x_mock_secret: str | None = Header(default=None, alias="X-Mock-Secret"),
    x_act_as_owner: str | None = Header(default=None, alias="X-Act-As-Owner"),
) -> UserCtx:
    """FastAPI dependency: returns UserCtx for the calling principal.
    See module docstring for the three credential paths."""
    # PAT — always honoured (it's a real credential, not a dev convenience).
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1]
        if token.startswith("nhdw_pat_"):
            return await _pat_user(token, request, act_as_owner=x_act_as_owner)
    else:
        token = ""

    # JWT — verify against the issuer's JWKS.
    if token:
        return await _jwt_user(token)

    # Mock — dev convenience OR demo-impersonation channel.
    if x_mock_user or x_mock_role:
        # DEV_AUTH: local, no-Keycloak dev — header-only (never exposed).
        if settings.DEV_AUTH:
            return _dev_user(x_mock_user, x_mock_role)
        # Deployed demo impersonation: the gateway ingress is reachable, so the
        # X-Mock-* channel is gated by the shared secret — otherwise any caller
        # could claim R-SUPER. Empty secret ⇒ channel disabled (fail-secure).
        if (settings.GATEWAY_DEMO_IMPERSONATION
                and settings.GATEWAY_IMPERSONATION_SECRET
                and x_mock_secret == settings.GATEWAY_IMPERSONATION_SECRET):
            return _dev_user(x_mock_user, x_mock_role)
        # enabled-but-missing/bad secret, or impersonation off → do not honor.
    elif settings.DEV_AUTH or settings.GATEWAY_PUBLIC_ANON:
        # No credential at all → the anonymous public tier (R-PUB-ANON). Enabled
        # either by DEV_AUTH (local) or GATEWAY_PUBLIC_ANON (deployed public
        # portal). R-PUB-ANON is locked to the public widgets + aggregate/k≥5
        # data by widget-grants + OPA, so this exposes nothing sensitive.
        return _dev_user(None, None)                        # public R-PUB-ANON

    raise HTTPException(401, "Bearer token required")


async def _jwt_user(token: str) -> UserCtx:
    try:
        from jose import jwt
    except ImportError as e:
        raise HTTPException(500, f"jose not installed: {e}")

    try:
        unverified_header = jwt.get_unverified_header(token)
        unverified_claims = jwt.get_unverified_claims(token)
    except Exception as e:                                  # noqa: BLE001
        raise HTTPException(401, f"Malformed token: {e}")

    iss = unverified_claims.get("iss", "")
    if iss not in _allowed_issuers():
        raise HTTPException(401, f"Issuer not allowed: {iss}")

    jwks = await _load_jwks_for_iss(iss)
    kid = unverified_header.get("kid")
    key = next((k for k in jwks["keys"] if k.get("kid") == kid), None)
    if not key:
        _invalidate_jwks(iss)
        jwks = await _load_jwks_for_iss(iss)
        key = next((k for k in jwks["keys"] if k.get("kid") == kid), None)
        if not key:
            raise HTTPException(401, "Unknown signing key")

    accepted_aud = [a.strip() for a in
                    [settings.KEYCLOAK_AUDIENCE,
                     *settings.KEYCLOAK_EXTRA_AUDIENCES.split(",")]
                    if a.strip()]
    claims = None
    last_err: Exception | None = None
    for aud in accepted_aud:
        try:
            claims = jwt.decode(token, key,
                                algorithms=[unverified_header["alg"]],
                                audience=aud,
                                options={"verify_at_hash": False})
            break
        except Exception as exc:                            # noqa: BLE001
            last_err = exc
    if claims is None:
        raise HTTPException(401, f"Invalid token: {last_err}")

    # Role source, in order: the standard realm_access.roles (present when the
    # builtin 'roles' scope exists), else the system's own nhdw-flat-roles
    # top-level `roles` claim (a DEFAULT client scope on every dashboard
    # client — the minimal seeded realm has no builtin roles scope, so this
    # flat claim is what real tokens actually carry).
    realm_roles = ((claims.get("realm_access") or {}).get("roles")
                   or claims.get("roles") or [])
    if isinstance(realm_roles, str):          # single-valued mapper edge case
        realm_roles = [realm_roles]
    primary = next((r for r in realm_roles if r.startswith("R-")), "R-UNKNOWN")
    return UserCtx(
        kc_sub=claims.get("sub", ""),
        username=claims.get("preferred_username", ""),
        realm=(claims.get("iss") or "").rsplit("/", 1)[-1],
        primary_role=primary,
        roles=realm_roles,
        email=claims.get("email", ""),
        full_name=claims.get("name", ""),
        locale=claims.get("locale", "en"),
        geographies=list(claims.get("geographies") or []),
        programs=list(claims.get("programs") or []),
        # P1.3: trust tier from the Keycloak mappers (idp_trust) + the broker
        # alias (identity_provider). Direct password logins carry neither → high.
        idp=claims.get("identity_provider", "") or "",
        idp_trust=(claims.get("idp_trust") or "high"),
    )


# ─── PAT validation ────────────────────────────────────────────────────
import hashlib

from . import ops_db


async def _pat_user(token: str, request: Request,
                    act_as_owner: str | None = None) -> UserCtx:
    """Validate a PAT (Personal Access Token) and return its UserCtx.
    Format: nhdw_pat_<prefix>_<secret>. Stored as sha256(secret).
    Scope (when set) narrows the user's geographies/programs — never widens.

    act_as_owner (P1.1): when set, a SERVICE-ACCOUNT token (owner_kc_sub NULL,
    role_code set) carrying the `act_as_owner` capability may name a target owner
    (kc_sub) via the X-Act-As-Owner header. The effective principal becomes that
    owner — resolved with the owner's real active role, identity and DB scope —
    so downstream OPA + effective_user_scope enforce exactly what the owner may
    see. The token's own declared scope still NARROWS the owner (never widens)."""
    parts = token.split("_", 3)
    if len(parts) != 4 or parts[0] != "nhdw" or parts[1] != "pat":
        raise HTTPException(401, "malformed PAT")
    prefix, secret = parts[2], parts[3]
    secret_hash = hashlib.sha256(secret.encode("utf-8")).hexdigest()

    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT t.id, t.owner_kc_sub, t.role_code, t.scope,
                   t.revoked_at, t.expires_at,
                   u.username, u.email, u.full_name, u.realm
              FROM ops_perm.api_token t
              LEFT JOIN ops_identity."user" u ON u.kc_sub = t.owner_kc_sub
             WHERE t.prefix = $1 AND t.secret_hash = $2
        """, prefix, secret_hash)
    if row is None:
        raise HTTPException(401, "invalid PAT")
    if row["revoked_at"] is not None:
        raise HTTPException(401, "PAT revoked")
    if row["expires_at"] is not None and row["expires_at"].timestamp() < _now_ts():
        raise HTTPException(401, "PAT expired")

    # Resolve the role: owner's primary role if user-bound, else the SA role.
    role = row["role_code"]
    if not role and row["owner_kc_sub"]:
        async with pool.acquire() as conn:
            ur = await conn.fetchval("""
                SELECT r.code FROM ops_perm.user_role ur
                  JOIN ops_perm.role r ON r.id = ur.role_id
                 WHERE ur.kc_sub = $1 AND ur.is_active = true
                 ORDER BY ur.granted_at DESC LIMIT 1
            """, row["owner_kc_sub"])
            role = ur or "R-UNKNOWN"
    role = role or "R-UNKNOWN"

    # Narrow scope from the PAT. The declared scope is carried as `token_scope`
    # (user_scope kinds) and AND-intersected with the owner's DB scope in
    # permissions.effective_user_scope — the gateway never widens here.
    scope = row["scope"] or {}
    if isinstance(scope, str):          # asyncpg returns jsonb as a raw string
        try:
            scope = json.loads(scope)
        except Exception:               # noqa: BLE001
            scope = {}
    geos = list(scope.get("geographies") or [])
    progs = list(scope.get("programs") or [])
    _ts: dict[str, list[str]] = {}
    if geos:  _ts["geography"] = geos
    if progs: _ts["programme"] = progs
    token_scope = _ts or None

    # Fire-and-forget audit + last_used update.
    async def _record():
        try:
            async with pool.acquire() as c2:
                await c2.execute("UPDATE ops_perm.api_token SET last_used_at = now() WHERE id = $1",
                                 row["id"])
                await c2.execute("""
                    INSERT INTO ops_perm.api_token_audit
                        (token_id, method, path, status_code, client_ip, user_agent)
                    VALUES ($1, $2, $3, $4, $5::inet, $6)
                """, row["id"], request.method, request.url.path, 0,
                    (request.client.host if request.client else None),
                    request.headers.get("user-agent"))
        except Exception as e:                                # noqa: BLE001
            log.debug("PAT audit write failed: %s", e)
    import asyncio
    asyncio.create_task(_record())

    # ── Act-as-owner (P1.1) ────────────────────────────────────────────────
    if act_as_owner:
        # Only a service-account token (owner_kc_sub NULL, role_code set) may
        # impersonate — a user-bound PAT must never widen to another owner.
        if row["owner_kc_sub"] is not None or not row["role_code"]:
            raise HTTPException(403, "act-as-owner requires a service-account token")
        async with pool.acquire() as conn:
            # Capability MUST be read from ops_perm.role_capability — a service
            # principal's roles list is [role_code], so an in-token cap check
            # would silently never match (privilege-escalation trap avoided).
            has_cap = await conn.fetchval("""
                SELECT EXISTS (
                    SELECT 1 FROM ops_perm.role_capability rc
                      JOIN ops_perm.role r ON r.id = rc.role_id
                     WHERE r.code = $1 AND rc.capability_code = 'act_as_owner')
            """, row["role_code"])
            if not has_cap:
                raise HTTPException(403, "token role lacks capability: act_as_owner")
            # Target must be a real user WITH an active role (else it is an
            # impersonation hole). Reuse the same role-resolution as owner PATs.
            owner = await conn.fetchrow("""
                SELECT u.username, u.email, u.full_name, u.realm,
                       (SELECT r.code FROM ops_perm.user_role ur
                          JOIN ops_perm.role r ON r.id = ur.role_id
                         WHERE ur.kc_sub = u.kc_sub AND ur.is_active = true
                         ORDER BY ur.granted_at DESC LIMIT 1) AS role
                  FROM ops_identity."user" u
                 WHERE u.kc_sub = $1
            """, act_as_owner)
        if owner is None or not owner["role"]:
            raise HTTPException(403, "act-as-owner target is not an active user")
        return UserCtx(
            kc_sub=str(act_as_owner),
            username=owner["username"] or f"act:{str(act_as_owner)[:8]}",
            realm=owner["realm"] or "service",
            primary_role=owner["role"],
            roles=[owner["role"]],
            email=owner["email"] or "",
            full_name=owner["full_name"] or "",
            # geographies/programs left empty on purpose — effective_user_scope
            # loads the OWNER's DB scope by kc_sub and narrows it by token_scope
            # (the SA token's declared scope), so the SA can only restrict.
            token_scope=token_scope,
        )

    return UserCtx(
        kc_sub=str(row["owner_kc_sub"] or ""),
        username=row["username"] or f"pat:{prefix}",
        realm=row["realm"] or "service",
        primary_role=role,
        roles=[role],
        email=row["email"] or "",
        full_name=row["full_name"] or "",
        geographies=geos,
        programs=progs,
        token_scope=token_scope,
    )


def _now_ts() -> float:
    import time as _time
    return _time.time()
