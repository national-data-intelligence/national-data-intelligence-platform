"""NHDW JupyterHub — the ONE in-cluster Hub (k8s / KubeSpawner).

Auth:    GenericOAuthenticator against Keycloak's `moh-staff` realm
         (confidential client `jupyterhub`, secret from jupyterhub-secrets —
         seeded env-driven by setup-keycloak.py like the other tool clients).
Spawner: KubeSpawner. The profile picker comes from the AUTHORITATIVE
         catalogue at /srv/jupyterhub/profiles.yaml (the `workspace-profiles`
         configMap — the same file the gateway's /api/workspace reads), gated
         per-role via each profile's `self_serve_roles`.
Projects: the gateway's POST /api/workspace/spawn passes user_options
         {project_id, project_slug}; the pre-spawn hook turns those into
         NHDW_PROJECT_* env, and the singleuser image's entrypoint syncs the
         project's MinIO files/ prefix into the workdir (pull on start,
         background push loop) so the lab session is always reconciled to
         the project's content.
Creds:   Phase-1 static read-only warehouse access (bi_reader / Trino) via
         env injected from the hub's own environment. The OpenBao short-TTL
         credential hook stays DORMANT (graceful skip when OPENBAO_TOKEN is
         unset) — OpenBao deployment is the deliberately-deferred P-C.2.
"""
from __future__ import annotations

import os
import sys
from typing import Any

import yaml
from oauthenticator.generic import GenericOAuthenticator

# ─── Hub network identity ────────────────────────────────────────────────
# One pod runs hub+proxy: proxy-public on :8000 (ingress target), hub API on
# :8081. Both the in-pod configurable-http-proxy AND the (other-pod) singleuser
# servers reach the Hub API by the Hub's POD IP — NOT the `jupyterhub` Service
# ClusterIP. A pod connecting to its OWN Service ClusterIP hairpin-NATs, which
# k3d refuses (ECONNREFUSED), so the proxy's default `/hub/` route died → 502
# on every lab. The pod IP is routable both from the proxy (same pod) and from
# singleuser pods (pod-to-pod), so it fixes both legs. (This is why zero-to-
# jupyterhub splits the proxy into its own pod; we keep one pod + hub_connect_ip.)
c.JupyterHub.bind_url = "http://:8000"
c.JupyterHub.hub_bind_url = "http://:8081"
c.JupyterHub.hub_connect_ip = os.environ.get("POD_IP") or None
c.JupyterHub.cleanup_servers = False
# ONE LAB PER PROJECT (owner rule 2026-07-12): every lab is a NAMED server whose
# name IS the project id (the gateway spawns servers/<project_id>). Distinct
# projects therefore get distinct pods + PVCs and never share a workdir, so
# "Open in JupyterLab" on project X always lands in X's files (the old single
# unnamed pod pinned to its first project and showed the wrong files). No cap —
# a researcher may keep a lab open per project.
c.JupyterHub.allow_named_servers = True
c.JupyterHub.named_server_limit_per_user = 0

# ─── OAuth (Keycloak, moh-staff) ─────────────────────────────────────────
KEYCLOAK_BASE        = os.environ.get(
    "KEYCLOAK_BASE", "http://keycloak.nhdw.svc.cluster.local:8080")
KEYCLOAK_PUBLIC_BASE = os.environ.get(
    "KEYCLOAK_PUBLIC_BASE", "https://keycloak.127.0.0.1.nip.io")
JUPYTER_PUBLIC_BASE  = os.environ.get(
    "JUPYTER_PUBLIC_BASE", "https://jupyter.127.0.0.1.nip.io")
REALM         = os.environ.get("OIDC_REALM", "moh-staff")
CLIENT_ID     = os.environ.get("OIDC_CLIENT_ID", "jupyterhub")
CLIENT_SECRET = os.environ.get("OIDC_CLIENT_SECRET", "")

