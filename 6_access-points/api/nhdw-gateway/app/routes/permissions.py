"""/api/permissions — endpoints for the 4-axis permission model.

Endpoints:
  GET /api/permissions/dashboard/{id}/spec
       → ResolvedDashboard for the caller, or 404 if no access.
  GET /api/permissions/filter/{id}/values?page_id=&widget_id=
       → canonical filter values intersected with the role's allowed set.
  GET /api/permissions/widget/{id}/data?page_id=&<filter>=<val>...
       → widget data, gated on (widget access ∧ filter values ∧ OPA mart).
       The data path returns a permitted-stub for widgets without a
       bound mart fetcher — the auth chain is live regardless.
  GET /api/permissions/me
       → UserCtx + capabilities + role codes. SPA bootstrap call.
"""
from __future__ import annotations

import logging
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from .. import mart_attrs, ops_db, opa, permissions
from ..auth import UserCtx, get_user
from ..mart_attrs import MartAttrsMissing
from ..settings import settings

router = APIRouter(prefix="/api/permissions", tags=["permissions"])
log = logging.getLogger("gateway.routes.permissions")


# The UI's 'geography' dim is governed by the catalog's 'region' filter (the
# grants seed caps roles under filter_id 'region', while the filter bar's param
# is named 'geography'). Gate 2 checks BOTH spellings so a region-capped role
# (e.g. locked to ['OR']) cannot slip an out-of-cap region through the alias.
_FILTER_PARAM_ALIASES: dict[str, tuple[str, ...]] = {
    "geography": ("geography", "region"),
    "region":    ("region", "geography"),
}


def _effective_cap(caps: dict[str, list[str] | None], fid: str) -> list[str] | None:
    """The role's allowed-value cap for a query param, alias-aware.
    Returns None for wildcard/ungoverned (accept anything)."""
    for key in _FILTER_PARAM_ALIASES.get(fid, (fid,)):
        if caps.get(key) is not None:
            return caps[key]
    return None


# ─── /me ───────────────────────────────────────────────────────────────
@router.get("/me")
async def me(user: UserCtx = Depends(get_user)) -> dict:
    """Identity + capabilities for the caller. Lightweight bootstrap call
    every SPA makes before fetching a dashboard spec."""
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        rids = await permissions._resolve_role_ids(conn, user)
        capabilities = await permissions._role_capabilities(conn, rids)
        role_codes   = await permissions._role_codes(conn, rids)
    return {
        "kc_sub":         user.kc_sub,
        "username":       user.username,
        "email":          user.email,
        "full_name":      user.full_name,
        "realm":          user.realm,
        "primary_role":   user.primary_role,
        "roles":          role_codes,
        "capabilities":   capabilities,
    }


# ─── /dashboard/{id}/spec ─────────────────────────────────────────────
def _spec_dict(pairs: list[tuple[str, Any]]) -> dict:
    """asdict dict_factory: OMIT the supports key for UNBOUND widgets (None) —
    the host treats a MISSING supports as never-hide, while a present
    supports{} carries the bound widget's honest per-dim capability."""
    return {k: v for k, v in pairs if not (k == "supports" and v is None)}


@router.get("/dashboard/{dashboard_id}/spec")
async def dashboard_spec(dashboard_id: str,
                          user: UserCtx = Depends(get_user)) -> dict:
    pool = await ops_db.ensure_pool()
    spec = await permissions.resolve_dashboard(dashboard_id, user, pool)
    if spec is None:
        raise HTTPException(404, f"dashboard {dashboard_id} not accessible to your role")
    return asdict(spec, dict_factory=_spec_dict)


# ─── /filter/{id}/values ──────────────────────────────────────────────
@router.get("/filter/{filter_id}/values")
async def filter_values(filter_id: str,
                         page_id: str | None = Query(None),
                         dashboard_id: str | None = Query(None),
                         widget_id: str | None = Query(None),
                         user: UserCtx = Depends(get_user)) -> dict:
    pool = await ops_db.ensure_pool()
    return await permissions.filter_values(
        filter_id, user, pool,
        page_id=page_id, dashboard_id=dashboard_id, widget_id=widget_id)


