"""Env-driven settings for the NHDW gateway. All knobs in one place."""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    # ── Ops DB (nhdw_ops on postgres-vault) ──
    OPS_PG_HOST: str = "postgres-vault"
    OPS_PG_PORT: int = 5432
    OPS_PG_DATABASE: str = "nhdw_ops"
    OPS_PG_USER: str = "ops_gateway"
    OPS_PG_PASSWORD: str = ""

    # ── MinIO ──
    MINIO_ENDPOINT: str = "http://minio-datalake:9000"
    MINIO_PUBLIC_ENDPOINT: str = "http://127.0.0.1:9100"
    MINIO_ACCESS_KEY: str = ""
    MINIO_SECRET_KEY: str = ""
    EXPORTS_BUCKET: str = "nhdw-exports"
    ARTIFACTS_BUCKET: str = "nhdw-artifacts"

    # ── Trino ──
    TRINO_HOST: str = "nhdw-trino"
    TRINO_PORT: int = 8080
    TRINO_USER: str = "nhdw-gateway"

    # ── OPA ──
    OPA_URL: str = "http://opa:8181"
    OPA_ENFORCE: bool = False          # when true, OPA denials become 403 (no advisory flip)
    OPA_FAIL_OPEN: bool = False         # when OPA is UNREACHABLE: false = fail CLOSED (deny),
                                        # true = fail open. Independent of OPA_ENFORCE.
    OPA_TIMEOUT_S: float = 2.5

    # ── Keycloak ──
    # Issuers we accept (= the `iss` claim in tokens). These reflect
    # Keycloak's KC_HOSTNAME — the URL the browser uses for PKCE — so
    # they're the EXTERNAL host, not the docker-network name.
    # Comma-separated, one entry per realm.
    KEYCLOAK_ALLOWED_ISSUERS: str = (
        "http://127.0.0.1:8090/realms/moh-staff,"
        "http://127.0.0.1:8090/realms/privileged-ops")
    # The gateway runs inside the docker network and can't reach
    # 127.0.0.1:8090, so when fetching JWKS we rewrite the issuer's
    # base URL. Pair of (external prefix, internal prefix).
    KEYCLOAK_PUBLIC_BASE: str = "http://127.0.0.1:8090"
    KEYCLOAK_INTERNAL_BASE: str = "http://keycloak:8080"
    KEYCLOAK_AUDIENCE: str = "nhdw-gateway"
    # Keycloak Admin API — access-request provisioning (§4.8). The bootstrap
    # admin (keycloak-secrets) creates the applicant's account + sends the
    # set-password email. PROVISION_REALM is where MoH staff users live.
    KEYCLOAK_ADMIN_USER: str = "keycloak_admin"
    KEYCLOAK_ADMIN_PASSWORD: str = ""
    KEYCLOAK_PROVISION_REALM: str = "moh-staff"
    # Additional audiences the gateway accepts (comma-separated). Dashboard
    # clients (`admin`, `workshop`, `internal-bi`, …) emit tokens with
    # their own clientId as aud — list them here so they're treated as
    # valid in addition to KEYCLOAK_AUDIENCE.
    KEYCLOAK_EXTRA_AUDIENCES: str = (
        "admin,workshop,internal-bi,submission-portal,account")

    # ── Dev mode: when DEV_AUTH=true the gateway accepts identity via the
    # `X-Mock-User: <kc_sub>` header and treats everyone as primary role
    # R-DEV (configurable per request by adding `X-Mock-Role: R-CONS-ANA`).
    # NEVER set DEV_AUTH=true in production. ──
    DEV_AUTH: bool = False

    # ── Demo dashboard impersonation channel. When true the gateway also
    # accepts `X-Mock-User` + `X-Mock-Role` headers EVEN with Keycloak
    # configured — used by the demo view-as triggers + the boot seed scripts
    # (seed-graduation / populate-demo-plugin). Default false (production-safe).
    GATEWAY_DEMO_IMPERSONATION: bool = False
    # Shared secret that a GATEWAY_DEMO_IMPERSONATION caller MUST present as
    # `X-Mock-Secret` — the gateway ingress is reachable, so without this any
    # caller could send `X-Mock-Role: R-SUPER` and be treated as super-user.
    # Empty ⇒ the impersonation channel is DISABLED (fail-secure), even when
    # GATEWAY_DEMO_IMPERSONATION=true. (DEV_AUTH, a local no-Keycloak mode, is
    # unaffected — it is never exposed.)
    GATEWAY_IMPERSONATION_SECRET: str = ""

    # ── Public anonymous tier. When true, a credential-less request (no Bearer,
    # no X-Mock-*) is mapped to the R-PUB-ANON role — the anonymous public
    # dashboard tier. This is DISTINCT from DEV_AUTH: it grants ONLY R-PUB-ANON
    # (which is itself locked to the five public widgets + aggregate/k≥5 data via
    # widget-grants and OPA), and it does NOT enable the X-Mock impersonation
    # channel. It is the real, production-safe way the deployed gateway serves
    # the anonymous public portal (DEV_AUTH must stay false when exposed). ──
    GATEWAY_PUBLIC_ANON: bool = False

    # Presigned-URL TTL for export downloads (seconds).
    EXPORT_PRESIGN_TTL_S: int = 900

    # ── Alert evaluator + email (P3.1 disease-surveillance alerts) ──
    # The evaluator matches each active ops_workspace.subscription against the
    # latest forecast's alarm probability (the SAME signal the dz-* widgets
    # render) and fires owner-scoped notifications + best-effort email.
    # Centralised app email → Google SMTP ONLY (Mailpit retired 2026-07-06).
    # USER/PASS come from the smtp-secrets Secret (gitignored app-password);
    # with them absent, a send fails LOUDLY rather than silently sinking to a
    # fake inbox — email is a real, tested feature now, not a demo stub.
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_FROM: str = "alerts@nhdw.moh.gov.et"
    SMTP_TLS: bool = True
    SMTP_USER: str = ""
    SMTP_PASS: str = ""
    ALERT_EVAL_MODEL: str = "ears"       # DZ forecast model whose alarm_prob drives alerts
    ALERT_EVAL_TOKEN: str = ""           # shared secret for the Airflow → POST /evaluate call


settings = Settings()
