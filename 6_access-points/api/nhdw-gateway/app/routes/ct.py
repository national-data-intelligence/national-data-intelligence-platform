"""/api/ct — Supply Control Tower plan.

GET /api/ct/plan?period=<period_id>

Returns ONE nested JSON object shaped exactly like the runtime exports of the
internal-BI CT page's data/plan.ts, but sourced live from the bi_supply marts
(mart_ct_nodes / mart_ct_movements / mart_ct_vehicle_runs / mart_ct_plan_stats)
via Trino:

    { regions, regionNames, periods, currentPeriod, commodities, warehouses,
      nodes, movements, vehicleRuns, selectedId, periodStats, summary, baseline }

OPA is enforced here (the CT React islands fetch this route, not the per-widget
fetcher path): subject=PRD, data_class=DC.STK, granularity=aggregate. The
caller's role scope is pushed to OPA and the returned geography row_filter is
AND-applied to the movement/run rows (region_id), exactly like the supply
fetchers. Warehouses + facilities (fixed reference geography) are returned whole.
"""
from __future__ import annotations

import json
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth import UserCtx, get_user
from .. import mart_attrs, masking, opa, ops_db, permissions, trino_client

router = APIRouter(prefix="/api/ct", tags=["ct"])

_SCHEMA = "marts.bi_supply"
_OPA_ATTRS = {"data_class": "DC.STK", "granularity": "aggregate", "sensitivity": "default"}


# ── coercion helpers (Trino returns Decimal/int/str; plan.ts wants number/bool) ─
def _f(v):
    return None if v is None else float(v)


def _i(v):
    return None if v is None else int(v)


def _b(v):
    return None if v is None else bool(v)


def _j(v, default):
    if v is None:
        return default
    if isinstance(v, (list, dict)):
        return v
    try:
        return json.loads(v)
    except (ValueError, TypeError):
        return default


def _sql_in(values: list[str]) -> str:
    safe = ", ".join("'" + str(v).replace("'", "''") + "'" for v in values)
    return f"({safe})"


def _warehouse(r: dict) -> dict:
    return {"id": r["node_id"], "name": r["name"], "short": r.get("short_name"),
            "zone": r.get("zone"), "lng": _f(r.get("lng")), "lat": _f(r.get("lat")),
            "hub": _b(r.get("is_hub")), "vehicles": _i(r.get("vehicles"))}


def _node(r: dict) -> dict:
    return {"id": r["node_id"], "name": r["name"], "region": r.get("region"),
            "type": r.get("node_type"), "lng": _f(r.get("lng")), "lat": _f(r.get("lat")),
            "lineCount": _i(r.get("line_count")), "storeCap": _i(r.get("store_cap"))}


def _movement(r: dict) -> dict:
    return {
        "id": r["movement_id"], "period": r["period_id"], "fromId": r["from_hub_id"],
        "toId": r["to_node_id"], "drug": r.get("drug"), "drugShort": r.get("drug_short"),
        "commodityKey": r.get("commodity_key"), "units": _i(r.get("units")),
        "amc": _i(r.get("amc")), "mos": _f(r.get("mos")),
        "daysToStockout": _i(r.get("days_to_stockout")), "priority": _i(r.get("priority")),
        "laneKm": _i(r.get("lane_km")), "costUnits": _i(r.get("cost_units")),
        "sequenceIndex": _i(r.get("sequence_index")), "vehicleRunId": r.get("vehicle_run_id"),
        "fillRate": _f(r.get("fill_rate")), "nearestHubId": r.get("nearest_hub_id"),
        "altHubId": r.get("alt_hub_id"), "reason": r.get("reason"),
        "assignDeltaKm": _i(r.get("assign_delta_km")), "assignDeltaCost": _i(r.get("assign_delta_cost")),
        "baselineHubId": r.get("baseline_hub_id"), "baselineKm": _i(r.get("baseline_km")),
        "planned": _b(r.get("planned")), "repaired": _b(r.get("repaired")),
        "capped": _b(r.get("capped")), "why": _j(r.get("why_json"), {}),
    }


