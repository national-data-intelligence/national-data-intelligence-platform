"""MDM stewardship — the human half of master-data conformance.

The matcher (2_pipelines/mdm) fills ops_governance.mdm_match_candidate with
scored same-entity proposals; stewards work the queue here. Every verdict
lands in ops_governance.mdm_match_decision — APPEND-ONLY and BITEMPORAL: a
change of mind supersedes (stamps recorded_to + inserts anew), never rewrites.
The vault build reads the CURRENT decisions (v_facility_resolution v3), so a
rebuild from sources + the decision log always reproduces the same masters.

Follows the graduation.py house pattern: direct role gate (these verbs have no
OPA rego arm), asyncpg via ops_db.ensure_pool(), one transaction per verdict,
log_policy_decision for the audit trail.
"""
from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Path as PathParam, Query

from ..auth import UserCtx, get_user
from .. import opa, ops_db

log = logging.getLogger("gateway.mdm")
router = APIRouter(prefix="/api/mdm", tags=["mdm"])

# Same trio as graduation's REVIEWER_ROLES: stewardship is R-STEW's home, the
# ops admin operates the platform, R-SUPER sees everything.
STEWARD_ROLES = ("R-STEW", "R-OPS-ADM", "R-SUPER")


def _steward_gate(user: UserCtx) -> opa.Decision:
    """Full-role-set check (primary_role is just the first R- role in an
    unordered Keycloak claim — see graduation._review_gate)."""
    allowed = any(r in STEWARD_ROLES for r in user.roles)
    return opa.Decision(
        allow=allowed,
        reason=f"mdm steward gate: roles {user.roles} "
               f"{'allowed' if allowed else 'denied'} (stewards only)")


def _require_steward(user: UserCtx) -> opa.Decision:
    decision = _steward_gate(user)
    if not decision.allow:
        raise HTTPException(403, decision.reason or "stewards only")
    return decision


def _cand_out(row) -> dict:
    return {
        "candidate_id": str(row["candidate_id"]),
        "deployment_context": row["deployment_context"],
        "entity_class_code": row["entity_class_code"],
        "left_source_system_code": row["left_source_system_code"],
        "left_source_record_key": row["left_source_record_key"],
        "right_source_system_code": row["right_source_system_code"],
        "right_source_record_key": row["right_source_record_key"],
        "suggested_master_bk": row["suggested_master_bk"],
        "score": float(row["score"]),
        "match_rule": row["match_rule"],
        "match_features": row["match_features"],
        "status": row["status"],
        "discovered_at": row["discovered_at"].isoformat(),
    }


