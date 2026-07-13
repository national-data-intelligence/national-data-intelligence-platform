"""/api/public/access-requests and /api/admin/access-requests — the
dashboard access-request queue.

Two callers:
  - The public dashboard's "Request access" form submits anonymously to
    POST /api/public/access-requests. We accept this without a Bearer
    token, write a row to ops_governance.access_request, and return the
    generated AR-YYYY-NNNN tracking ID.
  - The admin dashboard reads pending rows via GET /api/admin/access-
    requests and decides each via POST /api/admin/access-requests/
    {id}/decide.

Distinct from /api/workspace/resource-requests (compute upgrades).
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import (APIRouter, Body, Depends, HTTPException, Query, Request)
from pydantic import BaseModel, EmailStr, Field

from ..auth import UserCtx, get_user
from .. import ops_db, keycloak_admin
# Admin access-request actions are gated by the RBAC capability, NOT opa.decide:
# there is no rego rule for admin.* verbs, so opa.decide denies them under
# OPA_ENFORCE. _require_capability('approve_access_request') is the working gate
# (capability seeded to R-OPS-ADM / R-SUPER in roles.yaml).
from .perm_admin import _require_capability

log = logging.getLogger("gateway.access_requests")

# Two routers — one anonymous (public), one admin-only.
public_router = APIRouter(prefix="/api/public/access-requests",
                          tags=["access-requests:public"])
admin_router = APIRouter(prefix="/api/admin/access-requests",
                         tags=["access-requests:admin"])

DASHBOARD_KEYS = {
    "internal-bi", "infra-admin", "community-workshop",
    "submission-portal", "dbt-docs", "research-api",
}


class PublicSubmission(BaseModel):
    full_name:  str        = Field(min_length=2, max_length=200)
    email:      EmailStr
    phone:      str | None = None
    org:        str | None = Field(default=None, max_length=200)
    role:       str | None = Field(default=None, max_length=120)
    dashboards: list[str]  = Field(default_factory=list)
    purpose:    str        = Field(min_length=10, max_length=4000)
    supervisor_email: EmailStr | None = None
    irb:        str | None = Field(default=None, max_length=120)
    # Optional identity verification attached by the public form's identity
    # step. `id_type` is one of 'fayda' / 'national-id' / 'passport'.
    #  · Fayda: the popup actually verifies the citizen, so verified_via='fayda'
    #    and fayda_id carries the verified identity (the admin queue renders a
    #    "Fayda-verified" badge purely on fayda_id's presence).
    #  · National ID / Passport: there is no backend that can verify these, so
    #    the number is treated as "provided, pending manual verification" — it is
    #    NEVER written to fayda_id (that would falsely trip the verified badge).
    id_type:      str | None = Field(default=None, max_length=40)
    id_number:    str | None = Field(default=None, max_length=120)
    fayda_id:     str | None = Field(default=None, max_length=120)
    verified_via: str | None = Field(default=None, max_length=60)


@public_router.post("")
async def submit_public_access_request(
        request: Request,
        body:    PublicSubmission = Body(...)) -> dict[str, Any]:
    """Anonymous: accept a dashboard access-request from the public form.
    Returns the generated AR-YYYY-NNNN tracking ID. The submission lands
    in pending status; the admin dashboard surfaces it for review.

    No OPA gate (the public dashboard reaches this without a session)
    but every submission is audit-logged with client IP + UA so the
    admin queue can see the source."""
    # Light validation on the dashboards list — drop unknown keys rather
    # than rejecting; some clients may send display names.
    dashboards = [d for d in body.dashboards if d in DASHBOARD_KEYS]
    client_ip = (request.client.host if request.client else None)
    user_agent = request.headers.get("user-agent")

    # Honest verification marker (§6.3): 'fayda' ONLY when the Fayda popup
    # actually verified the citizen; a National ID / Passport number is recorded
    # as '<type>_pending' (provided, pending manual verification) and never as
    # verified. fayda_id is written ONLY on genuine Fayda verification because
    # the admin queue renders the "Fayda-verified" badge on its presence alone.
    if body.verified_via == "fayda":
        verified_via: str | None = "fayda"
        fayda_id: str | None = body.fayda_id
    elif body.id_type and body.id_number:
        verified_via = f"{body.id_type}_pending"
        fayda_id = None
    else:
        verified_via = body.verified_via or None
        fayda_id = body.fayda_id

    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            # Duplicate guard (§6.3): reject a second ACTIVE (pending) request
            # from the same requester (matched case-insensitively on email) whose
            # requested scope OVERLAPS an already-pending one. A disjoint scope is
            # accepted; an identical/overlapping (or a repeated blanket) request
            # returns 409 so the queue never accrues duplicate rows for one
            # applicant. Kept inside the txn so a burst of identical submits from
            # one applicant does not race two rows in.
            existing = await conn.fetch(
                "SELECT tracking_id, dashboards "
                "FROM ops_governance.access_request "
                "WHERE status = 'pending' AND lower(email) = lower($1);",
                str(body.email))
            new_scope = set(dashboards)
            for ex in existing:
                ex_scope = set(ex["dashboards"] or [])
                overlaps = bool(new_scope & ex_scope) or (
                    not new_scope and not ex_scope)
                if overlaps:
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "code": "duplicate_pending",
                            "tracking_id": ex["tracking_id"],
                            "message": (
                                "You already have a pending access request "
                                f"({ex['tracking_id']}) that covers this access. "
                                "We will review it shortly; please wait for a "
                                "decision before submitting the same request "
                                "again."),
                        })
            tracking_id = await conn.fetchval(
                "SELECT ops_governance.next_access_request_tracking_id();")
            row = await conn.fetchrow("""
                INSERT INTO ops_governance.access_request
                    (tracking_id, submitted_at, full_name, email, phone, org,
                     role, supervisor_email, irb, dashboards, purpose,
                     status, client_ip, user_agent, fayda_id, verified_via)
                VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8,
                        COALESCE($9::text[], '{}'::text[]),
                        $10, 'pending', $11, $12, $13, $14)
                RETURNING id, tracking_id, submitted_at, status;
            """, tracking_id, body.full_name, str(body.email), body.phone,
                body.org, body.role,
                str(body.supervisor_email) if body.supervisor_email else None,
                body.irb, dashboards, body.purpose, client_ip, user_agent,
                fayda_id, verified_via)
    return {
        "tracking_id": row["tracking_id"],
        "id":          str(row["id"]),
        "status":      row["status"],
        "submitted_at": row["submitted_at"].isoformat(),
    }


@public_router.get("/{tracking_id}")
async def lookup_public_status(tracking_id: str) -> dict[str, Any]:
    """Anonymous: allow a submitter to check status by tracking ID.
    Returns a tiny payload (status + decision_at) — never the reviewer's
    note or who decided, which is admin-only."""
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT tracking_id, status, submitted_at, decision_at
            FROM ops_governance.access_request
            WHERE tracking_id = $1;
        """, tracking_id)
    if row is None:
        raise HTTPException(404, "tracking_id not found")
    return {
        "tracking_id":  row["tracking_id"],
        "status":       row["status"],
        "submitted_at": row["submitted_at"].isoformat() if row["submitted_at"] else None,
        "decision_at":  row["decision_at"].isoformat() if row["decision_at"] else None,
    }