def _run(r: dict) -> dict:
    return {
        "id": r["run_id"], "period": r["period_id"], "vehicleType": r.get("vehicle_type"),
        "capacityUnits": _i(r.get("capacity_units")), "originHubId": r.get("origin_hub_id"),
        "stops": _j(r.get("stops_json"), []), "path": _j(r.get("path_json"), []),
        "totalRoadKm": _i(r.get("total_road_km")), "totalUnits": _i(r.get("total_units")),
        "fillRate": _f(r.get("fill_rate")), "costTotal": _i(r.get("cost_total")),
        "costPerUnit": _f(r.get("cost_per_unit")),
        "kmSavedVsBaseline": _i(r.get("km_saved_vs_baseline")),
        "depart": r.get("depart"), "eta": r.get("eta"), "status": r.get("status"),
    }


def _period_stat(r: dict) -> dict:
    return {"period": r["period_id"], "label": r.get("label"),
            "movements": _i(r.get("movements")), "units": _i(r.get("units")),
            "runs": _i(r.get("runs")), "avgFill": _f(r.get("avg_fill")),
            "facilities": _i(r.get("facilities"))}


def _summary(r: dict) -> dict:
    return {"period": r["period_id"], "unitsAcrossLegs": _i(r.get("units")),
            "uncoveredNeeds": _i(r.get("uncovered_needs")),
            "atRiskFacilities": _i(r.get("at_risk_facilities")),
            "legs": _i(r.get("movements")), "facilities": _i(r.get("facilities")),
            "vehicleRuns": _i(r.get("runs")), "avgFillRate": _f(r.get("avg_fill")),
            "overflowLegs": _i(r.get("overflow_legs")), "minMonths": _i(r.get("min_months")),
            "maxMonths": _i(r.get("max_months"))}


def _baseline(r: dict) -> dict:
    return {"optimizedKm": _i(r.get("optimized_km")), "baselineKm": _i(r.get("baseline_km")),
            "kmSaved": _i(r.get("km_saved")), "kmSavedPct": _i(r.get("km_saved_pct")),
            "optimizedCost": _i(r.get("optimized_cost")), "baselineCost": _i(r.get("baseline_cost")),
            "costSaved": _i(r.get("cost_saved")), "costSavedPct": _i(r.get("cost_saved_pct")),
            "vehiclesUsed": _i(r.get("vehicles_used")), "naiveVehicles": _i(r.get("naive_vehicles")),
            "vehiclesSaved": _i(r.get("vehicles_saved"))}


