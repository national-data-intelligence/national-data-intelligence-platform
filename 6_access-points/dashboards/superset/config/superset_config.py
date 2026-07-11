# superset_config.py — Apache Superset for NHDW self-service SQL/BI.
# Baked into nhdw/superset at /app/pythonpath/superset_config.py.
#
# AUDIENCE + GOVERNANCE (read this): Superset queries the marts DIRECTLY through
# Trino (like JupyterHub), which BYPASSES the nhdw-gateway + OPA row-level
# security — OPA governance lives only in the gateway. So Superset is scoped to
# the SAME trusted analyst set as Jupyter (R-CONS-ANA/SCI/RES + R-DEC + R-STEW +
# R-SUPER); every other role lands in the empty Public role (no access). Making
# SQL access OPA-governed for arbitrary roles is a separate future decision
# (Trino OPA authorizer / a SQL-speaking gateway PEP) — deliberately NOT faked
# with duplicated Superset RLS rules that would drift from OPA.
#
# WHY split-URL (same as Airflow's webserver_config.py): k3d resolves the public
# host keycloak.127.0.0.1.nip.io to 127.0.0.1 — inside the pod that is the pod
# itself. So the browser authorizes on the PUBLIC host while the pod exchanges
# the code / fetches JWKS / reads userinfo on the INTERNAL service DNS. `issuer`
# is pinned PUBLIC so the id_token `iss` validates; `jwks_uri` points INTERNAL so
# signature verification is reachable server-side.
import logging
import os

from flask_appbuilder.security.manager import AUTH_DB, AUTH_OAUTH

log = logging.getLogger("nhdw.superset.oidc")

# ── metadata DB (postgres-vault nhdw_superset, mirrors nhdw_airflow) ──────────
_DB_PW = os.environ.get("SUPERSET_DB_PASSWORD", "")
_DB_HOST = os.environ.get("SUPERSET_DB_HOST", "postgres-vault.nhdw.svc.cluster.local")
_DB_NAME = os.environ.get("SUPERSET_DB_NAME", "nhdw_superset")
SQLALCHEMY_DATABASE_URI = (
    f"postgresql+psycopg2://superset_writer:{_DB_PW}@{_DB_HOST}:5432/{_DB_NAME}"
)

# Flask session signing — MUST be stable across restarts (env-provided secret).
SECRET_KEY = os.environ.get("SUPERSET_SECRET_KEY", "changeme-superset-secret-key")

# Single-process demo: synchronous SQL Lab (no celery/redis). Keep it light.
SUPERSET_WEBSERVER_TIMEOUT = 120
SQLLAB_TIMEOUT = 90
SUPERSET_WEBSERVER_PROTOCOL = "https"
# Behind Traefik TLS — trust the proxy's X-Forwarded-* so redirect_uri is https.
ENABLE_PROXY_FIX = True
WTF_CSRF_ENABLED = True
# Dashboard-level RBAC so an owner can scope a dashboard to specific roles.
FEATURE_FLAGS = {"DASHBOARD_RBAC": True}

# ── Keycloak OIDC (FAB OAuth) — moh-staff realm, the analyst audience ─────────
_CID = os.environ.get("SUPERSET_OIDC_CLIENT_ID", "").strip()
_SECRET = os.environ.get("SUPERSET_OIDC_CLIENT_SECRET", "").strip()
_PUB = os.environ.get("SUPERSET_OIDC_ISSUER_PUBLIC", "").strip().rstrip("/")
_INT = os.environ.get("SUPERSET_OIDC_ISSUER_INTERNAL", "").strip().rstrip("/")

if _CID and _SECRET and _PUB and _INT:
    from superset.security import SupersetSecurityManager

    AUTH_TYPE = AUTH_OAUTH
    AUTH_USER_REGISTRATION = True            # auto-create the KC user on first login
    AUTH_USER_REGISTRATION_ROLE = "Public"   # fallback only; real roles from mapping
    AUTH_ROLES_SYNC_AT_LOGIN = True          # re-read realm roles every login
    # NHDW realm role → Superset role(s). Alpha = full self-service (datasets,
    # charts, SQL Lab); Gamma+sql_lab = read/query without dataset creation.
    # A role NOT listed here yields NO role_keys → the empty Public role (denied).
    AUTH_ROLES_MAPPING = {
        "R-SUPER":    ["Admin"],
        "R-CONS-ANA": ["Alpha", "sql_lab"],
        "R-CONS-SCI": ["Alpha", "sql_lab"],
        "R-CONS-RES": ["Alpha", "sql_lab"],
        "R-DEC":      ["Alpha", "sql_lab"],
        "R-STEW":     ["Gamma", "sql_lab"],
    }
    _ALLOWED = set(AUTH_ROLES_MAPPING)

    OAUTH_PROVIDERS = [
        {
            "name": "keycloak",
            "icon": "fa-key",
            "token_key": "access_token",
            "remote_app": {
                "client_id": _CID,
                "client_secret": _SECRET,
                # userinfo is fetched relative to api_base_url → .../openid-connect/userinfo
                "api_base_url": f"{_INT}/protocol/",
                "access_token_url": f"{_INT}/protocol/openid-connect/token",
                "authorize_url": f"{_PUB}/protocol/openid-connect/auth",
                "jwks_uri": f"{_INT}/protocol/openid-connect/certs",
                "issuer": _PUB,
                "client_kwargs": {"scope": "openid email profile"},
            },
        }
    ]

    class NHDWSupersetSecurityManager(SupersetSecurityManager):
        """Map NHDW Keycloak realm roles → Superset FAB role_keys.

        The minimal realm has no standard `roles`/`groups` client scope — realm
        roles are flattened into a top-level `roles` claim by the
        `nhdw-flat-roles` DEFAULT client scope (same claim the gateway + Airflow
        read). We read that from the access token, tolerating the standard
        `realm_access.roles` too."""

        @staticmethod
        def _roles_from(claims):
            return ((claims.get("realm_access") or {}).get("roles")
                    or claims.get("roles") or [])

        def get_oauth_user_info(self, provider, response=None):
            if provider != "keycloak":
                return {}
            remote = self.appbuilder.sm.oauth_remotes[provider]
            me = remote.get("openid-connect/userinfo")
            me.raise_for_status()
            data = me.json()

            roles = []
            token = (response or {}).get("access_token")
            if token:
                try:
                    import jwt  # Superset ships PyJWT

                    roles = self._roles_from(
                        jwt.decode(token, options={"verify_signature": False}))
                except Exception as exc:  # pragma: no cover — defensive
                    log.warning("access-token role decode failed: %s", exc)
            if not roles:
                roles = self._roles_from(data)

            return {
                "username": data.get("preferred_username") or data.get("sub", ""),
                "first_name": data.get("given_name", ""),
                "last_name": data.get("family_name", ""),
                "email": data.get("email", ""),
                "role_keys": [r for r in roles if r in _ALLOWED],
            }

    CUSTOM_SECURITY_MANAGER = NHDWSupersetSecurityManager
else:
    log.warning(
        "SUPERSET OIDC env incomplete (client id/secret/issuers) — falling back "
        "to AUTH_DB (break-glass admin login)."
    )
    AUTH_TYPE = AUTH_DB
