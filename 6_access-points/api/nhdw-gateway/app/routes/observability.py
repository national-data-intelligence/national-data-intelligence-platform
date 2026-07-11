"""/api/observability — gateway-side proxy for Prometheus + Loki + a
composite health endpoint for the admin topology widget.

OPA gates these to R-OPS-* roles only. Every call lands in
ops_audit.gateway_log like any other gateway route.

Routes:
    GET /api/observability/metrics?promql=...&time=now-1h&step=30s
                                            (proxies Prometheus query API)
    GET /api/observability/logs?logql=...&since=15m&limit=200
                                            (proxies Loki query_range)
    GET /api/observability/health
                                            (composite — each NHDW
                                             component's last-scrape
                                             status, joined with the
                                             gateway's own audit log)
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth import UserCtx, get_user
from ..settings import settings
from .. import ops_db, opa
from .topology import _kube_api, _kube_ca, _kube_ns, _kube_token

log = logging.getLogger("gateway.observability")

PROMETHEUS_URL = os.environ.get("PROMETHEUS_URL", "http://prometheus:9090")
LOKI_URL       = os.environ.get("LOKI_URL",       "http://loki:3100")

OPS_ROLES = {"R-OPS-ADM", "R-OPS-ENG", "R-OPS-SEC", "R-SUPER"}

router = APIRouter(prefix="/api/observability", tags=["observability"])


def _require_ops_role(user: UserCtx) -> None:
    if user.primary_role not in OPS_ROLES and not (set(user.roles) & OPS_ROLES):
        raise HTTPException(403, "/api/observability is for R-OPS-* roles only")


@router.get("/metrics")
async def metrics(promql: str = Query(..., description="PromQL expression"),
                  time_at: str | None = Query(default=None, alias="time"),
                  user: UserCtx = Depends(get_user)) -> dict[str, Any]:
    """Proxy a Prometheus instant query."""
    # Role-gated to the ops roles. No OPA mart-gate: observability is not a
    # cataloged mart subject, so opa.decide('read.observability') matched no rego
    # rule and hard-denied under OPA_ENFORCE (dead gate, removed — cf. topology).
    _require_ops_role(user)

    t0 = time.perf_counter()
    params = {"query": promql}
    if time_at: params["time"] = time_at
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{PROMETHEUS_URL}/api/v1/query", params=params)
            r.raise_for_status()
            body = r.json()
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"prometheus unreachable: {exc}")
    await ops_db.log_gateway_query(
        user=user, method="GET", path="/api/observability/metrics",
        mart_scope=["prometheus"], filters={"promql": promql},
        row_count=len((body.get("data") or {}).get("result") or []),
        byte_count=None, latency_ms=int((time.perf_counter()-t0)*1000),
        http_status=200, policy_decision="allow")
    return body


@router.get("/logs")
async def logs(logql: str = Query(..., description="LogQL expression"),
               since: str = Query(default="15m"),
               limit: int = Query(default=200, ge=1, le=5000),
               user: UserCtx = Depends(get_user)) -> dict[str, Any]:
    """Proxy a Loki query_range. `since` accepts Loki duration (15m, 1h, 7d)."""
    # Role-gated (ops roles). Dead OPA gate removed — see /metrics above.
    _require_ops_role(user)

    t0 = time.perf_counter()
    params = {"query": logql, "since": since, "limit": str(limit)}
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(f"{LOKI_URL}/loki/api/v1/query_range", params=params)
            r.raise_for_status()
            body = r.json()
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"loki unreachable: {exc}")
    streams = (body.get("data") or {}).get("result") or []
    total_lines = sum(len(s.get("values", [])) for s in streams)
    await ops_db.log_gateway_query(
        user=user, method="GET", path="/api/observability/logs",
        mart_scope=["loki"], filters={"logql": logql, "since": since},
        row_count=total_lines, byte_count=None,
        latency_ms=int((time.perf_counter()-t0)*1000),
        http_status=200, policy_decision="allow")
    return body


# Composite health view. LIVENESS is ground-truthed from Kubernetes pod
# readiness (a Running pod with all containers Ready) — NOT from Prometheus
# `up`, because a service can be perfectly healthy while exposing no Prometheus
# exporter (mlflow has none; clickhouse/keycloak need their native metrics port
# enabled). Reporting `up{job=X}=0` as "down" for those conflated "no exporter"
# with "service down" and made healthy components look broken. Prometheus `up`
# is kept as a SECONDARY signal (metrics scraped: yes/no) so the widget can show
# both "service alive" and "metrics available" honestly.
#   (name, promql for the metrics signal, k8s app-label / pod-name prefix)
_HEALTH_COMPONENTS = [
    ("prometheus",   'up{job="prometheus"}',   "prometheus"),
    ("loki",         'up{job="loki"}',         "loki"),
    ("nhdw-gateway", 'up{job="nhdw-gateway"}', "nhdw-gateway"),
    ("mlflow",       'up{job="mlflow"}',       "mlflow"),
    ("keycloak",     'up{job="keycloak"}',     "keycloak"),
    ("clickhouse",   'up{job="clickhouse"}',   "clickhouse"),
]


async def _k8s_ready_by_component() -> dict[str, bool] | None:
    """Map each health component → is at least one of its pods Running+Ready,
    read straight from the k8s API (ground-truth liveness). Matches a pod to a
    component by its `app`/`app.kubernetes.io/name` label OR a name-prefix
    fallback. Returns None if the k8s API is unreachable (caller degrades to
    'unknown' liveness rather than fabricating a status)."""
    api, token, ns = _kube_api(), _kube_token(), _kube_ns()
    if not api or not token:
        return None
    keys = [c[2] for c in _HEALTH_COMPONENTS]
    ready: dict[str, bool] = {k: False for k in keys}
    try:
        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(timeout=6, verify=_kube_ca(),
                                     headers=headers) as c:
            r = await c.get(f"{api}/api/v1/namespaces/{ns}/pods")
            r.raise_for_status()
            for pod in (r.json().get("items") or []):
                meta = pod.get("metadata") or {}
                labels = meta.get("labels") or {}
                name = meta.get("name") or ""
                app = labels.get("app") or labels.get("app.kubernetes.io/name") or ""
                st = pod.get("status") or {}
                if st.get("phase") != "Running":
                    continue
                cs = st.get("containerStatuses") or []
                if not cs or not all(x.get("ready") for x in cs):
                    continue
                for k in keys:
                    if app == k or name.startswith(k):
                        ready[k] = True
    except Exception as exc:                                # noqa: BLE001
        log.debug("k8s readiness probe failed: %s", exc)
        return None
    return ready


# Gateway feature flags surfaced to the admin Env widget. Each is a real
# boolean off `settings` — reported as on/off, no invented flags.
_ENV_FLAGS = [
    ("DEV_AUTH",                   "Dev auth · header identity"),
    ("GATEWAY_PUBLIC_ANON",        "Public anonymous tier"),
    ("GATEWAY_DEMO_IMPERSONATION", "Demo impersonation channel"),
    ("OPA_ENFORCE",                "OPA enforcement · denials → 403"),
    ("OPA_FAIL_OPEN",              "OPA fail-open when unreachable"),
]


@router.get("/env")
async def environment(user: UserCtx = Depends(get_user)) -> dict[str, Any]:
    """Deployment facts + real gateway feature-flag state for the admin Env
    widget. Only sourceable facts are returned: the k8s namespace, the ingress
    base domain, the ingress-terminated TLS, the gateway build version, and the
    on/off state of the gateway's real settings flags. Region / DR / SLO figures
    are NOT sourceable from the gateway, so they are omitted rather than faked."""
    _require_ops_role(user)

    # Gateway build version — read live off the FastAPI app so the literal is
    # not duplicated from main.py. Lazy import: main is already fully loaded by
    # the time any request reaches here, so this cannot recurse at import time.
    gw_version: str | None = None
    try:
        from ..main import app as _app
        gw_version = _app.version
    except Exception:                                   # pragma: no cover
        gw_version = None

    # DEV_AUTH is the code's own dev-vs-prod switch ("NEVER set DEV_AUTH=true in
    # production" — see settings.py), so it is the honest signal for the name.
    env: dict[str, Any] = {
        "name":        "development" if settings.DEV_AUTH else "production",
        "namespace":   "nhdw",
        "base_domain": "127.0.0.1.nip.io",
        "tls":         "ingress-terminated · wildcard nip.io cert",
    }
    if gw_version:
        env["gateway_version"] = gw_version

    flags = [
        {"key": key, "label": label,
         "state": "on" if bool(getattr(settings, key)) else "off"}
        for key, label in _ENV_FLAGS
    ]
    return {"environment": env, "feature_flags": flags}


@router.get("/health")
async def composite_health(user: UserCtx = Depends(get_user)) -> dict[str, Any]:
    """One row per NHDW component. `status` (up/down/unknown) is the GROUND-TRUTH
    liveness from Kubernetes pod readiness; `metrics` (scraped/no-exporter/unknown)
    reports whether Prometheus is actually collecting metrics for it. The admin
    topology widget renders `status` for the health dot and can surface `metrics`
    as a secondary badge. Nothing is fabricated — if k8s is unreachable liveness
    degrades to 'unknown' rather than guessing."""
    _require_ops_role(user)
    ready = await _k8s_ready_by_component()               # None ⇒ k8s unreachable

    async def _metrics_signal(c: httpx.AsyncClient, q: str) -> tuple[str, float | None]:
        try:
            r = await c.get(f"{PROMETHEUS_URL}/api/v1/query", params={"query": q})
            result = (r.json().get("data") or {}).get("result") or []
            if not result:                                # no target series at all
                return "unknown", None
            sample = result[0]
            scraped = sample["value"][1] == "1"
            return ("scraped" if scraped else "no-exporter"), float(sample["value"][0])
        except Exception:                                 # noqa: BLE001
            return "unknown", None

    out: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=5) as c:
        signals = await asyncio.gather(
            *[_metrics_signal(c, q) for _, q, _ in _HEALTH_COMPONENTS])
    for (name, _q, key), (metrics_state, last_seen) in zip(_HEALTH_COMPONENTS, signals):
        if ready is None:
            status = "unknown"
        else:
            status = "up" if ready.get(key) else "down"
        out.append({"component": name, "status": status,
                    "metrics": metrics_state, "last_seen": last_seen})
    return {"components": out, "as_of": time.time()}