@router.get("/plan")
async def ct_plan(period: str | None = Query(None, description="planning period id, e.g. 2025-M11"),
                  user: UserCtx = Depends(get_user)) -> dict:
    t0 = time.perf_counter()
    pool = await ops_db.ensure_pool()

    # OPA mart-level gate (subject=PRD / DC.STK / aggregate) + role scope → row_filter.
    # The nodes feed carries facility GPS (mart_ct_nodes.lat/lng, classified
    # restricted/generalize) — push the classification so OPA decides whether
    # THIS caller sees exact coordinates; masking applied to the node rows below.
    async with pool.acquire() as _c:
        scope = await permissions.effective_user_scope(_c, user)
    node_colclass = await mart_attrs.columns_for_mart(_SCHEMA, "mart_ct_nodes")
    decision = await opa.decide(user, action="read", resource="PRD",
                                attributes=_OPA_ATTRS, scope=scope,
                                columns={n: c.sensitivity for n, c in node_colclass.items()})
    if not decision.allow:
        await ops_db.log_gateway_query(
            user=user, method="GET", path="/api/ct/plan",
            mart_scope=[f"{_SCHEMA}.mart_ct_movements"], filters={}, row_count=None,
            byte_count=None, latency_ms=int((time.perf_counter() - t0) * 1000),
            http_status=403, policy_decision="deny", denied_reason=decision.reason)
        raise HTTPException(403, "Supply Control Tower denied by policy: " + (decision.reason or ""))

    geo = decision.row_filter.get("geography") or []
    geo_clause = f" WHERE region_id IN {_sql_in(geo)}" if geo else ""

    try:
        stats_rows = (await trino_client.query(
            f"SELECT * FROM {_SCHEMA}.mart_ct_plan_stats ORDER BY sort_order")).get("rows") or []
        node_rows = (await trino_client.query(
            f"SELECT * FROM {_SCHEMA}.mart_ct_nodes")).get("rows") or []
        if decision.masked_columns:
            node_rows, _ = masking.apply_masking(
                node_rows, node_colclass, decision.masked_columns)
        mv_rows = (await trino_client.query(
            f"SELECT * FROM {_SCHEMA}.mart_ct_movements{geo_clause}")).get("rows") or []
        # Runs: scope-follow the movements (a run referenced by an in-scope
        # movement); unscoped callers get every run for completeness.
        if geo:
            run_ids = sorted({m["vehicle_run_id"] for m in mv_rows if m.get("vehicle_run_id")})
            run_clause = f" WHERE run_id IN {_sql_in(run_ids)}" if run_ids else " WHERE 1 = 0"
        else:
            run_clause = ""
        run_rows = (await trino_client.query(
            f"SELECT * FROM {_SCHEMA}.mart_ct_vehicle_runs{run_clause}")).get("rows") or []
    except HTTPException:
        raise
    except Exception as exc:
        await ops_db.log_gateway_query(
            user=user, method="GET", path="/api/ct/plan", mart_scope=[_SCHEMA],
            filters={}, row_count=None, byte_count=None,
            latency_ms=int((time.perf_counter() - t0) * 1000),
            http_status=500, policy_decision="error", denied_reason=str(exc))
        raise HTTPException(500, f"CT plan query failed: {exc}")

    warehouses = [_warehouse(r) for r in node_rows if r.get("node_kind") == "hub"]
    nodes = [_node(r) for r in node_rows if r.get("node_kind") == "facility"]
    movements = [_movement(r) for r in mv_rows]
    runs = [_run(r) for r in run_rows]
    period_stats = [_period_stat(r) for r in stats_rows]
    periods = [{"id": r["period_id"], "label": r.get("label")} for r in stats_rows]

    # currentPeriod: requested (if valid) else the latest planning period.
    stat_by_period = {r["period_id"]: r for r in stats_rows}
    latest = stats_rows[-1]["period_id"] if stats_rows else None
    current_period = period if (period and period in stat_by_period) else latest
    cur_stat = stat_by_period.get(current_period)

    # regionNames / commodities: derived from the returned reference data, ordered.
    region_names = sorted({n["region"] for n in nodes if n.get("region")})
    regions = [{"name": rn} for rn in region_names]
    commodities = sorted({m["drugShort"] for m in movements if m.get("drugShort")})

    # selectedId: the most urgent (highest priority) movement in the current period.
    cur_moves = [m for m in movements if m["period"] == current_period]
    selected_id = None
    if cur_moves:
        selected_id = max(cur_moves, key=lambda m: (m.get("priority") or 0, m["id"]))["id"]

    await ops_db.log_gateway_query(
        user=user, method="GET", path="/api/ct/plan",
        mart_scope=[f"{_SCHEMA}.mart_ct_movements"],
        filters={"geography": geo} if geo else {},
        row_count=len(movements), byte_count=None,
        latency_ms=int((time.perf_counter() - t0) * 1000),
        http_status=200, policy_decision="allow")

    return {
        "regions": regions,
        "regionNames": region_names,
        "periods": periods,
        "currentPeriod": current_period,
        "commodities": commodities,
        "warehouses": warehouses,
        "nodes": nodes,
        "movements": movements,
        "vehicleRuns": runs,
        "selectedId": selected_id,
        "periodStats": period_stats,
        "summary": _summary(cur_stat) if cur_stat else None,
        "baseline": _baseline(cur_stat) if cur_stat else None,
    }
