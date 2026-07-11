"""/api/sql/execute — ad-hoc SELECT executor with per-table OPA.

One authorization chain for all SQL execution. Used by:
  - the Internal-BI SQL Lab widget
  - the chatbot's `run_sql` tool (internal delegate)
  - any future PAT-authenticated notebook/exporter doing direct SQL

Pipeline per request:
  1. Strict syntax guard: SELECT/WITH/SHOW/DESCRIBE/EXPLAIN only, single
     statement, no DDL/DML keywords, mandatory LIMIT for SELECT/WITH.
  2. Parse with sqlglot (Trino dialect), extract every referenced
     (catalog, schema, table) triple from FROM + JOIN clauses (including
     subqueries + CTEs).
  3. For each referenced (schema, table):
       a. mart_attrs lookup → 403 if uncataloged
       b. opa.decide(user, action='read', resource=subject, attributes=...)
          → 403 if deny
  4. Execute through trino_client.
  5. Audit log with the parsed table list in mart_scope.

The per-table OPA check is the only gate — a role that can't read any
mart will be 403'd on the first referenced table. There is no separate
"can this role use SQL at all" coarse gate; if the role can read at
least one cataloged mart, it can issue SELECTs against it.
"""
from __future__ import annotations

import logging
import re
import time
from typing import Any

import sqlglot
from sqlglot import exp
from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import UserCtx, get_user
from .. import mart_attrs, ops_db, opa, permissions
from ..mart_attrs import MartAttrsMissing
from ..settings import settings

log = logging.getLogger("gateway.sql_lab")
router = APIRouter(prefix="/api/sql", tags=["sql"])

DEFAULT_MAX_ROWS = 500
HARD_MAX_ROWS   = 5000
TIMEOUT_MS      = 6000
FORBIDDEN = re.compile(
    r"\b(insert|update|delete|drop|alter|create|grant|revoke|"
    r"truncate|copy|merge|call|do|vacuum|comment|reindex)\b", re.I)


class ExecuteRequest(BaseModel):
    sql:   str = Field(min_length=8, max_length=8000)
    limit: int = Field(default=DEFAULT_MAX_ROWS, ge=1, le=HARD_MAX_ROWS)


def _extract_tables(sql: str) -> list[tuple[str, str]]:
    """Parse the SQL with sqlglot and return every distinct
    (schema, table) referenced. Catalog (if present) is dropped because
    every table in our deployment lives in the `marts` Trino catalog
    (postgres-vault); subjects are identified by (schema, table).

    Raises ValueError on parse error or on a table reference without an
    explicit schema (we refuse 1-part names to keep the authz check
    deterministic — the user must qualify their tables)."""
    parsed = sqlglot.parse_one(sql, read="trino")
    out: set[tuple[str, str]] = set()
    for t in parsed.find_all(exp.Table):
        # `t.this`     = table name
        # `t.db`       = schema (if qualified)
        # `t.catalog`  = catalog (if qualified)
        table_name = t.name
        schema_name = t.db
        if not schema_name:
            raise ValueError(
                f"unqualified table reference {table_name!r}; "
                f"use <schema>.<table> or <catalog>.<schema>.<table>")
        out.add((schema_name, table_name))
    return sorted(out)


@router.post("/execute")
async def execute(body: ExecuteRequest = Body(...),
                  user: UserCtx = Depends(get_user)) -> dict[str, Any]:
    # 0. Direct-data guard (plan §B6): raw SQL can't be generically row-filtered,
    # so it's restricted to callers WITHOUT a row-scope limit. A scoped
    # regional/programme user (or their PAT) gets 403 and must use the governed
    # dashboards/reports, which DO apply row_filter.
    if await permissions.user_is_row_scoped(await ops_db.ensure_pool(), user):
        raise HTTPException(
            403, "ad-hoc SQL is restricted to unscoped roles — use the governed "
                 "dashboards/reports, which enforce your data scope.")

    # 1. Strict syntax guard
    q = body.sql.strip().rstrip(";").strip()
    if not q:
        raise HTTPException(400, "empty query")
    if not re.match(r"^(select|with|show|describe|explain)\b", q, re.I):
        raise HTTPException(400,
            "only SELECT/WITH/SHOW/DESCRIBE/EXPLAIN queries are allowed")
    if ";" in q:
        raise HTTPException(400, "only a single statement is allowed")
    if FORBIDDEN.search(q):
        raise HTTPException(400, "only read-only queries are allowed")
    if (re.match(r"^(select|with)\b", q, re.I)
            and not re.search(r"\blimit\b", q, re.I)):
        q = f"{q} LIMIT {body.limit}"

    # 2. Parse + extract referenced tables for per-table OPA enforcement.
    # SHOW/DESCRIBE/EXPLAIN don't read mart rows — they introspect the
    # catalog — so we skip per-table OPA for those (still gated by the
    # coarse ask.sql above).
    referenced: list[tuple[str, str]] = []
    if re.match(r"^(select|with)\b", q, re.I):
        try:
            referenced = _extract_tables(q)
        except (sqlglot.ParseError, ValueError) as exc:
            raise HTTPException(400, f"sql parse error: {exc}")
        if not referenced:
            raise HTTPException(400, "no tables referenced in the query")
        for schema, table in referenced:
            try:
                attrs = await mart_attrs.lookup(schema, table)
            except MartAttrsMissing as miss:
                raise HTTPException(
                    403, f"mart not cataloged: {schema}.{table} — {miss}")
            decision = await opa.decide(
                user, action="read", resource=attrs.subject,
                attributes=attrs.opa_attributes)
            if not decision.allow:
                raise HTTPException(
                    403, f"OPA denied {schema}.{table}: "
                         + (decision.reason or "no reason"))

    # 3. Execute
    t0 = time.perf_counter()
    http_status = 200
    err: str | None = None
    rows: list[dict[str, Any]] = []
    columns: list[str] = []
    from .. import trino_client                              # type: ignore
    try:
        result = await trino_client.query(q)
        columns = result.get("columns") or []
        rows    = (result.get("rows") or [])[:body.limit]
    except Exception as exc:                                # noqa: BLE001
        http_status = 400
        err = str(exc)[:600]
    elapsed_ms = int((time.perf_counter() - t0) * 1000)

    # 4. Audit
    table_scope = [f"{s}.{t}" for s, t in referenced] or ["sql_lab"]
    await ops_db.log_gateway_query(
        user=user, method="POST", path="/api/sql/execute",
        mart_scope=table_scope, filters={"sql_preview": q[:200]},
        row_count=len(rows), byte_count=None,
        latency_ms=elapsed_ms, http_status=http_status,
        policy_decision="allow" if http_status == 200 else "error",
        denied_reason=err)

    if err is not None:
        raise HTTPException(400, err)

    return {
        "columns":     columns,
        "rows":        rows,
        "row_count":   len(rows),
        "elapsed_ms":  elapsed_ms,
        "tables_used": table_scope if referenced else [],
    }
