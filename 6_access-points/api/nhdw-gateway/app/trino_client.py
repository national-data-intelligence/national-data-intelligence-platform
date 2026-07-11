"""Trino client — used by every mart-read route.

`trino` is a sync driver; we wrap calls in a thread executor.

A short SQL-allowlist is enforced: only SELECT/SHOW statements + a
short prefix list. The Workshop SQL editor's free-form input goes
through the same allowlist.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

from trino import dbapi as trino_dbapi
from trino.auth import BasicAuthentication

from .settings import settings

log = logging.getLogger("gateway.trino")

_ALLOWED_RE = re.compile(r"^\s*(SELECT|SHOW|DESCRIBE|EXPLAIN|WITH)\b", re.IGNORECASE)


class TrinoRejected(Exception):
    """Statement disallowed by the gateway-side SQL allowlist."""


def _connect() -> Any:
    return trino_dbapi.connect(
        host=settings.TRINO_HOST,
        port=settings.TRINO_PORT,
        user=settings.TRINO_USER,
        catalog="marts",
        schema="information_schema",
        request_timeout=30,
        session_properties={
            # dbt materializes aggregate mart columns as unparameterized NUMERIC;
            # the PostgreSQL connector's default decimal-mapping=STRICT silently
            # DROPS those columns from the table metadata, so amc/mos/coverage_pct/…
            # would be invisible to every query. Map them to decimal(38,4) instead
            # so all mart reads (widget fetchers, SQL editor) can see them.
            # The same applies to the `ops` catalog (ops_ml.ml_predictions'
            # pred_cases_*/alarm_* columns are unparameterized NUMERIC too) —
            # the ML-fed dz-* fetchers cross-catalog-join marts + ops.
            "marts.decimal_mapping": "ALLOW_OVERFLOW",
            "marts.decimal_default_scale": "4",
            "marts.decimal_rounding_mode": "HALF_UP",
            "ops.decimal_mapping": "ALLOW_OVERFLOW",
            "ops.decimal_default_scale": "4",
            "ops.decimal_rounding_mode": "HALF_UP",
        },
    )


def _check_allowed(sql: str) -> None:
    if not _ALLOWED_RE.match(sql or ""):
        raise TrinoRejected("only SELECT / SHOW / DESCRIBE / EXPLAIN / WITH are allowed")


async def query(sql: str, params: list[Any] | None = None,
                catalog: str | None = None, schema: str | None = None) -> dict[str, Any]:
    """Run a query through Trino; return {columns, rows, row_count}.

    `params` are positional `?` substitutions (Trino DBAPI style)."""
    _check_allowed(sql)
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _run_blocking, sql, params, catalog, schema)


def _run_blocking(sql: str, params: list[Any] | None,
                  catalog: str | None, schema: str | None) -> dict[str, Any]:
    conn = _connect()
    try:
        cur = conn.cursor()
        if catalog or schema:
            cur.execute(
                f"USE {catalog or 'marts'}.{schema or 'information_schema'}")
            cur.fetchall()
        cur.execute(sql, params or None)
        rows = cur.fetchall()
        cols = [c[0] for c in cur.description]
        return {
            "columns": cols,
            "rows":    [dict(zip(cols, r)) for r in rows],
            "row_count": len(rows),
        }
    finally:
        conn.close()


async def fetch_mart(*, catalog: str = "marts", schema: str, table: str,
                    columns: list[str] | None = None,
                    where: dict[str, Any] | None = None,
                    order_by: list[str] | None = None,
                    limit: int | None = 500) -> dict[str, Any]:
    """Convenience wrapper for the common mart-read shape used by the
    /api/marts/<name> route — builds a parameterised SELECT."""
    cols = ", ".join(columns) if columns else "*"
    sql = f'SELECT {cols} FROM {catalog}.{schema}."{table}"'
    params: list[Any] = []
    if where:
        parts: list[str] = []
        for k, v in where.items():
            if isinstance(v, list):
                parts.append(f'"{k}" IN ({", ".join(["?"]*len(v))})')
                params.extend(v)
            else:
                parts.append(f'"{k}" = ?')
                params.append(v)
        if parts:
            sql += " WHERE " + " AND ".join(parts)
    if order_by:
        sql += " ORDER BY " + ", ".join(order_by)
    if limit:
        sql += f" LIMIT {int(limit)}"
    return await query(sql, params)
