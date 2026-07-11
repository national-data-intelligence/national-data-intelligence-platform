"""/api/policy — admin OPA inspection + ad-hoc evaluator.

Wires the Admin dashboard's "Policies (OPA)" section:
  GET  /api/policy/recent     last N policy_log rows
  POST /api/policy/evaluate   run a what-if input doc through OPA

The evaluator reuses the gateway's existing opa.decide helper so the
result shape matches every other OPA-gated call. Every evaluation is
audit-logged (separately from the policy_log so an experiment doesn't
get conflated with production traffic).
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from ..auth import UserCtx, get_user
from .. import opa, ops_db
# The ADMIN GATE is the RBAC capability (no rego rule matches admin.* verbs, so
# opa.decide denies under OPA_ENFORCE). opa.decide is still used BELOW to run the
# actual policy evaluation on a synthetic principal — that's the feature.
from .perm_admin import _require_capability

log = logging.getLogger("gateway.policy")
router = APIRouter(prefix="/api/policy", tags=["policy"])


@router.get("/recent")
async def recent_decisions(
        user: UserCtx = Depends(get_user),
        limit: int = Query(default=50, ge=1, le=500),
        decision: str | None = Query(default=None,
                                      description="filter: allow|deny")
        ) -> list[dict[str, Any]]:
    """Pull the most recent OPA decisions from ops_audit.policy_log. Admin
    OPA-gated so only operators see the policy trace."""
    await _require_capability(user, "view_ops_console")
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        if decision in ("allow", "deny"):
            rows = await conn.fetch("""
                SELECT id, ts, kc_sub, action, resource, decision,
                       rule_hits, explanation
                FROM ops_audit.policy_log
                WHERE decision = $1
                ORDER BY ts DESC LIMIT $2;
            """, decision, limit)
        else:
            rows = await conn.fetch("""
                SELECT id, ts, kc_sub, action, resource, decision,
                       rule_hits, explanation
                FROM ops_audit.policy_log
                ORDER BY ts DESC LIMIT $1;
            """, limit)
    return [dict(r) for r in rows]


@router.post("/evaluate")
async def evaluate(
        user: UserCtx = Depends(get_user),
        # Either evaluate "as the caller" against the supplied action/resource,
        # OR provide a `principal` doc to evaluate as someone else (admin-only).
        action:    str = Body(..., min_length=1),
        resource:  str = Body(..., min_length=1),
        principal: dict[str, Any] | None = Body(default=None),
        ) -> dict[str, Any]:
    """Ad-hoc policy evaluation. The dashboard's Policy section sends
    {action, resource, principal?}; we ask OPA the same way the
    enforcement path does and return the full decision shape."""
    # Admin gate to evaluate as someone else; self-evaluation is open
    # to any authenticated user so the SQL/export pages can pre-check.
    if principal is not None:
        await _require_capability(user, "view_ops_console")
        # Compose a synthetic UserCtx so opa.decide sees the requested
        # identity. Only fields opa rules consume are honored.
        from ..auth import UserCtx as _UC
        target = _UC(
            kc_sub=str(principal.get("kc_sub") or principal.get("sub") or ""),
            username=str(principal.get("username") or ""),
            realm=str(principal.get("realm") or ""),
            primary_role=str(principal.get("primary_role") or
                              (principal.get("roles") or ["R-UNKNOWN"])[0]),
            roles=list(principal.get("roles") or []),
            geographies=list(principal.get("geographies") or []),
            programs=list(principal.get("programs") or []),
            purpose_of_use=str(principal.get("purpose_of_use") or "public-health"),
        )
    else:
        target = user

    decision = await opa.decide(target, action=action, resource=resource)
    # Audit the evaluation but separately from production policy_log —
    # the gateway log captures the call.
    await ops_db.log_gateway_query(
        user=user, method="POST", path="/api/policy/evaluate",
        mart_scope=["opa.evaluate"],
        filters={"action": action, "resource": resource,
                 "as_other": principal is not None},
        row_count=1, byte_count=None,
        latency_ms=0, http_status=200,
        policy_decision="allow")
    return {
        "allow":           decision.allow,
        "reason":          decision.reason,
        "rule_hits":       decision.rule_hits,
        "obligations":     decision.obligations,
        "masked_columns":  decision.masked_columns,
        "evaluated_for":   {
            "kc_sub":       target.kc_sub,
            "primary_role": target.primary_role,
            "roles":        target.roles,
            "geographies":  target.geographies,
            "programs":     target.programs,
        },
    }