@router.get("/queue")
async def queue(
    user: UserCtx = Depends(get_user),
    entity_class: str = Query(default="facility"),
    status: str = Query(default="pending"),
    match_rule: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict:
    """The steward work queue: candidates by status, best score first, with
    per-rule counts so the console can show the shape of the backlog."""
    _require_steward(user)
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        where = ["entity_class_code = $1", "status = $2"]
        args: list = [entity_class, status]
        if match_rule:
            args.append(match_rule)
            where.append(f"match_rule = ${len(args)}")
        rows = await conn.fetch(f"""
            SELECT * FROM ops_governance.mdm_match_candidate
            WHERE {' AND '.join(where)}
            ORDER BY score DESC, left_source_record_key, suggested_master_bk
            LIMIT {limit} OFFSET {offset}
        """, *args)
        counts = await conn.fetch("""
            SELECT match_rule, status, count(*) AS n
            FROM ops_governance.mdm_match_candidate
            WHERE entity_class_code = $1
            GROUP BY match_rule, status
        """, entity_class)
    return {
        "candidates": [_cand_out(r) for r in rows],
        "counts": [{"match_rule": r["match_rule"], "status": r["status"],
                    "n": r["n"]} for r in counts],
        "limit": limit, "offset": offset,
    }


@router.post("/candidate/{candidate_id}/decide")
async def decide(
    candidate_id: str = PathParam(...),
    user: UserCtx = Depends(get_user),
    decision: str = Body(..., embed=True),
    note: str | None = Body(default=None, embed=True),
) -> dict:
    """Record a steward verdict on one candidate.

    accept → the left source record maps onto suggested_master_bk (the vault
             build re-keys it on the next run); sibling pending candidates for
             the same record become superseded (the record has its master).
    reject → recorded as a current 'reject' decision (the matcher will keep
             re-proposing the pair otherwise); conformance falls back to the
             deterministic derivation.
    Any earlier CURRENT decision for the record is superseded (recorded_to
    stamped) — never updated in place.
    """
    gate = _require_steward(user)
    if decision not in ("accept", "reject"):
        raise HTTPException(422, "decision must be accept or reject")
    try:
        UUID(candidate_id)
    except (ValueError, TypeError):
        raise HTTPException(404, "not found")

    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        cand = await conn.fetchrow("""
            SELECT * FROM ops_governance.mdm_match_candidate
            WHERE candidate_id = $1::uuid
        """, candidate_id)
        if cand is None:
            raise HTTPException(404, "not found")
        if cand["status"] not in ("pending", "auto_accepted"):
            raise HTTPException(409, f"candidate already {cand['status']}")
        if decision == "accept" and not cand["suggested_master_bk"]:
            raise HTTPException(409, "candidate carries no suggested_master_bk")

        async with conn.transaction():
            # supersede whatever the platform currently believes about this record
            await conn.execute("""
                UPDATE ops_governance.mdm_match_decision
                   SET recorded_to = now()
                 WHERE deployment_context = $1 AND entity_class_code = $2
                   AND source_system_code = $3 AND source_record_key = $4
                   AND recorded_to IS NULL
            """, cand["deployment_context"], cand["entity_class_code"],
                 cand["left_source_system_code"], cand["left_source_record_key"])
            dec = await conn.fetchrow("""
                INSERT INTO ops_governance.mdm_match_decision
                    (deployment_context, entity_class_code,
                     source_system_code, source_record_key,
                     decision, master_bk, candidate_id, score, decided_by, note)
                VALUES ($1, $2, $3, $4, $5, $6, $7::uuid, $8, $9, $10)
                RETURNING decision_id
            """, cand["deployment_context"], cand["entity_class_code"],
                 cand["left_source_system_code"], cand["left_source_record_key"],
                 decision,
                 cand["suggested_master_bk"] if decision == "accept" else None,
                 candidate_id, cand["score"], user.username, note)
            await conn.execute("""
                UPDATE ops_governance.mdm_match_candidate
                   SET status = 'decided' WHERE candidate_id = $1::uuid
            """, candidate_id)
            superseded = 0
            if decision == "accept":
                superseded = int((await conn.execute("""
                    UPDATE ops_governance.mdm_match_candidate
                       SET status = 'superseded'
                     WHERE deployment_context = $1 AND entity_class_code = $2
                       AND left_source_system_code = $3
                       AND left_source_record_key = $4
                       AND status = 'pending' AND candidate_id <> $5::uuid
                """, cand["deployment_context"], cand["entity_class_code"],
                     cand["left_source_system_code"],
                     cand["left_source_record_key"],
                     candidate_id)).split()[-1])

    await ops_db.log_policy_decision(
        user=user, action="mdm.decide", resource=candidate_id,
        decision="allow", rule_hits=gate.rule_hits,
        explanation={"verdict": decision,
                     "master_bk": cand["suggested_master_bk"] if decision == "accept" else None,
                     "record": f"{cand['left_source_system_code']}/{cand['left_source_record_key']}",
                     "siblings_superseded": superseded})
    return {"candidate_id": candidate_id, "decision": decision,
            "decision_id": str(dec["decision_id"]),
            "siblings_superseded": superseded,
            "note": "conformance updates on the next vault build"}


@router.get("/decisions")
async def decisions(
    user: UserCtx = Depends(get_user),
    entity_class: str = Query(default="facility"),
    current_only: bool = Query(default=True),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict:
    """The decision log — current beliefs by default, full bitemporal history
    with current_only=false."""
    _require_steward(user)
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        cur_filter = "AND recorded_to IS NULL" if current_only else ""
        rows = await conn.fetch(f"""
            SELECT * FROM ops_governance.mdm_match_decision
            WHERE entity_class_code = $1 {cur_filter}
            ORDER BY recorded_from DESC
            LIMIT {limit} OFFSET {offset}
        """, entity_class)
    return {"decisions": [{
        "decision_id": str(r["decision_id"]),
        "deployment_context": r["deployment_context"],
        "entity_class_code": r["entity_class_code"],
        "source_system_code": r["source_system_code"],
        "source_record_key": r["source_record_key"],
        "decision": r["decision"],
        "master_bk": r["master_bk"],
        "candidate_id": str(r["candidate_id"]) if r["candidate_id"] else None,
        "score": float(r["score"]) if r["score"] is not None else None,
        "decided_by": r["decided_by"],
        "note": r["note"],
        "valid_from": r["valid_from"].isoformat(),
        "valid_to": r["valid_to"].isoformat(),
        "recorded_from": r["recorded_from"].isoformat(),
        "recorded_to": r["recorded_to"].isoformat() if r["recorded_to"] else None,
        "current": r["recorded_to"] is None,
    } for r in rows], "limit": limit, "offset": offset}


@router.post("/decision/{decision_id}/revert")
async def revert(
    decision_id: str = PathParam(...),
    user: UserCtx = Depends(get_user),
    note: str | None = Body(default=None, embed=True),
) -> dict:
    """Supersede a CURRENT decision (append-only change of mind): stamp its
    recorded_to and re-open the candidate so the queue shows it again. The
    record falls back to deterministic conformance on the next vault build."""
    gate = _require_steward(user)
    try:
        UUID(decision_id)
    except (ValueError, TypeError):
        raise HTTPException(404, "not found")

    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        dec = await conn.fetchrow("""
            SELECT * FROM ops_governance.mdm_match_decision
            WHERE decision_id = $1::uuid
        """, decision_id)
        if dec is None:
            raise HTTPException(404, "not found")
        if dec["recorded_to"] is not None:
            raise HTTPException(409, "decision already superseded")

        async with conn.transaction():
            await conn.execute("""
                UPDATE ops_governance.mdm_match_decision
                   SET recorded_to = now() WHERE decision_id = $1::uuid
            """, decision_id)
            if dec["candidate_id"]:
                await conn.execute("""
                    UPDATE ops_governance.mdm_match_candidate
                       SET status = 'pending' WHERE candidate_id = $1::uuid
                """, dec["candidate_id"])

    await ops_db.log_policy_decision(
        user=user, action="mdm.revert", resource=decision_id,
        decision="allow", rule_hits=gate.rule_hits,
        explanation={"superseded_verdict": dec["decision"],
                     "master_bk": dec["master_bk"],
                     "record": f"{dec['source_system_code']}/{dec['source_record_key']}",
                     "note": note})
    return {"decision_id": decision_id, "superseded": True,
            "candidate_reopened": bool(dec["candidate_id"])}
