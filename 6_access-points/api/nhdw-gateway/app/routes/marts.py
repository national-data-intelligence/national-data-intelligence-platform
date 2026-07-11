"""/api/marts — read marts via Trino.

GET /api/marts                              list known marts (Trino marts.bi_*)
GET /api/marts/{schema}/{table}             query a mart with filters
POST /api/marts/{schema}/{table}/export     materialise the result as an export

Filter syntax: query-string keys map to WHERE col=? (or col IN (?,?,…) for
arrays). Reserved keys: `_limit`, `_orderby`, `_columns`.
"""
from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ..auth import UserCtx, get_user
from .. import mart_attrs, ops_db, opa, permissions, trino_client
from ..mart_attrs import MartAttrsMissing
from ..settings import settings

router = APIRouter(prefix="/api/marts", tags=["marts"])


@router.get("")
async def list_marts(request: Request, user: UserCtx = Depends(get_user)) -> dict:
    sql = """
        SELECT table_schema, table_name
        FROM marts.information_schema.tables
        WHERE table_schema LIKE 'bi_%'
        ORDER BY table_schema, table_name
    """
    t0 = time.perf_counter()
    res = await trino_client.query(sql)
    await ops_db.log_gateway_query(
        user=user, method="GET", path="/api/marts",
        mart_scope=[], filters={},
        row_count=res["row_count"], byte_count=None,
        latency_ms=int((time.perf_counter() - t0) * 1000),
        http_status=200, policy_decision="allow")
    return res


@router.get("/{schema}/{table}")
async def get_mart(schema: str, table: str, request: Request,
                   user: UserCtx = Depends(get_user)) -> dict:
    mart = f"{schema}.{table}"

    # Direct-data guard (plan §B6): a raw mart read returns whole rows and can't
    # be generically row-filtered here, so it's restricted to callers WITHOUT a
    # row-scope limit. Scoped regional/programme users (and their PATs) get 403
    # and use the governed widgets/reports, which apply row_filter.
    if await permissions.user_is_row_scoped(await ops_db.ensure_pool(), user):
        await ops_db.log_gateway_query(
            user=user, method="GET", path=f"/api/marts/{mart}",
            mart_scope=[mart], filters={}, row_count=None, byte_count=None,
            latency_ms=0, http_status=403, policy_decision="deny",
            denied_reason="direct mart read denied for row-scoped principal")
        raise HTTPException(
            403, "direct mart access is restricted to unscoped roles — use the "
                 "governed dashboards/reports, which enforce your data scope.")

    # OPA's role policies branch on a subject code (PT/HP/FAC/PRD/PRG)
    # plus data_class / granularity / sensitivity. Look the mart up in
    # the catalog and pass those attributes; a cataloged mart is a
    # prerequisite for serving under OPA_ENFORCE=true.
    try:
        attrs = await mart_attrs.lookup(schema, table)
    except MartAttrsMissing as miss:
        if settings.OPA_ENFORCE:
            await ops_db.log_gateway_query(
                user=user, method="GET", path=f"/api/marts/{mart}",
                mart_scope=[mart], filters={}, row_count=None, byte_count=None,
                latency_ms=0, http_status=403, policy_decision="deny",
                denied_reason=f"mart_attrs catalog miss: {miss}")
            raise HTTPException(
                403, "mart not cataloged — refusing to serve under OPA_ENFORCE=true")
        decision = await opa.decide(user, action="read", resource=mart)
    else:
        decision = await opa.decide(
            user, action="read", resource=attrs.subject,
            attributes=attrs.opa_attributes)

    if not decision.allow:
        await ops_db.log_gateway_query(
            user=user, method="GET", path=f"/api/marts/{mart}",
            mart_scope=[mart], filters={}, row_count=None, byte_count=None,
            latency_ms=0, http_status=403, policy_decision="deny",
            denied_reason=decision.reason)
        raise HTTPException(403, decision.reason or "denied by policy")

    # Parse filters from query string. Reserved: _limit / _orderby / _columns.
    params = dict(request.query_params.multi_items())
    where: dict[str, Any] = {}
    limit = int(params.pop("_limit", "500"))
    columns_csv = params.pop("_columns", "").strip()
    columns = [c.strip() for c in columns_csv.split(",") if c.strip()] or None
    orderby_csv = params.pop("_orderby", "").strip()
    order_by = [o.strip() for o in orderby_csv.split(",") if o.strip()] or None
    for k, v in params.items():
        # ?region=ET-OR&region=ET-AM  →  IN-list
        existing = where.get(k)
        if isinstance(existing, list):
            existing.append(v)
        elif existing is not None:
            where[k] = [existing, v]
        else:
            where[k] = v

    t0 = time.perf_counter()
    try:
        res = await trino_client.fetch_mart(
            schema=schema, table=table, columns=columns,
            where=where or None, order_by=order_by, limit=limit)
        status = 200
    except Exception as exc:
        await ops_db.log_gateway_query(
            user=user, method="GET", path=f"/api/marts/{mart}",
            mart_scope=[mart], filters=where, row_count=None, byte_count=None,
            latency_ms=int((time.perf_counter() - t0) * 1000),
            http_status=500, policy_decision="error", denied_reason=str(exc))
        raise HTTPException(500, f"mart query failed: {exc}")

    await ops_db.log_gateway_query(
        user=user, method="GET", path=f"/api/marts/{mart}",
        mart_scope=[mart], filters=where,
        row_count=res["row_count"], byte_count=None,
        latency_ms=int((time.perf_counter() - t0) * 1000),
        http_status=status, policy_decision="allow",
        policy_obligations={"masked_columns": decision.masked_columns}
            if decision.masked_columns else None)
    return res
