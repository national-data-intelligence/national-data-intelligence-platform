"""Keycloak Admin API client — access-request provisioning (§4.8).

On admin approval, the gateway creates the applicant's Keycloak account, assigns
the granted realm role, and triggers `execute-actions-email(UPDATE_PASSWORD)` so
Keycloak emails a set-password link (via the realm SMTP → external Google relay).

Mirrors the admin-token pattern in `7_security/keycloak/scripts/setup-keycloak.py`
— NO second identity store. Admin creds come from `keycloak-secrets` (the
bootstrap admin), injected into the gateway env — never hardcoded. All calls hit
the INTERNAL Keycloak service URL (the gateway can't reach the browser host).
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from .settings import settings

log = logging.getLogger("gateway.kcadmin")


class KeycloakAdminError(Exception):
    """A Keycloak Admin API call failed (surfaced to the caller as 502)."""


async def _admin_token(client: httpx.AsyncClient) -> str:
    r = await client.post(
        f"{settings.KEYCLOAK_INTERNAL_BASE}/realms/master/protocol/openid-connect/token",
        data={"grant_type": "password", "client_id": "admin-cli",
              "username": settings.KEYCLOAK_ADMIN_USER,
              "password": settings.KEYCLOAK_ADMIN_PASSWORD})
    if r.status_code != 200:
        raise KeycloakAdminError(
            f"admin token request failed: {r.status_code} {r.text[:160]}")
    return r.json()["access_token"]


async def provision_user(*, email: str, full_name: str | None,
                         role: str | None, realm: str | None = None
                         ) -> dict[str, Any]:
    """Create (or reuse) a realm user, assign `role`, and email a set-password
    link. Returns {kc_sub, created, role, emailed, realm, username}.

    Idempotent: an existing user with this email is reused (role re-assigned,
    email re-sent) so a double-approve doesn't error or duplicate."""
    realm = realm or settings.KEYCLOAK_PROVISION_REALM
    base = settings.KEYCLOAK_INTERNAL_BASE
    first, _, last = (full_name or "").strip().partition(" ")
    username = email
    async with httpx.AsyncClient(timeout=30) as c:
        tok = await _admin_token(c)
        h = {"Authorization": f"Bearer {tok}"}

        # 1. create or find the user (KC user id == the future `sub` claim)
        cr = await c.post(f"{base}/admin/realms/{realm}/users", headers=h, json={
            "username": username, "email": email,
            "firstName": first or email.split("@")[0], "lastName": last or "",
            "enabled": True, "emailVerified": False})
        if cr.status_code == 201:
            created = True
            kc_sub = cr.headers.get("location", "").rsplit("/", 1)[-1]
        elif cr.status_code == 409:
            created = False
            found = await c.get(f"{base}/admin/realms/{realm}/users",
                                headers=h, params={"email": email, "exact": "true"})
            arr = found.json() or []
            if not arr:
                raise KeycloakAdminError(
                    "user exists (409) but lookup by email returned none")
            kc_sub = arr[0]["id"]
            username = arr[0].get("username", email)
        else:
            raise KeycloakAdminError(
                f"create user failed: {cr.status_code} {cr.text[:160]}")

        # 2. assign the granted realm role (best-effort — a bad role must not
        #    block the account; it's logged and surfaced in the result).
        role_assigned = False
        if role:
            rr = await c.get(f"{base}/admin/realms/{realm}/roles/{role}", headers=h)
            if rr.status_code == 200:
                ro = rr.json()
                mr = await c.post(
                    f"{base}/admin/realms/{realm}/users/{kc_sub}/role-mappings/realm",
                    headers=h, json=[{"id": ro["id"], "name": ro["name"]}])
                role_assigned = mr.status_code in (204, 200)
            else:
                log.warning("role %s not found in realm %s (%s)",
                            role, realm, rr.status_code)

        # 3. execute-actions-email → the applicant sets their own password.
        ea = await c.put(
            f"{base}/admin/realms/{realm}/users/{kc_sub}/execute-actions-email",
            headers=h, params={"lifespan": 43200}, json=["UPDATE_PASSWORD"])
        emailed = ea.status_code in (200, 204)
        if not emailed:
            log.warning("execute-actions-email failed for %s: %s %s",
                        email, ea.status_code, ea.text[:160])

    return {"kc_sub": kc_sub, "created": created, "role": role,
            "role_assigned": role_assigned, "emailed": emailed,
            "realm": realm, "username": username}


async def send_password_reset(*, realm: str, user_id: str) -> bool:
    """Self-service password reset — trigger execute-actions-email(UPDATE_PASSWORD)
    so the user gets a set-password link (realm SMTP → external Google relay)."""
    base = settings.KEYCLOAK_INTERNAL_BASE
    async with httpx.AsyncClient(timeout=30) as c:
        tok = await _admin_token(c)
        r = await c.put(
            f"{base}/admin/realms/{realm}/users/{user_id}/execute-actions-email",
            headers={"Authorization": f"Bearer {tok}"},
            params={"lifespan": 43200}, json=["UPDATE_PASSWORD"])
    return r.status_code in (200, 204)


async def list_user_sessions(*, realm: str, user_id: str) -> list[dict[str, Any]]:
    """The user's active Keycloak sessions (device / IP / last-access)."""
    base = settings.KEYCLOAK_INTERNAL_BASE
    async with httpx.AsyncClient(timeout=15) as c:
        tok = await _admin_token(c)
        r = await c.get(
            f"{base}/admin/realms/{realm}/users/{user_id}/sessions",
            headers={"Authorization": f"Bearer {tok}"})
    return r.json() if r.status_code == 200 else []