c.JupyterHub.authenticator_class = GenericOAuthenticator
c.GenericOAuthenticator.client_id = CLIENT_ID
c.GenericOAuthenticator.client_secret = CLIENT_SECRET
# Browser-facing URL (redirect) vs server-side URLs (token/userdata): the
# consistent-hostname contract — authorize goes through the public ingress,
# the exchange happens pod-to-pod.
c.GenericOAuthenticator.oauth_callback_url = f"{JUPYTER_PUBLIC_BASE}/hub/oauth_callback"
c.GenericOAuthenticator.authorize_url = f"{KEYCLOAK_PUBLIC_BASE}/realms/{REALM}/protocol/openid-connect/auth"
c.GenericOAuthenticator.token_url     = f"{KEYCLOAK_BASE}/realms/{REALM}/protocol/openid-connect/token"
c.GenericOAuthenticator.userdata_url  = f"{KEYCLOAK_BASE}/realms/{REALM}/protocol/openid-connect/userinfo"
c.GenericOAuthenticator.scope = ["openid", "profile", "email"]
c.GenericOAuthenticator.username_claim = "preferred_username"
c.GenericOAuthenticator.manage_groups = True


def _roles_from_auth_state(auth_state) -> list:
    """NHDW realm roles live in the ACCESS TOKEN (a JWT), NOT the userinfo
    response — so "oauth_user.realm_access.roles" never resolved and every
    login was denied. The minimal seeded realm has NO builtin `roles` scope;
    the `nhdw-flat-roles` client scope flattens realm roles into a TOP-LEVEL
    `roles` claim (same source the gateway reads: realm_access.roles OR roles).
    Decode both the access token and the id token and union them."""
    import base64
    import json as _json
    if not auth_state:
        return []

    def _claims(tok: str) -> dict:
        try:
            payload = tok.split(".")[1]
            payload += "=" * (-len(payload) % 4)
            return _json.loads(base64.urlsafe_b64decode(payload.encode()))
        except Exception:                                   # noqa: BLE001
            return {}

    roles: set[str] = set()
    for key in ("access_token", "id_token"):
        c = _claims(auth_state.get(key) or "")
        roles |= set((c.get("realm_access") or {}).get("roles") or [])
        roles |= set(c.get("roles") or [])
    return list(roles)


# Groups = the caller's realm roles (from the access token, via the helper).
c.GenericOAuthenticator.auth_state_groups_key = _roles_from_auth_state
# Skip the hub's own login page — go straight to Keycloak. The user already
# has a Keycloak session from the workshop dashboard, so "Open in JupyterLab"
# lands in the lab via silent SSO instead of an interstitial "Sign in" click.
c.Authenticator.auto_login = True
# Landing on the lab URL with no running server auto-starts it (instead of a
# "Server not running · Launch" interstitial) — so "Open in JupyterLab" always
# lands in a lab, whether or not the gateway pre-spawned it.
c.JupyterHub.implicit_spawn_seconds = 2

# Workshop-class roles may sign in (mirrors the workshop dashboard grants).
c.GenericOAuthenticator.allowed_groups = {
    "R-CONS-ANA", "R-CONS-SCI", "R-CONS-RES", "R-DEC", "R-STEW", "R-SUPER"}
c.GenericOAuthenticator.admin_groups = {"R-SUPER"}
c.Authenticator.enable_auth_state = True

# ─── Gateway service account (POST /api/workspace/* drives the hub API) ──
GATEWAY_TOKEN = os.environ.get("GATEWAY_API_TOKEN", "")
if GATEWAY_TOKEN:
    c.JupyterHub.services = [{"name": "nhdw-gateway", "api_token": GATEWAY_TOKEN}]
    c.JupyterHub.load_roles = [{
        "name": "gateway-admin",
        "scopes": ["admin:users", "admin:servers"],
        "services": ["nhdw-gateway"],
    }]

# ─── Spawner (KubeSpawner) ───────────────────────────────────────────────
c.JupyterHub.spawner_class = "kubespawner.KubeSpawner"
c.KubeSpawner.namespace = os.environ.get("POD_NAMESPACE", "nhdw")
c.KubeSpawner.image = os.environ.get(
    "SINGLEUSER_IMAGE", "nhdw-registry:5500/nhdw/jupyterlab")
