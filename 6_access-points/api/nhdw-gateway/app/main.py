"""NHDW gateway — single HTTP data API for every dashboard and any
direct API client (notebooks, Power BI, dataset generators).

Routes live under `app/routes/`:
   /api/me               identity surface
   /api/marts/*          read marts via Trino, OPA-gated
   /api/exports/*        generate exports (Trino → MinIO → ops_export)
   /api/audit/*          recent gateway log for the Admin timeline
   /api/permissions/*    4-axis permission resolver (dashboard spec + widget data)
   /api/admin/perms/*    perm-admin CRUD (roles, grants, users, IdPs)
   /api/api-tokens/*     PAT issue / list / revoke / audit

Local modules:
   auth.py         JWT + PAT + dev-header credential resolution
   opa.py          OPA decide() call (closed under OPA_ENFORCE=true)
   ops_db.py       asyncpg pool → nhdw_ops
   mart_attrs.py   catalog enrichment for OPA + startup self-test
   minio_client.py boto3 → nhdw-exports
   trino_client.py federated read engine

See docs/architecture.md for the system-level picture.
"""
from __future__ import annotations

import logging
import os
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from . import mart_attrs, metrics, opa, ops_db
from .routes import (access_requests, alerts, api_tokens, artifacts, audit,
                      chat, ct, datasets, docs, dq, exports, graduation, groups, marts,
                      me, ml, observability, perm_admin,
                      permissions as permissions_route,
                      policy, projects, public_articles, queries,
                      reports, sql_lab, topology, workspace)
from .settings import settings

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)-7s %(name)s | %(message)s")
log = logging.getLogger("gateway")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("nhdw-gateway boot · ops_db=%s · trino=%s:%s · dev_auth=%s · opa_enforce=%s",
             settings.OPS_PG_HOST, settings.TRINO_HOST, settings.TRINO_PORT,
             settings.DEV_AUTH, settings.OPA_ENFORCE)
    # Eagerly open the ops_db pool so health checks pass deterministically.
    await ops_db.ensure_pool()
    # ── Startup OPA self-test. Walks a known (role, mart) matrix and
    # asserts OPA agrees with the mart_attrs catalog. Fails the boot
    # under OPA_ENFORCE=true; warns otherwise.
    try:
        results = await mart_attrs.run_self_test(opa)
        failures = [(c, r) for c, observed, r in results
                    if observed != c.expect_allow]
        for case, observed, reason in results:
            ok = (observed == case.expect_allow)
            log.log(logging.INFO if ok else logging.WARNING,
                    "opa self-test %s: role=%s mart=%s.%s expect=%s observed=%s · %s",
                    "PASS" if ok else "FAIL",
                    case.role, case.schema, case.table,
                    case.expect_allow, observed, reason)
        if failures and settings.OPA_ENFORCE:
            raise RuntimeError(
                f"OPA self-test failed for {len(failures)} case(s) under OPA_ENFORCE=true; "
                f"refusing to start. Check mart_attrs catalog + role policies.")
    except Exception as e:                                       # noqa: BLE001
        if settings.OPA_ENFORCE:
            raise
        log.warning("opa self-test setup error (enforce off, continuing): %s", e)
    yield
    await ops_db.close_pool()


app = FastAPI(title="NHDW Gateway", version="0.1.0", lifespan=lifespan)


@app.get("/metrics", include_in_schema=False)
async def prometheus_metrics() -> Response:
    """Prometheus scrape target (job `nhdw-gateway`). Unauthenticated on purpose —
    it exposes only aggregate RED counters (no row data, no identifiers), is in
    the audit-skip set below, and the ingress does not route /metrics publicly
    (in-cluster scrape only)."""
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


# Paths that would only add noise to the access log (probes, API docs, static).
_AUDIT_SKIP_PREFIXES = (
    "/health", "/metrics", "/docs", "/redoc", "/openapi.json",
    "/favicon.ico", "/static",
)


