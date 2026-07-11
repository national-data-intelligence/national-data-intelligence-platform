"""Prometheus instrumentation for the gateway — RED metrics (Request rate,
Error rate, Duration) exposed at GET /metrics for the in-cluster Prometheus.

Prometheus already ships a scrape job `nhdw-gateway` pointed at
`nhdw-gateway.nhdw.svc.cluster.local:8000` (see the `prometheus-config`
ConfigMap); before this module existed that scrape 404'd, so
`up{job="nhdw-gateway"}` was 0 and the admin observability /health widget
falsely rendered the gateway as **down** while it was serving traffic. Exposing
/metrics closes that: the scrape succeeds, `up` flips to 1, and the same
request stream the audit middleware already measures becomes real RED series
queryable by PromQL alongside every other component.

LOW-CARDINALITY BY DESIGN. The `route` label is collapsed to the first two path
segments (e.g. `/api/dq`, `/api/permissions`) — never the raw path — so the
unbounded id spaces in the URL (`/api/permissions/widget/<id>/data`,
`/api/dq/ack`, per-mart export ids) cannot explode the series count. Method and
status stay as-is (both are small, bounded sets)."""
from __future__ import annotations

from prometheus_client import Counter, Histogram

# Request rate + error rate (status carries the errors — 4xx/5xx buckets).
REQUESTS = Counter(
    "nhdw_gateway_requests_total",
    "Total gateway HTTP requests handled, by method, collapsed route, and status.",
    ["method", "route", "status"],
)

# Duration — seconds, default-ish latency buckets tuned for an API gateway that
# fronts Trino/Postgres (sub-10ms health probes up to multi-second mart reads).
LATENCY = Histogram(
    "nhdw_gateway_request_duration_seconds",
    "Gateway request latency in seconds, by method and collapsed route.",
    ["method", "route"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)


def route_label(path: str) -> str:
    """Collapse a request path to its router prefix (≤2 segments) so the
    `route` label space stays bounded regardless of ids embedded in the URL."""
    parts = [p for p in path.split("/") if p]
    if not parts:
        return "/"
    return "/" + "/".join(parts[:2])


def observe(method: str, path: str, status: int, elapsed_s: float) -> None:
    """Record one request. Best-effort — callers wrap this so an instrumentation
    error can never affect the response."""
    route = route_label(path)
    REQUESTS.labels(method=method, route=route, status=str(status)).inc()
    LATENCY.labels(method=method, route=route).observe(elapsed_s)