c.KubeSpawner.image_pull_policy = "IfNotPresent"
c.KubeSpawner.start_timeout = 300
c.KubeSpawner.http_timeout = 120
c.KubeSpawner.cmd = ["/usr/local/bin/start-nhdw.sh"]
c.KubeSpawner.default_url = "/lab"
c.KubeSpawner.notebook_dir = "/home/jovyan/work"
# Per-user, PER-PROJECT PVC — survives lab restarts; sized per profile below.
# {servername} is the project id (see allow_named_servers above), so each
# project owns its own claim `dsw-<username>-<project_id>` and two projects'
# labs never mount the same workdir. (KubeSpawner expands {servername} to the
# escaped server name; project ids are UUIDs → DNS-safe. The default unnamed
# server, which the NHDW flow never spawns, would map to a trailing-dash claim.)
c.KubeSpawner.storage_pvc_ensure = True
c.KubeSpawner.pvc_name_template = "dsw-{username}-{servername}"
c.KubeSpawner.storage_capacity = "5Gi"
c.KubeSpawner.volumes = [{
    "name": "work",
    "persistentVolumeClaim": {"claimName": "dsw-{username}-{servername}"},
}]
c.KubeSpawner.volume_mounts = [{"name": "work", "mountPath": "/home/jovyan/work"}]

# ─── Profiles — from the authoritative catalogue, role-gated ─────────────
PROFILES_PATH = os.environ.get("WORKSPACE_PROFILES_PATH",
                               "/srv/jupyterhub/profiles.yaml")


def _load_catalogue() -> dict[str, Any]:
    try:
        with open(PROFILES_PATH) as f:
            return yaml.safe_load(f) or {}
    except OSError as exc:
        print(f"profiles catalogue unreadable ({exc}) — empty profile list",
              file=sys.stderr)
        return {"default_profile": "Small", "profiles": []}


def _cpu(v: Any, fallback: float) -> float:
    s = str(v or "").strip()
    if not s:
        return fallback
    if s.endswith("m"):
        return float(s[:-1]) / 1000
    try:
        return float(s)
    except ValueError:
        return fallback


def _mem(v: Any, fallback: str) -> str:
    """KubeSpawner's mem_guarantee/mem_limit traits accept K/M/G/T (not the
    Ki/Mi/Gi the k8s pod spec uses) — strip the binary 'i' so profiles.yaml
    can keep standard k8s notation (1Gi) without crashing the spawner."""
    s = str(v or "").strip() or fallback
    if len(s) >= 2 and s[-1] == "i" and s[-2] in "KMGT":
        return s[:-1]
    return s


def _as_kubespawner_profile(p: dict[str, Any], default_slug: str) -> dict[str, Any]:
    res = p.get("resources") or {}
    return {
        "display_name": p.get("display_name", p["slug"]),
        "slug": p["slug"],
        "default": p["slug"] == default_slug,
        "description": p.get("description", ""),
        "kubespawner_override": {
            "cpu_guarantee":    _cpu(res.get("cpu_request"), 0.5),
            "cpu_limit":        _cpu(res.get("cpu_limit"), 1.0),
            "mem_guarantee":    _mem(res.get("memory_request"), "1G"),
            "mem_limit":        _mem(res.get("memory_limit"), "2G"),
            "storage_capacity": p.get("pvc_size", "5Gi"),
        },
    }


async def profile_list(spawner) -> list[dict[str, Any]]:
    """Only the profiles the user's roles self-serve (profiles.yaml is the
    contract). API-driven spawns via the gateway service carry no auth_state —
    the gateway has ALREADY enforced eligibility + OPA on its proxy, so those
    see the full catalogue and user_options picks the slug."""
    auth_state = await spawner.user.get_auth_state() or {}
    roles = set(_roles_from_auth_state(auth_state))
    cat = _load_catalogue()
    default_slug = cat.get("default_profile", "Small")
    out = []
    for p in cat.get("profiles", []):
        allowed = set(p.get("self_serve_roles") or [])
        if not roles or (roles & allowed) or "R-SUPER" in roles:
            out.append(_as_kubespawner_profile(p, default_slug))
    if not out:
        out.append({"display_name": "Sandbox (no role profile matched)",
                    "slug": "sandbox", "default": True,
                    "kubespawner_override": {}})
    return out


