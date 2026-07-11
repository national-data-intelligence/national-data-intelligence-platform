# webserver_config.py — Airflow (FAB) native Keycloak OIDC, replacing the
# built-in DB-form login (Tool-SSO C). Baked into nhdw/airflow at
# /opt/airflow/webserver_config.py; only the WEBSERVER reads it.
#
# WHY split-URL: k3d resolves the public host keycloak.127.0.0.1.nip.io to
# 127.0.0.1 — inside the pod that is the pod itself, not Keycloak. So the browser
# authorizes on the PUBLIC host while the pod exchanges the code / fetches JWKS /
# reads userinfo on the INTERNAL service DNS. `issuer` is pinned to the PUBLIC
# value so the id_token `iss` (which Keycloak stamps from KC_HOSTNAME = the public
# host) validates, while `jwks_uri` points INTERNAL so signature verification is
# reachable server-side. Same pattern the gateway + oauth2-proxy use.
#
# ROLES: Keycloak realm roles (realm_access.roles in the access token) → FAB roles
#   R-OPS-ADM → Admin · R-OPS-ENG → Op · R-OPS-SEC → Viewer
# re-synced every login. A user with no R-OPS-* role lands in the empty Public role
# (no DAG access) — privileged-ops is the only realm this client is seeded in.
#
# Config from env (1_infrastructure/k8s/base/airflow.yaml, webserver container):
#   AIRFLOW_OIDC_CLIENT_ID / AIRFLOW_OIDC_CLIENT_SECRET
#   AIRFLOW_OIDC_ISSUER_PUBLIC    https://keycloak.127.0.0.1.nip.io/realms/privileged-ops
#   AIRFLOW_OIDC_ISSUER_INTERNAL  http://keycloak.nhdw.svc.cluster.local:8080/realms/privileged-ops
# If any are absent we FALL BACK to AUTH_DB (the break-glass admin user) so a
# misconfigured secret degrades to password login instead of locking Airflow out.
import logging
import os

from flask_appbuilder.security.manager import AUTH_DB, AUTH_OAUTH

log = logging.getLogger("nhdw.airflow.oidc")

WTF_CSRF_ENABLED = True

_CID = os.environ.get("AIRFLOW_OIDC_CLIENT_ID", "").strip()
_SECRET = os.environ.get("AIRFLOW_OIDC_CLIENT_SECRET", "").strip()
_PUB = os.environ.get("AIRFLOW_OIDC_ISSUER_PUBLIC", "").strip().rstrip("/")
_INT = os.environ.get("AIRFLOW_OIDC_ISSUER_INTERNAL", "").strip().rstrip("/")

if _CID and _SECRET and _PUB and _INT:
    from airflow.providers.fab.auth_manager.security_manager.override import (
        FabAirflowSecurityManagerOverride,
    )

    AUTH_TYPE = AUTH_OAUTH
    AUTH_USER_REGISTRATION = True          # auto-create the Keycloak user on first login
    AUTH_USER_REGISTRATION_ROLE = "Public"  # fallback only; real role from the mapping below
    AUTH_ROLES_SYNC_AT_LOGIN = True         # re-read realm roles on every login
    AUTH_ROLES_MAPPING = {
        "R-SUPER": ["Admin"],   # platform superuser (wildcard access everywhere)
        "R-OPS-ADM": ["Admin"],
        "R-OPS-ENG": ["Op"],
        "R-OPS-SEC": ["Viewer"],
    }
    # Realm roles we translate to Airflow roles (everything else is ignored, so a
    # user with none lands in the empty Public role — no DAG access).
    _NHDW_ROLE_PREFIXES = ("R-OPS-", "R-SUPER")

    OAUTH_PROVIDERS = [
        {
            "name": "keycloak",
            "icon": "fa-key",
            "token_key": "access_token",
            "remote_app": {
                "client_id": _CID,
                "client_secret": _SECRET,
                # userinfo is fetched relative to api_base_url → .../protocol/openid-connect/userinfo
                "api_base_url": f"{_INT}/protocol/",
                "access_token_url": f"{_INT}/protocol/openid-connect/token",
                "authorize_url": f"{_PUB}/protocol/openid-connect/auth",
                "jwks_uri": f"{_INT}/protocol/openid-connect/certs",
                "issuer": _PUB,
                "client_kwargs": {"scope": "openid email profile"},
            },
        }
    ]

    class NHDWKeycloakSecurityManager(FabAirflowSecurityManagerOverride):
        """Map NHDW Keycloak realm roles → FAB role_keys.

        FAB's stock `keycloak` provider reads role_keys from a `groups` claim,
        which NHDW does not emit. This minimal realm has no standard `roles`
        client scope either — realm roles are flattened into a top-level `roles`
        claim by the `nhdw-flat-roles` DEFAULT client scope (same claim the
        gateway reads). We read that from the access token, tolerating both that
        top-level `roles` and the standard `realm_access.roles` for robustness."""

        @staticmethod
        def _roles_from(claims):
            return ((claims.get("realm_access") or {}).get("roles")
                    or claims.get("roles") or [])

        def get_oauth_user_info(self, provider, resp=None):
            if provider != "keycloak":
                return {}
            remote = self.appbuilder.sm.oauth_remotes[provider]
            me = remote.get("openid-connect/userinfo")
            me.raise_for_status()
            data = me.json()

            roles = []
            token = (resp or {}).get("access_token")
            if token:
                try:
                    import jwt  # Airflow ships PyJWT

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
                "role_keys": [r for r in roles if r.startswith(_NHDW_ROLE_PREFIXES)],
            }

    SECURITY_MANAGER_CLASS = NHDWKeycloakSecurityManager
else:
    log.warning(
        "AIRFLOW OIDC env incomplete (client id/secret/issuers) — "
        "falling back to AUTH_DB (break-glass admin login)."
    )
    AUTH_TYPE = AUTH_DB