@admin_router.get("")
async def list_access_requests(
        user: UserCtx = Depends(get_user),
        status: str = Query(default="pending"),
        limit:  int = Query(default=100, ge=1, le=500)) -> list[dict[str, Any]]:
    """Admin: list access-request rows by status (+ provisioning state)."""
    await _require_capability(user, "approve_access_request")
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, tracking_id, submitted_at, full_name, email, phone,
                   org, role, supervisor_email, irb, dashboards, purpose,
                   status, decision_at, decision_note, granted_role,
                   granted_scope, provisioning_status, kc_user_id,
                   fayda_id, verified_via
            FROM ops_governance.access_request
            WHERE status = $1
            ORDER BY submitted_at DESC LIMIT $2;
        """, status, limit)
        return [dict(r) for r in rows]


async def _provision_account(pool, req: dict[str, Any], granted_role: str,
                             granted_scope: dict[str, Any] | None,
                             reviewer_kc_sub: str) -> dict[str, Any]:
    """Provision the applicant end-to-end (§4.8): create the Keycloak account,
    assign the realm role, and email a set-password link (execute-actions-email
    → realm SMTP → external Google relay); then write the COHERENT ops rows under the SAME
    kc_sub so the gateway enforces the grant immediately — ops_identity.user (the
    owner FK for subscriptions/queries/projects), ops_perm.user_role (RBAC role
    resolution), and ops_identity.user_scope (the data scope OPA row-filters on).
    Idempotent: re-provisioning reuses the KC user and reconciles the scope."""
    if not req.get("email"):
        raise HTTPException(400, "cannot provision — request has no email")
    try:
        prov = await keycloak_admin.provision_user(
            email=req["email"], full_name=req["full_name"], role=granted_role)
    except keycloak_admin.KeycloakAdminError as e:
        log.error("provisioning failed for %s: %s", req.get("tracking_id"), e)
        raise HTTPException(502, f"account provisioning failed: {e}")
    kc_sub = prov["kc_sub"]
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("""
                INSERT INTO ops_identity."user"
                    (kc_sub, realm, username, email, full_name, role_label,
                     locale, managed_by, first_seen_at, last_seen_at)
                VALUES ($1::uuid, $2, $3, $4, $5, $6, 'en', 'runtime', now(), now())
                ON CONFLICT (kc_sub) DO UPDATE
                   SET email = EXCLUDED.email, full_name = EXCLUDED.full_name,
                       role_label = EXCLUDED.role_label;
            """, kc_sub, prov["realm"], prov["username"], req["email"],
                req["full_name"], granted_role)
            # RBAC role — the gateway resolves capabilities via ops_perm.user_role.
            role_id = await conn.fetchval(
                "SELECT id FROM ops_perm.role WHERE code = $1", granted_role)
            if role_id is not None:
                # #51: one shared grant flow (see ops_db.grant_user_role).
                await ops_db.grant_user_role(conn, kc_sub, role_id,
                                             granted_by=reviewer_kc_sub)
            else:
                log.warning("granted_role %s not in ops_perm.role — RBAC row skipped",
                            granted_role)
            # Data scope — OPA row_filter reads ops_identity.user_scope. Reconcile:
            # clear this user's prior scope, then insert the granted values
            # ('all' ⇒ no restriction, so no row).
            await conn.execute(
                "DELETE FROM ops_identity.user_scope WHERE kc_sub = $1::uuid", kc_sub)
            for kind, values in (granted_scope or {}).items():
                vals = values if isinstance(values, list) else [values]
                for v in vals:
                    if v and v != "all":
                        await conn.execute("""
                            INSERT INTO ops_identity.user_scope
                                (kc_sub, kind, value, granted_at, granted_by)
                            VALUES ($1::uuid, $2, $3, now(), $4::uuid)
                            ON CONFLICT (kc_sub, kind, value) DO NOTHING;
                        """, kc_sub, kind, str(v), reviewer_kc_sub)
    return prov


@admin_router.post("/{request_id}/decide")
async def decide_access_request(
        request_id: str,
        user: UserCtx = Depends(get_user),
        decision_:    str = Body(..., alias="decision"),
        granted_role: str | None = Body(default=None),
        granted_scope: dict[str, Any] | None = Body(default=None),
        note:         str | None = Body(default=None)) -> dict[str, Any]:
    """Admin: approve/decline/info-request a submission. On **approve WITH a
    granted_role**, auto-provision the applicant (create the Keycloak account,
    assign role + scope, email a set-password link). Approve without a role
    records the decision only (provision later via POST …/provision). Gated by
    the `approve_access_request` capability."""
    if decision_ not in ("approved", "declined", "info_requested"):
        raise HTTPException(
            400, "decision must be approved/declined/info_requested")
    await _require_capability(user, "approve_access_request")

    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        req = await conn.fetchrow(
            "SELECT id, tracking_id, full_name, email, status "
            "FROM ops_governance.access_request WHERE id = $1::uuid;", request_id)
    if req is None:
        raise HTTPException(404, "request not found")

    provisioning: dict[str, Any] | None = None
    prov_status: str | None = None
    if decision_ == "approved" and granted_role:
        provisioning = await _provision_account(
            pool, dict(req), granted_role, granted_scope, user.kc_sub)
        prov_status = "provisioned"

    if note is None and provisioning:
        note = (f"Provisioned {granted_role} · set-password email "
                f"{'sent' if provisioning['emailed'] else 'FAILED — check SMTP'}")

    async with pool.acquire() as conn:
        result = await conn.fetchrow("""
            UPDATE ops_governance.access_request
               SET status              = $2,
                   granted_role        = $3,
                   granted_scope       = COALESCE($4::jsonb, granted_scope),
                   decision_note       = $5,
                   reviewer            = $6::uuid,
                   decision_at         = now(),
                   provisioning_status = COALESCE($7, provisioning_status),
                   kc_user_id          = COALESCE($8, kc_user_id)
             WHERE id = $1::uuid
             RETURNING id, tracking_id, status, provisioning_status;
        """, request_id, decision_, granted_role, granted_scope, note,
            user.kc_sub, prov_status,
            provisioning["kc_sub"] if provisioning else None)

    await ops_db.log_data_event(
        user=user, kind="access_request.decide",
        payload={"id": request_id, "decision": decision_,
                 "granted_role": granted_role,
                 "provisioned_kc_sub": provisioning["kc_sub"] if provisioning else None})
    return {"id": str(result["id"]),
            "tracking_id": result["tracking_id"],
            "status": result["status"],
            "provisioning_status": result["provisioning_status"],
            "provisioning": provisioning}


@admin_router.post("/{request_id}/provision")
async def provision_access_request(
        request_id: str, user: UserCtx = Depends(get_user)) -> dict[str, Any]:
    """Admin: (re)provision an already-approved request — the retry seam for when
    inline provisioning on /decide failed (e.g. SMTP not yet configured)."""
    await _require_capability(user, "approve_access_request")
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        req = await conn.fetchrow(
            "SELECT id, tracking_id, full_name, email, status, granted_role, "
            "granted_scope FROM ops_governance.access_request WHERE id = $1::uuid;",
            request_id)
    if req is None:
        raise HTTPException(404, "request not found")
    if req["status"] != "approved" or not req["granted_role"]:
        raise HTTPException(400, "request must be approved with a granted_role first")
    scope = req["granted_scope"]
    if isinstance(scope, str):
        import json as _json
        try: scope = _json.loads(scope)
        except Exception: scope = {}
    provisioning = await _provision_account(
        pool, dict(req), req["granted_role"], scope, user.kc_sub)
    async with pool.acquire() as conn:
        await conn.execute("""
            UPDATE ops_governance.access_request
               SET provisioning_status = 'provisioned', kc_user_id = $2
             WHERE id = $1::uuid;
        """, request_id, provisioning["kc_sub"])
    await ops_db.log_data_event(
        user=user, kind="access_request.provision",
        payload={"id": request_id, "kc_sub": provisioning["kc_sub"],
                 "granted_role": req["granted_role"]})
    return {"id": request_id, "provisioning_status": "provisioned",
            "provisioning": provisioning}