# ─── /widget/{id}/data ────────────────────────────────────────────────
@router.get("/widget/{widget_id}/data")
async def widget_data(widget_id: str, request: Request,
                       dashboard_id: str = Query(...),
                       page_id: str | None = Query(None),
                       user: UserCtx = Depends(get_user)) -> dict:
    """Gate-and-fetch for a widget's data.

    Verification order:
      1. Resolver: does the caller's role grant this widget on this dashboard?
      2. Filter scope: every query-param filter value must be in the
         caller's allowed set (widget-specific + optional page-global).
      3. OPA mart-level: for mart-backed widgets, call opa.decide with
         the catalog-enriched mart attributes.
      4. Fetch: returns a permitted-stub when no fetcher is bound.

    `page_id` is optional; when supplied, page-global filter scopes fold in
    on top of the widget-specific scopes (page filter caps + widget filter caps
    intersect).
    """
    pool = await ops_db.ensure_pool()

    # (1) widget-access gate
    access = await permissions.check_widget_access(
        widget_id, dashboard_id, user, pool, page_id=page_id)
    if not access.permitted:
        raise HTTPException(403, access.reason)

    # (2) filter-value gate. 'all' is the filter bar's "no narrowing" sentinel —
    # it never reaches SQL and is never a grantable value, so it is exempt from
    # the cap check (a region-capped role's default geography=all must not 403;
    # its role scope still applies through OPA's row_filter below).
    params = dict(request.query_params.multi_items())
    params.pop("dashboard_id", None)
    params.pop("page_id", None)
    ui_filters = {k: v for k, v in params.items() if v not in ("", "all")}
    rejected: list[tuple[str, str]] = []
    for fid, fval in ui_filters.items():
        allowed = _effective_cap(access.allowed_filter_values, fid)
        if allowed is None:                              # wildcard, accept anything
            continue
        if fval not in allowed:
            rejected.append((fid, fval))
    if rejected:
        raise HTTPException(
            403, "filter values not allowed for your role: " +
                 ", ".join(f"{k}={v}" for k, v in rejected))

    # (3) OPA mart-level gate. A BOUND fetcher supplies the COMPLETE OPA payload
    # (subject + data_class + granularity + sensitivity) — this is what lets OPA
    # ALLOW a legitimate read instead of denying on a missing data_class — and we
    # push the caller's user_scope so OPA returns a row_filter the fetcher applies.
    # Unbound widgets fall back to the widget's requires (may be incomplete).
    from ..fetchers import FETCHERS, PERIOD_KEYS, merge_ui_filters
    fetcher = FETCHERS.get(widget_id)
    opa_payload: dict[str, Any] = {"decision": "skipped (no mart binding)"}
    decision = None
    if fetcher is not None:
        async with pool.acquire() as _c:
            scope = await permissions.effective_user_scope(_c, user)
        decision = await opa.decide(user, action="read", resource=fetcher.subject,
                                    attributes=fetcher.opa_attributes(), scope=scope)
    # NOTE: unbound widgets deliberately skip the OPA mart-gate — their widgets.yaml
    # `requires` is an INCOMPLETE payload (no data_class), so calling OPA would wrongly
    # deny under OPA_ENFORCE. They have no bound mart, so they return a stub (no data to
    # gate). Only fetcher-bound widgets are OPA-enforced. Binding a widget to a fetcher
    # is what makes it BOTH real-data AND enforced.
    if decision is not None:
        opa_payload = {
            "decision": "allow" if decision.allow else "deny",
            "reason":   decision.reason,
            "masked_columns": decision.masked_columns,
            "row_filter": decision.row_filter,
            "degraded": decision.degraded,
        }
        if not decision.allow:
            raise HTTPException(403, "mart-level policy denied: " + (decision.reason or ""))

    # (3b) fold the UI's validated filter params into OPA's row_filter scope —
    # NARROW-ONLY (a role locked to ['OR'] with UI 'OR' stays ['OR']; UI 'all'
    # keeps the role scope; an out-of-scope value never widens it). This is what
    # makes the filter bar actually change the SQL the fetcher runs.
    row_filter: dict[str, Any] = {}
    if fetcher is not None:
        period_val = ui_filters.get("period")
        if period_val is not None and period_val not in PERIOD_KEYS:
            raise HTTPException(
                400, f"unknown period value {period_val!r}; "
                     f"valid: {sorted(PERIOD_KEYS)}")
        row_filter = merge_ui_filters(
            decision.row_filter if decision else {}, ui_filters)

    # (4) data fetch — REAL data via the bound fetcher (through Trino, with the
    # merged row_filter AND-applied), else the permitted-stub.
    if fetcher is not None:
        try:
            data = await fetcher.fetch(params, row_filter)
        except Exception as exc:                                  # noqa: BLE001
            log.warning("fetcher %s failed: %s", widget_id, exc)
            raise HTTPException(502, f"data fetch failed for {widget_id}: {exc}")
    else:
        data = {"columns": [], "rows": [],
                "note": "permitted-stub — no fetcher bound for this widget"}

    return {
        "widget_id":    widget_id,
        "dashboard_id": dashboard_id,
        "page_id":      page_id,
        "permitted":    True,
        "filters":      params,
        # additive: the row_filter the fetcher actually applied (OPA scope ∩ UI
        # narrowing) — lets clients/harnesses assert server-side application.
        "applied_row_filter": row_filter,
        "scope":        {"allowed_filter_values": access.allowed_filter_values},
        "opa":          opa_payload,
        "data":         data,
    }
