"""Public Dashboard ↔ marts read layer.

REWRITTEN: this module used to mint short-TTL Postgres creds via OpenBao
and query PG directly. Now it calls the central NHDW gateway over HTTP.

Why the change:
  - the gateway is the single chokepoint for OPA + audit + export logic;
    duplicating that surface in each dashboard creates drift.
  - the dashboard no longer needs Postgres creds, asyncpg, or OpenBao
    integration at all. One env var (NHDW_GATEWAY_URL) is the wire.
  - if the gateway is down, the dashboard still serves placeholder data
    instead of leaking exceptions — same graceful-degradation contract.

API surface unchanged:
  ``await facility_counts()`` → ECharts-shaped {x, series}.

Add a new slug-to-mart shim per dashboard slug as new marts come online.
"""
from __future__ import annotations

import logging
import os
from typing import Any

import httpx

log = logging.getLogger("public-dashboard.marts")

GATEWAY_URL = os.environ.get("NHDW_GATEWAY_URL", "http://nhdw-gateway:8000")
GATEWAY_TIMEOUT_S = float(os.environ.get("NHDW_GATEWAY_TIMEOUT_S", "5"))


async def _gw_get_mart(schema: str, table: str,
                       columns: list[str] | None = None,
                       order_by: list[str] | None = None,
                       limit: int = 500) -> list[dict[str, Any]]:
    """GET /api/marts/{schema}/{table} from the gateway. Returns rows."""
    params: dict[str, Any] = {"_limit": str(limit)}
    if columns:
        params["_columns"] = ",".join(columns)
    if order_by:
        params["_orderby"] = ",".join(order_by)
    async with httpx.AsyncClient(timeout=GATEWAY_TIMEOUT_S) as c:
        # Anonymous read: no auth header, the gateway maps that to R-PUB-ANON.
        r = await c.get(f"{GATEWAY_URL}/api/marts/{schema}/{table}", params=params)
        r.raise_for_status()
        return (r.json() or {}).get("rows", [])


# ─── Series builders — one per dashboard slug ─────────────────────────────


async def facility_counts() -> dict[str, Any]:
    """National Facility Distribution: region × n_facilities.
    Sourced from `bi_public.bi_facility_distribution_public` (k≥5 enforced
    in the mart SQL).
    """
    rows = await _gw_get_mart(
        schema="bi_public", table="bi_facility_distribution_public",
        columns=["region_name", "n_facilities"],
        order_by=["n_facilities DESC"], limit=20)
    return {
        "x": [r["region_name"] for r in rows],
        "series": [{
            "name": "Facilities",
            "data": [int(r["n_facilities"] or 0) for r in rows],
        }],
    }


async def national_coverage() -> dict[str, Any]:
    """National Programme Coverage: programme × period coverage_pct rollup
    from the k-anonymous public summary mart.
    """
    rows = await _gw_get_mart(
        schema="bi_public", table="mart_public_summary",
        columns=["programme_id", "month_id", "coverage_pct"],
        order_by=["month_id", "programme_id"], limit=500)
    # Pivot into ECharts shape: x=months, one series per programme.
    months: list[str] = sorted({r["month_id"] for r in rows if r.get("month_id")})
    programmes: list[str] = sorted({r["programme_id"] for r in rows if r.get("programme_id")})
    series = []
    for p in programmes:
        data = []
        for m in months:
            v = next((r["coverage_pct"] for r in rows
                      if r["programme_id"] == p and r["month_id"] == m), None)
            data.append(float(v) if v is not None else None)
        series.append({"name": p, "data": data})
    return {"x": months, "series": series}


async def stock_availability() -> dict[str, Any]:
    """Commodity stock availability by region.
    Once `bi_public.mart_supply_stockout_public` ships, this maps directly.
    Returns an empty payload until then (the route falls back to a placeholder).
    """
    try:
        rows = await _gw_get_mart(
            schema="bi_public", table="mart_supply_stockout_public",
            columns=["region_name", "stocked_pct"],
            order_by=["region_name"], limit=20)
    except Exception as exc:
        log.warning("stock_availability mart not available yet: %s", exc)
        return {"x": [], "series": []}
    return {
        "x": [r["region_name"] for r in rows],
        "series": [{
            "name": "% facilities stocked",
            "data": [float(r["stocked_pct"] or 0) for r in rows],
        }],
    }