def _sniff_principal(request: Request) -> tuple[str | None, str | None]:
    """Best-effort actor id for the catch-all audit row, WITHOUT running the
    auth dependency (the middleware sits above route resolution). Returns
    (kc_sub_uuid_or_None, auth_hint). Decodes the Bearer JWT *unverified* for
    its `sub`; PAT / mock principals carry no JWT sub, so they leave a short
    marker instead. Never raises — any parse failure yields (None, hint)."""
    try:
        authz = request.headers.get("authorization") or ""
        if authz.lower().startswith("bearer "):
            token = authz.split(" ", 1)[1].strip()
            if token.startswith("nhdw_pat_"):
                return None, "pat"
            try:
                from jose import jwt
                sub = jwt.get_unverified_claims(token).get("sub")
                if isinstance(sub, str):
                    try:
                        return str(uuid.UUID(sub)), None   # real kc_sub
                    except ValueError:
                        return None, "jwt"                 # sub isn't a uuid
                return None, "jwt"
            except Exception:                              # noqa: BLE001
                return None, "jwt"
        mock = request.headers.get("x-mock-user")
        if mock:
            try:
                return str(uuid.UUID(mock)), "mock"        # dev mock kc_sub
            except ValueError:
                return None, f"mock:{mock[:8]}"
        return None, None                                  # anonymous / public
    except Exception:                                      # noqa: BLE001
        return None, None


@app.middleware("http")
async def audit_all_requests(request: Request, call_next):
    """Catch-all access log: writes ONE ops_audit.gateway_log base row for
    EVERY request so audit coverage is complete — all endpoints plus 401s that
    never reach a handler — not just the ~10 routers that log richly. Rich
    per-handler log_gateway_query() rows still win: they flip a request-scoped
    marker (ops_db) and this middleware then skips its base row, so each request
    yields exactly one row and none is lost. Everything here is best-effort — a
    logging failure never affects the response. NOTE: ops_audit.gateway_log is
    append-only; production needs a retention / prune job (out of scope here)."""
    path = request.url.path
    if path.startswith(_AUDIT_SKIP_PREFIXES):
        return await call_next(request)

    marker = ops_db.new_request_log_marker()
    t0 = time.perf_counter()
    status = 500  # default covers an unhandled exception in call_next
    try:
        response = await call_next(request)
        status = response.status_code
        return response
    finally:
        # RED metrics for EVERY request (including richly-logged handlers, which
        # skip the audit base row below) — best-effort, never affects the response.
        try:
            metrics.observe(request.method, path, status,
                            time.perf_counter() - t0)
        except Exception:                                  # noqa: BLE001
            log.debug("metrics observe failed for %s", path, exc_info=True)
        try:
            if not marker["logged"]:
                kc_sub, hint = _sniff_principal(request)
                decision = ("error" if status >= 500
                            else "deny" if status in (401, 403)
                            else "allow")
                await ops_db.log_gateway_request(
                    kc_sub=kc_sub, method=request.method, path=path,
                    latency_ms=int((time.perf_counter() - t0) * 1000),
                    http_status=status, policy_decision=decision,
                    client_ip=(request.client.host if request.client else None),
                    user_agent=request.headers.get("user-agent"),
                    auth_hint=hint)
        except Exception:                                  # noqa: BLE001
            # Audit logging must never break the request/response cycle.
            log.debug("audit middleware failed for %s", path, exc_info=True)


app.include_router(me.router)
app.include_router(marts.router)
app.include_router(ct.router)
app.include_router(exports.router)
app.include_router(audit.router)
app.include_router(observability.router)
app.include_router(ml.router)
app.include_router(topology.router)
app.include_router(docs.router)
app.include_router(workspace.router)
app.include_router(graduation.router)
app.include_router(access_requests.public_router)
app.include_router(access_requests.admin_router)
app.include_router(public_articles.public_router)
app.include_router(queries.router)
app.include_router(reports.router)
app.include_router(projects.router)
app.include_router(sql_lab.router)
app.include_router(datasets.router)
app.include_router(policy.router)
app.include_router(alerts.router)
app.include_router(dq.router)
app.include_router(artifacts.router)
app.include_router(groups.router)
app.include_router(permissions_route.router)
app.include_router(perm_admin.router)
app.include_router(api_tokens.router)
app.include_router(chat.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "nhdw-gateway"}