c.KubeSpawner.profile_list = profile_list

# ─── Pre-spawn: project reconciliation env + warehouse creds ─────────────
MINIO_ENDPOINT   = os.environ.get(
    "MINIO_ENDPOINT", "http://minio-datalake.nhdw.svc.cluster.local:9000")
ARTIFACTS_BUCKET = os.environ.get("ARTIFACTS_BUCKET", "nhdw-artifacts")


async def pre_spawn_hook(spawner):
    env = spawner.environment
    # botocore#3755 workaround for the lab's boto3 sync (Phase 6 step 0): empty PUTs
    # poison pooled connections on Go-based S3 servers (MinIO and SeaweedFS alike).
    env["BOTO_EXPERIMENTAL__NO_EMPTY_CONTINUE"] = os.environ.get("BOTO_EXPERIMENTAL__NO_EMPTY_CONTINUE", "true")
    env["MLFLOW_TRACKING_URI"] = os.environ.get(
        "MLFLOW_TRACKING_URI", "http://mlflow.nhdw.svc.cluster.local:5000")
    # Read-only warehouse access for notebooks (Phase-1 static; OpenBao
    # short-TTL minting is the deferred P-C.2 upgrade).
    for k in ("TRINO_HOST", "TRINO_PORT", "PG_READ_HOST", "PG_READ_DB",
              "PG_READ_USER", "PG_READ_PASSWORD"):
        if os.environ.get(k):
            env[k] = os.environ[k]
    # Project reconciliation (user_options come from the gateway spawn proxy).
    # The named server's own name IS the project id (gateway spawns
    # servers/<project_id>), so fall back to spawner.name when a spawn arrives
    # without user_options (e.g. an implicit/hub-UI start) — that still scopes
    # the lab to the right project instead of an unscoped sandbox.
    opts = spawner.user_options or {}
    project_id = opts.get("project_id") or (spawner.name or "")
    if project_id:
        project_slug = str(opts.get("project_slug") or project_id)
        env["NHDW_PROJECT_ID"]     = str(project_id)
        env["NHDW_PROJECT_SLUG"]   = project_slug
        # Per-project MLflow experiment: a bare mlflow.start_run() in this lab
        # lands in /projects/<slug> instead of Default. MLflow honours this env
        # natively (and the nhdw_mlflow helper calls set_experiment on it, which
        # creates it on first use with the proxied artifact root).
        env["MLFLOW_EXPERIMENT_NAME"] = f"/projects/{project_slug}"
        env["NHDW_PROJECT_PREFIX"] = f"projects/{project_id}/files/"
        env["NHDW_SYNC_BUCKET"]    = ARTIFACTS_BUCKET
        env["NHDW_SYNC_ENDPOINT"]  = MINIO_ENDPOINT
        for k_src, k_dst in (("MINIO_SYNC_ACCESS_KEY", "NHDW_SYNC_ACCESS_KEY"),
                             ("MINIO_SYNC_SECRET_KEY", "NHDW_SYNC_SECRET_KEY")):
            if os.environ.get(k_src):
                env[k_dst] = os.environ[k_src]
        spawner.log.info("project-scoped lab: %s (%s)",
                         opts.get("project_slug"), project_id)


c.KubeSpawner.pre_spawn_hook = pre_spawn_hook

# ─── Hub state ───────────────────────────────────────────────────────────
c.JupyterHub.db_url = "sqlite:////srv/jupyterhub-state/jupyterhub.sqlite"
c.JupyterHub.cookie_secret_file = "/srv/jupyterhub-state/jupyterhub_cookie_secret"
c.JupyterHub.log_level = "INFO"
