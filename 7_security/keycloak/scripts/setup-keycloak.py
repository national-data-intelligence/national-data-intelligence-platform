#!/usr/bin/env python3
"""End-to-end Keycloak setup for NHDW dev.

Idempotent. Drives Keycloak's Admin REST API to:

  1. Create missing realm roles (R-SUPER, R-PD-HIV, R-RHB-OROMIA).
  2. Upsert one Keycloak user per row in users.yaml — with the *exact*
     kc_sub UUID from the YAML so nhdw_ops.user lookups by kc_sub stay
     coherent. Sets a universal demo password (`SEED_PASSWORD` env, default
     "demo").
  3. Assign each user's realm roles.
  4. Convert / create dashboard clients as PKCE public clients:
       moh-staff/internal-bi  → public, redirect 8087, +PKCE required
       moh-staff/workshop     → create, public, redirect 8085
       privileged-ops/admin   → create, public, redirect 8086

Run after Keycloak is up:
    cd 7_security/keycloak
    python3 scripts/setup-keycloak.py

Env vars used (with defaults):
    KEYCLOAK_BASE                http://127.0.0.1:8090
    KC_BOOTSTRAP_ADMIN_USERNAME  (from .env)
    KC_BOOTSTRAP_ADMIN_PASSWORD  (from .env)
    SEED_PASSWORD                demo
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import yaml

# Repo root is only used to derive the default users.yaml path. When this
# script is mounted shallow (e.g. /scripts/setup-keycloak.py in a k8s Job),
# parents[3] doesn't exist — fall back to "/" since NHDW_USERS_YAML overrides
# the path anyway in that case.
_parents = Path(__file__).resolve().parents
REPO_ROOT = _parents[3] if len(_parents) > 3 else Path("/")
# Allow env override so this script works both from a host shell AND
# from a k8s Job that mounts users.yaml at a fixed path.
USERS_YAML = Path(os.environ.get(
    "NHDW_USERS_YAML",
    str(REPO_ROOT / "bundle/seeds/security/users.yaml")))
KC_BASE = os.environ.get("KEYCLOAK_BASE", "http://127.0.0.1:8090")
ADMIN_USERNAME = os.environ["KC_BOOTSTRAP_ADMIN_USERNAME"]
ADMIN_PASSWORD = os.environ["KC_BOOTSTRAP_ADMIN_PASSWORD"]
SEED_PASSWORD = os.environ.get("SEED_PASSWORD", "NhdwDemo2026.OK")  # demo-user-secrets/SEED_PASSWORD


# Realm roles that need to exist for users.yaml's assignments to succeed.
# Keycloak's role catalog must be a superset of what the YAML references.
MISSING_REALM_ROLES = {
    # R-SUPER exists in BOTH realms so the cross-realm superadmin test account can
    # hold it on the moh-staff side (internal-bi/workshop) as well as privileged-ops.
    "moh-staff":      ["R-PD-HIV", "R-RHB-OROMIA", "R-SUPER"],
    "privileged-ops": ["R-SUPER"],
}


# Dashboard clients we want present as public PKCE clients.
# `convert_from_confidential`: if True, downgrade an existing confidential
# client to public (used for the pre-existing internal-bi client).
# IdP brokers — federate ONLY the moh-staff realm to: REAL Google (social OIDC,
# Keycloak's built-in `google` provider, creds from keycloak-idp-secrets) and the
# mocked ehia-saml-mock realm (SAML "federation", imported at Keycloak startup).
# There is NO Google mock fallback — if GOOGLE_CLIENT_ID is unset the social
# broker is simply skipped (see _google_configured / main).
#
# SECURITY (plan §B, least-privilege): external IdPs never mint operators/admins.
# The privileged-ops realm (operators, security, super-user) is username/password
# ONLY — no brokered IdP can reach it. A social/federated user lands in moh-staff
# with a minimal read-only role (steward elevates via the access-request flow if
# more is needed); we do NOT auto-grant R-OPS-ADM to whoever clicks "Google".
IDENTITY_PROVIDERS = [
    {
        "into_realm":      "moh-staff",
        "alias":           "google",
        "display":         "Google",
        "kind":            "google",        # Keycloak built-in social provider — REAL Google
        "default_role":    "R-CONS-ANA",   # least-privilege read-only consumer
        # P1.3 trust tier. Public Google — anyone can register any Gmail — so it
        # is LOW trust: email is NOT auto-verified and the OPA trust guard denies
        # its identities every sensitive action (writes + raw PHI).
        "trust_email":     False,
        "trust_tier":      "low",
    },
    {
        "into_realm":      "moh-staff",
        "alias":           "ehia-saml",
        "display":         "EHIA",
        "kind":            "saml",
        "source_realm":    "ehia-saml-mock",
        "default_role":    "R-CONS-RES",   # trusted-partner researcher (non-PHI)
        # Trusted government identity partner → HIGH trust (email verified,
        # no trust-guard restriction beyond its role).
        "trust_email":     True,
        "trust_tier":      "high",
    },
]


# Browser-facing Keycloak base (issuer / IdP-broker URLs). Defaults to the
# dev-compose localhost port; override via env for ingress/hostname deploys.
KC_PUBLIC_BASE = os.environ.get("KC_PUBLIC_BASE", "http://127.0.0.1:8090")

# Real Google OAuth client (from the gitignored keycloak-idp-secrets Secret) for
# the moh-staff "Sign in with Google" broker. When set to a real value, the google
# broker uses REAL Google (accounts.google.com) — there is NO mock fallback. Empty
# or a placeholder → the Google social broker is skipped entirely (login stays
# password + EHIA-federation only; the boot does not break).
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "").strip()
# Confidential OIDC secret for the dbt-docs tool client (both staff realms).
DBT_DOCS_OIDC_SECRET = os.environ.get("DBT_DOCS_OIDC_SECRET", "").strip()
# Confidential OIDC secret for the Airflow webserver's native Keycloak login
# (privileged-ops; Tool-SSO C).
AIRFLOW_OIDC_SECRET = os.environ.get("AIRFLOW_OIDC_SECRET", "").strip()
# Confidential OIDC secret for the in-cluster JupyterHub (moh-staff; #78).
JUPYTERHUB_OIDC_SECRET = os.environ.get("JUPYTERHUB_OIDC_SECRET", "").strip()
# Confidential OIDC secret for Superset's native FAB Keycloak login (moh-staff —
# the analyst audience; #81). Same split-URL/native-OIDC pattern as Airflow.
SUPERSET_OIDC_SECRET = os.environ.get("SUPERSET_OIDC_SECRET", "").strip()
# Confidential OIDC secret for the MinIO console's native OIDC (privileged-ops).
# The console runs AssumeRoleWithWebIdentity against this client → temporary MinIO
# creds mapped to the consoleAdmin policy, so an authenticated operator SSOs in.
MINIO_OIDC_SECRET = os.environ.get("MINIO_OIDC_SECRET", "").strip()
# Confidential OIDC secrets for the nhdw/tool-gate reverse proxies (one per tool
# that has NO own role-aware OIDC — MLflow, Prometheus, Alertmanager, Headlamp).
# Each gate runs its OWN OIDC handshake (/oauth2gate/callback), admitted silently
# off the shared SSO cookie, then enforces per-role access itself. Seeded in BOTH
# staff realms because an ops role (e.g. R-OPS-ENG) can live in moh-staff while
# R-OPS-ADM/R-SUPER live in privileged-ops — the gate accepts a session from
# either and ALLOWED_ROLES does the gating. Secret matches the gate's k8s Secret.
MLFLOW_GATE_OIDC_SECRET       = os.environ.get("MLFLOW_GATE_OIDC_SECRET", "").strip()
PROMETHEUS_GATE_OIDC_SECRET   = os.environ.get("PROMETHEUS_GATE_OIDC_SECRET", "").strip()
ALERTMANAGER_GATE_OIDC_SECRET = os.environ.get("ALERTMANAGER_GATE_OIDC_SECRET", "").strip()
HEADLAMP_GATE_OIDC_SECRET     = os.environ.get("HEADLAMP_GATE_OIDC_SECRET", "").strip()


def _google_configured() -> bool:
    cid = GOOGLE_CLIENT_ID.lower()
    return bool(GOOGLE_CLIENT_ID) and "changeme" not in cid and "todo" not in cid

# Per-dashboard browser-facing base URLs. Default to the dev-compose localhost
# ports; override via env (e.g. nip.io hostnames behind an ingress).
_DASH_BASE = {
    "internal-bi": os.environ.get("DASH_BASE_INTERNAL_BI", "http://127.0.0.1:8087"),
    "workshop":    os.environ.get("DASH_BASE_WORKSHOP",    "http://127.0.0.1:8085"),
    "admin":       os.environ.get("DASH_BASE_ADMIN",       "http://127.0.0.1:8086"),
}


def _client(realm, client_id, base, convert):
    return {
        "realm":        realm,
        "client_id":    client_id,
        "redirect_uri": base.rstrip("/") + "/*",
        "web_origin":   base.rstrip("/"),
        "post_logout_redirect_uri": base.rstrip("/"),
        "convert_from_confidential": convert,
    }


DASHBOARD_CLIENTS = [
    _client("moh-staff",      "internal-bi", _DASH_BASE["internal-bi"], True),
    _client("moh-staff",      "workshop",    _DASH_BASE["workshop"],    False),
    _client("privileged-ops", "admin",       _DASH_BASE["admin"],       False),
]

# Confidential tool clients (dbt-docs, Airflow; Superset/Grafana deferred to v2) —
# each runs its OWN OIDC handshake and is admitted silently off the shared
# Keycloak SSO cookie. dbt-docs is seeded in BOTH staff realms so the redirect
# works whichever realm the user's session is in; Airflow is operator-only
# (privileged-ops). Secret comes from env (matches the tool's k8s Secret).
_DBT_DOCS_BASE = "https://dbt-docs.127.0.0.1.nip.io"
TOOL_CLIENTS = [
    {"realm": "privileged-ops", "client_id": "dbt-docs", "base": _DBT_DOCS_BASE, "secret": DBT_DOCS_OIDC_SECRET},
    {"realm": "moh-staff",      "client_id": "dbt-docs", "base": _DBT_DOCS_BASE, "secret": DBT_DOCS_OIDC_SECRET},
    # (oauth2-proxy client RETIRED 2026-07-11 (#80) — the shared forward-auth is
    #  gone; each tool now fronts itself with a tool-gate or native OIDC.)
    # Airflow native OIDC (privileged-ops). FAB's callback is
    # /oauth-authorized/keycloak (covered by base + /*).
    {"realm": "privileged-ops", "client_id": "airflow",
     "base": "https://airflow.127.0.0.1.nip.io", "secret": AIRFLOW_OIDC_SECRET},
    # JupyterHub (moh-staff — workshop-class users). Callback is
    # /hub/oauth_callback (covered by base + /*). Supersedes the stale
    # compose-era :8089 redirect in the realm-config JSON.
    {"realm": "moh-staff", "client_id": "jupyterhub",
     "base": "https://jupyter.127.0.0.1.nip.io", "secret": JUPYTERHUB_OIDC_SECRET},
    # Superset native FAB OIDC (moh-staff — analyst audience). FAB's callback is
    # /oauth-authorized/keycloak (covered by base + /*). Same pattern as Airflow.
    {"realm": "moh-staff", "client_id": "superset",
     "base": "https://superset.127.0.0.1.nip.io", "secret": SUPERSET_OIDC_SECRET},
    # MinIO console native OIDC (privileged-ops — operator tool). The console's
    # callback is /oauth_callback (covered by base + /*). MinIO server exchanges
    # the code on the INTERNAL keycloak:8080 backchannel (KC_HOSTNAME_BACKCHANNEL_
    # DYNAMIC=true keeps token/jwks internal while auth stays on the public host)
    # and maps the identity to the consoleAdmin policy via ROLE_POLICY.
    {"realm": "privileged-ops", "client_id": "minio-console",
     "base": "https://minio-console.127.0.0.1.nip.io", "secret": MINIO_OIDC_SECRET},
]

# tool-gate clients — the nhdw/tool-gate reverse proxies (main.py). Same
# confidential-client shape as TOOL_CLIENTS, but the gate's callback is
# /oauth2gate/callback (covered by base + /*). Seeded in BOTH staff realms so
# the shared SSO cookie admits whichever realm the operator's session is in
# (an ops role can be in either realm — see the *_GATE_OIDC_SECRET note above).
# The gate's OIDC_CLIENT_ID (tool-gates.yaml) MUST equal client_id here.
_GATE_BASES = {
    "mlflow":       "https://mlflow.127.0.0.1.nip.io",
    "prometheus":   "https://prometheus.127.0.0.1.nip.io",
    "alertmanager": "https://alertmanager.127.0.0.1.nip.io",
    # Headlamp's gate lives at /oauth2gate + /k8s on the ADMIN host (path-routed
    # beside the admin SPA), so its redirect base is the admin host.
    "headlamp":     "https://admin.127.0.0.1.nip.io",
}
_GATE_SECRETS = {
    "mlflow":       MLFLOW_GATE_OIDC_SECRET,
    "prometheus":   PROMETHEUS_GATE_OIDC_SECRET,
    "alertmanager": ALERTMANAGER_GATE_OIDC_SECRET,
    "headlamp":     HEADLAMP_GATE_OIDC_SECRET,
}
GATE_CLIENTS = [
    {"realm": realm, "client_id": cid, "base": _GATE_BASES[cid], "secret": _GATE_SECRETS[cid]}
    for cid in ("mlflow", "prometheus", "alertmanager", "headlamp")
    for realm in ("moh-staff", "privileged-ops")
]


# ──────────────────────────────────────────────────────────────────────────
def login() -> str:
    """Get an admin access token via the master realm."""
    body = urllib.parse.urlencode({
        "grant_type": "password",
        "client_id":  "admin-cli",
        "username":   ADMIN_USERNAME,
        "password":   ADMIN_PASSWORD,
    }).encode()
    req = urllib.request.Request(
        f"{KC_BASE}/realms/master/protocol/openid-connect/token",
        method="POST", data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())["access_token"]


def api(token: str, method: str, path: str, body: dict | list | None = None) -> tuple[int, dict | list | None]:
    """Call the admin API. Returns (status_code, parsed_json_or_None)."""
    data = None
    headers = {"Authorization": f"Bearer {token}"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{KC_BASE}/admin{path}",
                                  method=method, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            payload = json.loads(raw) if raw else None
        except Exception:                                       # noqa: BLE001
            payload = {"raw": raw.decode(errors="replace")}
        return e.code, payload


# ─── realm roles ─────────────────────────────────────────────────────────
def ensure_realm_role(token: str, realm: str, role_name: str) -> None:
    code, _ = api(token, "GET", f"/realms/{realm}/roles/{role_name}")
    if code == 200:
        print(f"    · realm-role exists: {realm}/{role_name}")
        return
    code, payload = api(token, "POST", f"/realms/{realm}/roles",
                         {"name": role_name})
    if code in (201, 204):
        print(f"    ✓ created realm-role: {realm}/{role_name}")
    else:
        print(f"    ✗ failed to create {realm}/{role_name}: {code} {payload}")
        sys.exit(1)


def realm_role_obj(token: str, realm: str, role_name: str) -> dict:
    code, payload = api(token, "GET", f"/realms/{realm}/roles/{role_name}")
    if code != 200:
        raise RuntimeError(f"missing realm role {realm}/{role_name}")
    assert isinstance(payload, dict)
    return payload


# ─── users ───────────────────────────────────────────────────────────────
# Plain POST /admin/realms/{realm}/users ignores any `id` we POST — Keycloak
# auto-assigns a UUID. To pin the user's UUID to the kc_sub in users.yaml
# (so nhdw_ops.user lookups by kc_sub stay coherent) we use partialImport,
# which DOES honour explicit ids.

def import_users_for_realm(token: str, realm: str, users: list[dict]) -> None:
    """Bulk-upsert users via partialImport with skip-on-conflict; followed
    by a per-user password reset (partialImport doesn't take credentials)."""
    if not users:
        return
    # FR7.3 — if any user in this realm carries `mfa: true`, the CONFIGURE_TOTP
    # required-action provider must be REGISTERED in the realm first. These
    # realms are minimal (stripped to webauthn); assigning CONFIGURE_TOTP to a
    # user is a silent no-op unless the provider exists, so register+enable it
    # (idempotent — a 409/exists is fine) before the user import references it.
    if any(u.get("mfa") for u in users):
        api(token, "POST", f"/realms/{realm}/authentication/register-required-action",
            {"providerId": "CONFIGURE_TOTP", "name": "Configure OTP"})
        api(token, "PUT", f"/realms/{realm}/authentication/required-actions/CONFIGURE_TOTP",
            {"alias": "CONFIGURE_TOTP", "name": "Configure OTP", "providerId": "CONFIGURE_TOTP",
             "enabled": True, "defaultAction": False, "priority": 10, "config": {}})
        print(f"    ✓ CONFIGURE_TOTP required-action ensured in {realm} (FR7.3 MFA)")
    # Build the partialImport payload.
    payload = {
        "ifResourceExists": "OVERWRITE",
        "users": [{
            "id":             u["kc_sub"],
            "username":       u["username"],
            "email":          u.get("email", f"{u['username']}@nhdw.local"),
            "firstName":      (u.get("full_name") or u["username"]).split(" ")[0] or u["username"],
            "lastName":       " ".join((u.get("full_name") or u["username"]).split(" ")[1:]) or "Dev",
            "emailVerified":  True,
            "enabled":        True,
            # Explicitly clear required actions so seeded/demo users are never
            # forced into the privileged-ops realm's default passkey registration
            # (webauthn-register-passwordless) on first login. EXCEPTION —
            # `mfa: true` in users.yaml (FR7.3): that user must enrol TOTP at
            # next login (the MFA demo beat; sec.officer carries it).
            "requiredActions": (["CONFIGURE_TOTP"] if u.get("mfa") else []),
            "realmRoles":     u.get("roles", []),
        } for u in users],
    }
    code, resp = api(token, "POST", f"/realms/{realm}/partialImport", payload)
    if code not in (200, 204):
        print(f"    ✗ partialImport {realm}: {code} {resp}")
        sys.exit(1)
    print(f"    ✓ imported {len(users)} users into {realm}")

    # partialImport doesn't carry passwords or finalise role assignments
    # against pre-existing realm roles. Set password + (re)apply roles.
    for u in users:
        kc_sub, username = u["kc_sub"], u["username"]
        code, payload = api(token, "PUT",
                            f"/realms/{realm}/users/{kc_sub}/reset-password",
                            {"type": "password", "value": SEED_PASSWORD,
                             "temporary": False})
        if code not in (204, 200):
            print(f"      ✗ password {realm}/{username}: {code} {payload}")
            sys.exit(1)

        # Refresh role mappings idempotently.
        roles = [realm_role_obj(token, realm, r) for r in u.get("roles", [])]
        if roles:
            code, payload = api(token, "POST",
                                f"/realms/{realm}/users/{kc_sub}/role-mappings/realm",
                                roles)
            if code not in (204, 200):
                print(f"      ✗ roles {realm}/{username}: {code} {payload}")
                sys.exit(1)
        print(f"      ✓ {realm}/{username} ({kc_sub[:8]}…) roles={u.get('roles', [])}")


# ─── identity-provider brokers ───────────────────────────────────────────
def configure_idp(token: str, spec: dict) -> None:
    """Idempotently configure a broker on `into_realm`:
      · kind='google' → Keycloak's built-in REAL Google social provider;
      · kind='oidc'/'saml' → a broker to a mocked source realm in this instance."""
    into = spec["into_realm"]
    alias = spec["alias"]
    source = spec.get("source_realm")   # absent for the real-Google broker

    # Check current state.
    code, payload = api(token, "GET",
                        f"/realms/{into}/identity-provider/instances/{alias}")
    exists = code == 200
    existing_pid = payload.get("providerId") if (exists and isinstance(payload, dict)) else None

    # Build provider config.
    if spec["kind"] == "google":
        # Built-in Google social provider — Keycloak presets all Google endpoints;
        # we supply the real client creds. Redirect URI to register in Google:
        #   {KC_PUBLIC_BASE}/realms/{into}/broker/google/endpoint
        cfg = {
            "clientId":     GOOGLE_CLIENT_ID,
            "clientSecret": GOOGLE_CLIENT_SECRET,
            "defaultScope": "openid profile email",
            "syncMode":     "IMPORT",
        }
        provider_id = "google"
    elif spec["kind"] == "oidc":
        # The `issuer` MUST match the `iss` claim Keycloak puts in the token,
        # which is set from KC_HOSTNAME (the external URL). Token URLs the
        # broker calls server-to-server can use the internal URL.
        cfg = {
            "issuer":                f"{KC_PUBLIC_BASE}/realms/{source}",
            "authorizationUrl":      f"{KC_PUBLIC_BASE}/realms/{source}/protocol/openid-connect/auth",
            "tokenUrl":              f"http://keycloak:8080/realms/{source}/protocol/openid-connect/token",
            "userInfoUrl":           f"http://keycloak:8080/realms/{source}/protocol/openid-connect/userinfo",
            "jwksUrl":               f"http://keycloak:8080/realms/{source}/protocol/openid-connect/certs",
            "logoutUrl":             f"{KC_PUBLIC_BASE}/realms/{source}/protocol/openid-connect/logout",
            "clientId":              spec["client_id"],
            "clientSecret":          spec["client_secret"],
            "defaultScope":          "openid profile email",
            "validateSignature":     "false",
            "useJwksUrl":            "true",
            "syncMode":              "FORCE",
            "backchannelSupported":  "false",
        }
        provider_id = "oidc"
    else:  # saml
        cfg = {
            "singleSignOnServiceUrl":  f"{KC_PUBLIC_BASE}/realms/{source}/protocol/saml",
            "singleLogoutServiceUrl":  f"{KC_PUBLIC_BASE}/realms/{source}/protocol/saml",
            "entityId":                f"{KC_PUBLIC_BASE}/realms/{into}",
            "nameIDPolicyFormat":      "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
            "postBindingResponse":     "true",
            "postBindingAuthnRequest": "true",
            "postBindingLogout":       "true",
            "wantAssertionsSigned":    "false",
            "wantAuthnRequestsSigned": "false",
            "validateSignature":       "false",
            "syncMode":                "FORCE",
        }
        provider_id = "saml"

    body = {
        "alias":        alias,
        "displayName":  spec["display"],
        "providerId":   provider_id,
        "enabled":      True,
        # P1.3 — only TRUSTED IdPs mark email verified. A low-trust broker
        # (public Google) must not have its email auto-verified.
        "trustEmail":   bool(spec.get("trust_email", False)),
        "storeToken":   False,
        "addReadTokenRoleOnCreate": False,
        "firstBrokerLoginFlowAlias": "first broker login",
        "config":       cfg,
    }

    # Keycloak won't change a broker's providerId (type) in place — if the type
    # changed (e.g. a prior mock `oidc` broker → the built-in `google` provider),
    # the instance must be recreated or the new config is silently dropped.
    if exists and existing_pid != provider_id:
        api(token, "DELETE", f"/realms/{into}/identity-provider/instances/{alias}")
        exists = False

    dst = source or provider_id   # mock source realm, or the provider type (real Google)
    if exists:
        code, payload = api(token, "PUT",
                            f"/realms/{into}/identity-provider/instances/{alias}",
                            body)
        if code not in (200, 204):
            print(f"    ✗ update broker {into}/{alias}: {code} {payload}")
            sys.exit(1)
        print(f"    ✓ updated broker {into}/{alias} → {dst}")
    else:
        code, payload = api(token, "POST",
                            f"/realms/{into}/identity-provider/instances",
                            body)
        if code not in (201, 204):
            print(f"    ✗ create broker {into}/{alias}: {code} {payload}")
            sys.exit(1)
        print(f"    ✓ created broker {into}/{alias} → {dst}")

    # Default-role mapper: every brokered user gets `default_role` on first
    # login. Idempotent — drop + recreate.
    drole = spec.get("default_role")
    if drole:
        ensure_default_role_mapper(token, into, alias, drole)

    # P1.3 — stamp the broker's trust tier onto every user it federates.
    ensure_idp_trust_mapper(token, into, alias, spec.get("trust_tier", "low"))


def ensure_default_role_mapper(token: str, realm: str, alias: str, role: str) -> None:
    mapper_name = f"default-{role}"
    code, mappers = api(token, "GET",
                        f"/realms/{realm}/identity-provider/instances/{alias}/mappers")
    if code == 200 and isinstance(mappers, list):
        for m in mappers:
            if m.get("name") == mapper_name:
                # Already there.
                return
    body = {
        "name":                  mapper_name,
        "identityProviderAlias": alias,
        # Generic (provider-agnostic) hardcoded-role mapper — the `oidc-`
        # prefixed variant silently no-ops on a SAML broker, which left EHIA
        # users with no R- role (R-UNKNOWN → denied). This one applies to both.
        "identityProviderMapper": "hardcoded-role-idp-mapper",
        "config": {
            "role":      role,
            "syncMode":  "INHERIT",
        },
    }
    code, payload = api(token, "POST",
                        f"/realms/{realm}/identity-provider/instances/{alias}/mappers",
                        body)
    if code not in (201, 204):
        print(f"    ✗ default-role mapper {realm}/{alias}/{role}: {code} {payload}")
        sys.exit(1)
    print(f"      · default-role mapper → {role}")


def ensure_unmanaged_attributes(token: str, realm: str) -> None:
    """Allow unmanaged user attributes in the realm (P1.3). Keycloak 26's
    declarative user profile drops any attribute not explicitly declared — so
    the `idp_trust` attribute set by the IdP mapper (and the protocol mapper that
    lifts it into the token) is silently discarded unless the realm's
    unmanagedAttributePolicy is enabled. Idempotent GET-set-PUT."""
    code, cfg = api(token, "GET", f"/realms/{realm}/users/profile")
    if code != 200 or not isinstance(cfg, dict):
        print(f"    ! user-profile GET failed for {realm} ({code}) — skipping unmanaged-attrs")
        return
    if cfg.get("unmanagedAttributePolicy") == "ENABLED":
        return
    cfg["unmanagedAttributePolicy"] = "ENABLED"
    code, payload = api(token, "PUT", f"/realms/{realm}/users/profile", cfg)
    print(f"    ✓ unmanaged attributes ENABLED → {realm}"
          if code in (200, 204) else f"    ✗ unmanaged attrs {realm}: {code} {payload}")


def ensure_idp_trust_mapper(token: str, realm: str, alias: str, tier: str) -> None:
    """Stamp a hardcoded `idp_trust` USER ATTRIBUTE (= tier) on every user
    brokered through `alias` (P1.3). A protocol mapper on the nhdw-flat-roles
    client scope then lifts it into the token, where the OPA trust guard reads
    it. Generic hardcoded-attribute mapper → works for OIDC and SAML brokers."""
    mapper_name = "idp-trust"
    code, mappers = api(token, "GET",
                        f"/realms/{realm}/identity-provider/instances/{alias}/mappers")
    if code == 200 and isinstance(mappers, list):
        for m in mappers:
            if m.get("name") == mapper_name:
                return
    body = {
        "name":                   mapper_name,
        "identityProviderAlias":  alias,
        "identityProviderMapper": "hardcoded-attribute-idp-mapper",
        "config": {
            "attribute":       "idp_trust",
            "attribute.value": tier,
            "syncMode":        "INHERIT",
        },
    }
    code, payload = api(token, "POST",
                        f"/realms/{realm}/identity-provider/instances/{alias}/mappers",
                        body)
    print(f"      · idp-trust mapper → {tier}"
          if code in (201, 204) else f"    ✗ idp-trust mapper {realm}/{alias}: {code} {payload}")


def ensure_idp_trust_claim_mapper(token: str, realm: str) -> None:
    """Add a protocol mapper to the realm's `nhdw-flat-roles` client scope that
    lifts the `idp_trust` user attribute into the token as an `idp_trust` claim
    (access token + userinfo + id token). Password-only users have no such
    attribute ⇒ no claim ⇒ the gateway defaults them to "high" (P1.3)."""
    _, scopes = api(token, "GET", f"/realms/{realm}/client-scopes")
    scope = next((s for s in (scopes or []) if s.get("name") == "nhdw-flat-roles"), None)
    if not scope:
        print(f"    ! nhdw-flat-roles scope absent in {realm} — idp_trust claim skipped")
        return
    existing = {m.get("name") for m in (scope.get("protocolMappers") or [])}
    if "idp_trust" in existing:
        return
    body = {
        "name":           "idp_trust",
        "protocol":       "openid-connect",
        "protocolMapper": "oidc-usermodel-attribute-mapper",
        "config": {
            "user.attribute":      "idp_trust",
            "claim.name":          "idp_trust",
            "jsonType.label":      "String",
            "id.token.claim":      "true",
            "access.token.claim":  "true",
            "userinfo.token.claim": "true",
        },
    }
    code, payload = api(token, "POST",
                        f"/realms/{realm}/client-scopes/{scope['id']}/protocol-mappers/models",
                        body)
    print(f"    ✓ idp_trust claim mapper → {realm}/nhdw-flat-roles"
          if code in (201, 204) else f"    ✗ idp_trust claim mapper {realm}: {code} {payload}")


# ─── clients ─────────────────────────────────────────────────────────────
def configure_client(token: str, spec: dict) -> None:
    realm = spec["realm"]
    cid = spec["client_id"]
    code, payload = api(token, "GET", f"/realms/{realm}/clients?clientId={cid}")
    if code != 200:
        print(f"    ✗ lookup client {realm}/{cid}: {code} {payload}")
        sys.exit(1)
    assert isinstance(payload, list)
    desired = {
        "clientId":           cid,
        "enabled":            True,
        "publicClient":       True,
        "standardFlowEnabled": True,
        "directAccessGrantsEnabled": False,
        "serviceAccountsEnabled": False,
        "redirectUris":       [spec["redirect_uri"]],
        "webOrigins":         [spec["web_origin"]],
        "attributes": {
            "pkce.code.challenge.method": "S256",
            "post.logout.redirect.uris":  spec["post_logout_redirect_uri"],
        },
    }
    if not payload:
        code, p2 = api(token, "POST", f"/realms/{realm}/clients", desired)
        if code not in (201, 204):
            print(f"    ✗ create client {realm}/{cid}: {code} {p2}")
            sys.exit(1)
        print(f"    ✓ created public client {realm}/{cid}")
        return

    # Update in place.
    existing = payload[0]
    merged = {**existing, **desired}
    # Preserve sub-collections we don't want to wipe (none here, but be explicit).
    code, p2 = api(token, "PUT",
                   f"/realms/{realm}/clients/{existing['id']}", merged)
    if code not in (204, 200):
        print(f"    ✗ update client {realm}/{cid}: {code} {p2}")
        sys.exit(1)
    note = " (converted public)" if existing.get("publicClient") is False else ""
    print(f"    ✓ updated client {realm}/{cid}{note}")


def configure_confidential_client(token: str, spec: dict) -> None:
    """Create/update a CONFIDENTIAL OIDC client (has a client secret) for a tool
    like dbt-docs. The secret must match the tool's k8s Secret env."""
    realm, cid = spec["realm"], spec["client_id"]
    base, secret = spec["base"].rstrip("/"), spec["secret"]
    if not secret:
        print(f"    ⚠ {realm}/{cid}: no confidential secret in env — skipped")
        return
    code, payload = api(token, "GET", f"/realms/{realm}/clients?clientId={cid}")
    desired = {
        "clientId": cid, "enabled": True, "protocol": "openid-connect",
        "publicClient": False, "secret": secret,
        "standardFlowEnabled": True, "directAccessGrantsEnabled": False,
        "serviceAccountsEnabled": False,
        "redirectUris": [base + "/*"], "webOrigins": [base],
        "attributes": {"post.logout.redirect.uris": base},
    }
    if isinstance(payload, list) and payload:
        internal_id = payload[0]["id"]
        api(token, "PUT", f"/realms/{realm}/clients/{internal_id}", {**payload[0], **desired})
        print(f"    ✓ updated confidential client {realm}/{cid}")
    else:
        api(token, "POST", f"/realms/{realm}/clients", desired)
        gc, got = api(token, "GET", f"/realms/{realm}/clients?clientId={cid}")
        internal_id = got[0]["id"] if isinstance(got, list) and got else None
        print(f"    ✓ created confidential client {realm}/{cid}")
    # Standard OIDC login needs the profile/email/basic scopes assigned as
    # DEFAULT client scopes — a freshly-created client only inherits the realm's
    # `nhdw-flat-roles` default, so requesting `openid profile email` would fail
    # `invalid_scope` (the exact bug that broke Airflow + dbt-docs login). Match
    # the dashboard clients: basic + profile + email + nhdw-flat-roles.
    if internal_id:
        ensure_default_client_scopes(token, realm, internal_id,
                                     ["basic", "profile", "email", "nhdw-flat-roles"])


def ensure_default_client_scopes(token: str, realm: str, client_internal_id: str,
                                 scope_names: list[str]) -> None:
    """Assign the named realm client-scopes as DEFAULT scopes of a client
    (idempotent; skips any scope the realm doesn't define)."""
    code, scopes = api(token, "GET", f"/realms/{realm}/client-scopes")
    by_name = {s["name"]: s["id"] for s in scopes} if isinstance(scopes, list) else {}
    for name in scope_names:
        sid = by_name.get(name)
        if not sid:
            continue
        api(token, "PUT",
            f"/realms/{realm}/clients/{client_internal_id}/default-client-scopes/{sid}")


# ─── broker source-realm client hostnames ─────────────────────────────────
def _broker_intos(alias: str) -> list[str]:
    """The realms an IdP `alias` is brokered into (from IDENTITY_PROVIDERS)."""
    return [p["into_realm"] for p in IDENTITY_PROVIDERS if p["alias"] == alias]


def configure_broker_source_clients(token: str) -> None:
    """Rewrite the MOCK ehia-saml-mock realm's SAML SP clients to the external
    KC_PUBLIC_BASE hostname.

    The mock realm JSON ships with legacy `http://127.0.0.1:8090/...` client
    registrations frozen at import time. Under the real overlay
    KC_PUBLIC_BASE = https://keycloak.127.0.0.1.nip.io, the broker callback the
    SOURCE realm must accept is `{KC_PUBLIC_BASE}/realms/{into}/broker/ehia-saml/
    endpoint` — so without this, federation (EHIA SAML) fails the SP entityID/ACS
    match. Mirrors configure_client: the JSON owns client STRUCTURE, setup-keycloak
    owns the HOSTNAME (from env). Idempotent. (Google is REAL now — no mock source
    client to rewrite.)"""
    kb = KC_PUBLIC_BASE.rstrip("/")

    # ehia-saml-mock — one SAML SP client per brokered realm; the client's
    # clientId IS the SP entityID and must equal the broker's `entityId`
    # ({kb}/realms/{into}); the POST-binding ACS is the broker endpoint.
    e_intos = _broker_intos("ehia-saml")
    if e_intos:
        code, all_clients = api(token, "GET", "/realms/ehia-saml-mock/clients")
        clients = all_clients if isinstance(all_clients, list) else []
        for into in e_intos:
            new_entity = f"{kb}/realms/{into}"
            acs = f"{kb}/realms/{into}/broker/ehia-saml/endpoint"
            legacy = f"http://127.0.0.1:8090/realms/{into}"
            match = next((c for c in clients if c.get("clientId") in (new_entity, legacy)), None)
            if not match:
                print(f"    ! ehia-saml-mock SP for {into} not found — skipping"); continue
            match["clientId"] = new_entity
            attrs = match.setdefault("attributes", {})
            attrs["saml_assertion_consumer_url_post"] = acs
            attrs["saml_single_logout_service_url_post"] = acs
            match["redirectUris"] = [acs, f"http://keycloak:8080/realms/{into}/broker/ehia-saml/endpoint"]
            code, p = api(token, "PUT", f"/realms/ehia-saml-mock/clients/{match['id']}", match)
            if code not in (200, 204):
                print(f"    ✗ ehia-saml-mock SP {into}: {code} {p}"); sys.exit(1)
            print(f"    ✓ ehia-saml-mock SP {into} entityID/ACS → {kb}")


def ensure_no_brokers(token: str, realm: str) -> None:
    """Enforce that `realm` has NO brokered identity provider — operators/admins
    authenticate with username/password ONLY, so no external (social/federated)
    IdP can ever mint one. Convergent: deletes any IdP instance found, so this
    holds even if a prior seed / imported realm added one (the security invariant
    is asserted every boot, not just on a clean import)."""
    code, idps = api(token, "GET", f"/realms/{realm}/identity-provider/instances")
    if code != 200 or not isinstance(idps, list):
        return
    for idp in idps:
        alias = idp.get("alias")
        code2, _ = api(token, "DELETE", f"/realms/{realm}/identity-provider/instances/{alias}")
        if code2 in (200, 204):
            print(f"    ✓ removed broker {realm}/{alias} — admin realm is password-only")
        else:
            print(f"    ! could not remove broker {realm}/{alias}: {code2}")


# ─── main ────────────────────────────────────────────────────────────────
# Friendly names shown in the login header (below the FMoH logo the nhdw theme
# injects). Only the two staff realms exist; Fayda is a verification-only
# integration on the public access-request form, NOT a login realm.
REALM_DISPLAY = {
    "moh-staff":      "Ethiopia NHDW",
    "privileged-ops": "NHDW Operations",
}


def configure_realm_theme(token: str, realm: str) -> None:
    """Brand the realm's hosted login page: set loginTheme=nhdw + a friendly
    displayName. GET-merge-PUT so no other realm settings are clobbered."""
    code, rep = api(token, "GET", f"/realms/{realm}")
    if code != 200 or not isinstance(rep, dict):
        print(f"    ✗ get realm {realm}: {code}")
        return
    rep["loginTheme"] = "nhdw"
    disp = REALM_DISPLAY.get(realm)
    if disp:
        rep["displayName"] = disp
    code, _ = api(token, "PUT", f"/realms/{realm}", rep)
    if code in (200, 204):
        print(f"    ✓ realm {realm}: loginTheme=nhdw"
              + (f", displayName={disp!r}" if disp else ""))
    else:
        print(f"    ✗ update realm {realm}: {code}")


# Each realm's SMTP → Google SMTP (Mailpit retired 2026-07-06). Lets Keycloak
# deliver execute-actions-email (set-password / reset links) for access-request
# provisioning (§4.8). Same env contract + one smtp-secrets Secret as the
# gateway mailer — one centralised relay for every app + realm email.
def _realm_smtp() -> dict:
    """Keycloak smtpServer config from the SMTP_* env (smtp-secrets Secret) —
    Google SMTP (starttls+auth)."""
    host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    port = os.environ.get("SMTP_PORT", "587")
    user = os.environ.get("SMTP_USER", "").strip()
    pw   = os.environ.get("SMTP_PASS", "")
    tls  = os.environ.get("SMTP_TLS", "true").strip().lower() in ("1", "true", "yes")
    s = {
        "host": host, "port": port,
        # Gmail requires From == the authenticated account.
        "from": user or "noreply@nhdw.moh.gov.et",
        "fromDisplayName": "Ethiopia NHDW",
        "ssl": "false",
        "starttls": "true" if tls else "false",
        "auth": "true" if user else "false",
    }
    if user:
        s["user"] = user
        s["password"] = pw
    return s


def configure_realm_smtp(token: str, realm: str) -> None:
    """Point the realm's SMTP at the external Google relay (smtp-secrets) so
    execute-actions-email (password-set / reset links) delivers. GET-merge-PUT so
    no other realm settings are clobbered (idempotent)."""
    smtp = _realm_smtp()
    code, rep = api(token, "GET", f"/realms/{realm}")
    if code != 200 or not isinstance(rep, dict):
        print(f"    ✗ get realm {realm}: {code}")
        return
    rep["smtpServer"] = smtp
    code, _ = api(token, "PUT", f"/realms/{realm}", rep)
    print((f"    ✓ realm {realm}: SMTP → {smtp['host']}:{smtp['port']} (auth={smtp['auth']})"
           if code in (200, 204) else f"    ✗ set SMTP {realm}: {code}"))


# The dashboard SPAs request `openid profile email` plus the custom
# `nhdw-flat-roles` scope (which carries the flat `roles` claim the gateway
# reads). The minimal privileged-ops realm import ships ONLY the `basic` scope,
# so its `admin` client login fails with `invalid_scope: profile email` — the
# admin dashboard (where access-request review + provisioning live) is
# unreachable. We copy the missing scope definitions (incl. their protocol
# mappers) from the fully-configured moh-staff realm and assign them as client
# defaults. Idempotent GET-copy-PUT, so it self-heals on every re-seed and lands
# correctly on a fresh cold boot (moh-staff's scopes exist from its own realm
# import by the time keycloak-seed runs).
SCOPE_REALM_NEEDS = {
    "privileged-ops": ["nhdw-flat-roles", "profile", "email"],
}
SCOPE_REALM_CLIENTS = ("admin", "ops-hub", "cloudbeaver", "openbao")


def configure_realm_scopes(token: str, realm: str, src: str = "moh-staff") -> None:
    names = SCOPE_REALM_NEEDS.get(realm, [])
    if not names:
        return
    _, dst = api(token, "GET", f"/realms/{realm}/client-scopes")
    _, srcs = api(token, "GET", f"/realms/{src}/client-scopes")
    have = {c["name"]: c["id"] for c in (dst or [])}
    src_by = {c["name"]: c for c in (srcs or [])}
    for name in names:
        if name in have:
            continue
        rep = dict(src_by.get(name) or {})
        if not rep:
            print(f"    ✗ scope {name} missing in {src} — cannot copy")
            continue
        rep.pop("id", None)
        for m in rep.get("protocolMappers", []) or []:
            m.pop("id", None)
        code, _ = api(token, "POST", f"/realms/{realm}/client-scopes", rep)
        print(f"    {'✓' if code in (201, 204) else '✗'} scope {name} → {realm} ({code})")
    _, dst = api(token, "GET", f"/realms/{realm}/client-scopes")
    have = {c["name"]: c["id"] for c in (dst or [])}
    _, clients = api(token, "GET", f"/realms/{realm}/clients")
    for c in (clients or []):
        if c.get("clientId") in SCOPE_REALM_CLIENTS:
            for name in names:
                sid = have.get(name)
                if sid:
                    api(token, "PUT",
                        f"/realms/{realm}/clients/{c['id']}/default-client-scopes/{sid}")
    print(f"    ✓ realm {realm}: default scopes {names} assigned to dashboard clients")


def main() -> int:
    if not USERS_YAML.exists():
        print(f"missing users.yaml: {USERS_YAML}")
        return 2

    users = yaml.safe_load(USERS_YAML.read_text())
    token = login()
    print(f"connected to Keycloak at {KC_BASE} as {ADMIN_USERNAME}")

    print("\n▸ realm roles")
    for realm, roles in MISSING_REALM_ROLES.items():
        for r in roles:
            ensure_realm_role(token, realm, r)

    print("\n▸ unmanaged user attributes (P1.3 — allow idp_trust to persist)")
    for realm in ("moh-staff", "privileged-ops"):
        ensure_unmanaged_attributes(token, realm)

    print(f"\n▸ users ({len(users)} from users.yaml, password=\"{SEED_PASSWORD}\")")
    by_realm: dict[str, list[dict]] = {}
    for u in users:
        by_realm.setdefault(u["realm"], []).append(u)
    for realm, group in by_realm.items():
        print(f"  ▸ {realm} ({len(group)} users)")
        import_users_for_realm(token, realm, group)

    print(f"\n▸ dashboard clients ({len(DASHBOARD_CLIENTS)})")
    for c in DASHBOARD_CLIENTS:
        configure_client(token, c)

    print(f"\n▸ tool clients ({len(TOOL_CLIENTS)})")
    for c in TOOL_CLIENTS:
        configure_confidential_client(token, c)

    print(f"\n▸ tool-gate clients ({len(GATE_CLIENTS)})")
    for c in GATE_CLIENTS:
        configure_confidential_client(token, c)

    # Skip the real-Google broker if no real creds were provided (no mock
    # fallback — social login is simply absent, the rest of auth still works).
    providers = list(IDENTITY_PROVIDERS)
    if not _google_configured():
        providers = [p for p in providers if p["alias"] != "google"]
        print("  ! GOOGLE_CLIENT_ID unset/placeholder — skipping the Google social "
              "broker (no mock fallback).")
    print(f"\n▸ identity-provider brokers ({len(providers)})")
    for idp in providers:
        configure_idp(token, idp)

    print("\n▸ broker source-realm client hostnames (mock IdPs → KC_PUBLIC_BASE)")
    configure_broker_source_clients(token)

    print("\n▸ password-only admin realm (strip any brokered IdP from privileged-ops)")
    ensure_no_brokers(token, "privileged-ops")

    print("\n▸ realm client scopes (fix privileged-ops admin login)")
    for realm in ("privileged-ops",):
        configure_realm_scopes(token, realm)

    print("\n▸ idp_trust claim (P1.3 trust guard) — nhdw-flat-roles scope, both realms")
    for realm in ("moh-staff", "privileged-ops"):
        ensure_idp_trust_claim_mapper(token, realm)

    print("\n▸ realm branding (nhdw login theme)")
    for realm in ("moh-staff", "privileged-ops"):
        configure_realm_theme(token, realm)

    print("\n▸ realm SMTP (external Google relay — provisioning + reset emails)")
    for realm in ("moh-staff", "privileged-ops"):
        configure_realm_smtp(token, realm)

    print("\n✓ Keycloak setup complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
