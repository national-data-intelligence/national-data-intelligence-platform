"""/api/workspace — workshop pod spawn + resource-request flow.

Reads the profile catalogue from 6_access-points/jupyterhub/profiles.yaml.
Spawn calls hit the JupyterHub REST API (the spawner does the actual
KubeSpawner work — gateway is a thin proxy that audits + OPA-gates).

Routes:
    GET    /api/workspace/profiles            list profiles I'm eligible for
    POST   /api/workspace/spawn               spawn (or restart) my pod
    GET    /api/workspace/status              my current pod's status
    POST   /api/workspace/stop                stop my pod
    POST   /api/workspace/resource-request     submit a request for a bigger profile
    GET    /api/workspace/resource-requests   admin-only: list pending requests
    POST   /api/workspace/resource-requests/{id}/decide   admin-only: approve/decline
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any

import httpx
import yaml
from fastapi import APIRouter, Body, Depends, HTTPException, Query

from ..auth import UserCtx, get_user
from .. import ops_db, opa
# Admin resource-request surfaces gated by RBAC capability, NOT opa.decide (no
# rego rule for admin.* verbs → denies under OPA_ENFORCE). opa.decide is still
# used below for spawn.workspace, which IS a real data-plane action.
from .perm_admin import _require_capability

log = logging.getLogger("gateway.workspace")
router = APIRouter(prefix="/api/workspace", tags=["workspace"])

JUPYTERHUB_URL  = os.environ.get("JUPYTERHUB_URL",  "http://jupyterhub:8081")
JUPYTERHUB_TOKEN = os.environ.get("JUPYTERHUB_API_TOKEN", "")
# Browser-reachable base for the lab UI (ingress hostname), used to hand the
# SPA a clickable URL. The in-cluster JUPYTERHUB_URL is NOT browser-reachable.
JUPYTER_PUBLIC_BASE = os.environ.get(
    "JUPYTER_PUBLIC_BASE", "https://jupyter.127.0.0.1.nip.io").rstrip("/")


def _lab_url(username: str) -> str:
    return f"{JUPYTER_PUBLIC_BASE}/user/{username}/lab"

PROFILES_PATH = Path(os.environ.get(
    "WORKSPACE_PROFILES_PATH",
    "/app/profiles.yaml"))     # mounted from 6_access-points/jupyterhub/profiles.yaml


def _load_profiles() -> dict[str, Any]:
    if not PROFILES_PATH.exists():
        return {"default_profile": "Small", "profiles": []}
    with PROFILES_PATH.open() as f:
        return yaml.safe_load(f) or {}


# The platform super-user self-serves EVERYTHING (mirrors the OPA role_r_super
# `dashboards:'*'` / `widgets:'*'` grant and the hub's own profile_list bypass)
# — profiles.yaml self_serve_roles never has to enumerate it.
SUPERUSER_ROLES = ("R-SUPER",)

# Reviewer set (task #42/#43): a privileged reviewer may OPEN a lab scoped to a
# SUBMITTED project (even if private) so they can pull its files and RUN its
# notebooks — the owner's requirement "a human reviewer runs the notebooks".
# Copied from graduation.py / projects.py (repetition over coupling).
REVIEWER_ROLES = ("R-OPS-ADM", "R-STEW", "R-SUPER")


def _is_superuser(user: UserCtx) -> bool:
    return any(r in SUPERUSER_ROLES for r in user.roles)


def _is_reviewer(user: UserCtx) -> bool:
    return any(r in REVIEWER_ROLES for r in user.roles)


def _eligible(user: UserCtx, profile: dict[str, Any]) -> bool:
    if _is_superuser(user):
        return True
    roles = set(profile.get("self_serve_roles") or [])
    return bool(roles & set(user.roles))


async def _granted_profiles(user: UserCtx) -> set[str]:
    """Profile slugs this user has been GRANTED via an approved resource
    request. The approval flow's whole point is to unlock a profile a role
    can't self-serve — but the spawn ACL used to check only self_serve_roles,
    so an approved request granted nothing usable. The grant is the granted_
    profile when the admin set one, else the profile the user requested."""
    if not user.kc_sub:
        return set()
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT COALESCE(granted_profile, requested_profile) AS slug
            FROM ops_governance.resource_request
            WHERE requester = $1::uuid AND status = 'approved'
                  AND COALESCE(granted_profile, requested_profile) IS NOT NULL
                  AND (expires_at IS NULL OR expires_at > now());
        """, user.kc_sub)
    return {r["slug"] for r in rows}


def _eligible_with_grants(user: UserCtx, profile: dict[str, Any],
                          granted: set[str]) -> bool:
    return _eligible(user, profile) or profile.get("slug") in granted


@router.get("/profiles")
async def profiles(user: UserCtx = Depends(get_user)) -> dict[str, Any]:
    cat = _load_profiles()
    granted = await _granted_profiles(user)
    items = []
    for p in cat.get("profiles", []):
        elig = _eligible_with_grants(user, p, granted)
        items.append({**p, "self_serve": elig,
                      "granted": p.get("slug") in granted})
    return {"default_profile": cat.get("default_profile"),
            "profiles": items, "user_role": user.primary_role}


@router.post("/spawn")
async def spawn(user: UserCtx = Depends(get_user),
                profile: str | None = Body(default=None, embed=True),
                project_id: str | None = Body(default=None, embed=True)) -> dict[str, Any]:
    cat = _load_profiles()
    p = next((x for x in cat["profiles"]
              if x["slug"] == (profile or cat.get("default_profile", "Small"))), None)
    if p is None:
        raise HTTPException(404, f"unknown profile {profile!r}")
    # Profile eligibility (self_serve_roles in profiles.yaml) IS the spawn ACL:
    # a role that can't self-serve this profile is 403'd and directed to the
    # resource-request flow. There is deliberately no OPA data-plane verb for
    # spawning — an earlier opa.decide("spawn.workspace") had NO matching rego
    # rule, so it hit default-deny and made every spawn 403 (the same dead-gate
    # class removed for read.topology / read.observability / admin.*).
    if not _eligible_with_grants(user, p, await _granted_profiles(user)):
        raise HTTPException(403,
            f"profile {p['slug']} is not self-serve for role {user.primary_role}. "
            f"Submit a resource-request via POST /api/workspace/resource-request.")

    # EVERY lab is PROJECT-SCOPED — no unscoped/sandbox labs (owner rule 2026-07-08).
    # The spawner's pre-spawn hook syncs the project's MinIO files/ prefix into the
    # lab workdir so the session content is always reconciled to the project. A spawn
    # without a project is rejected: the caller must pick a project first.
    if not project_id:
        raise HTTPException(
            400, "a lab must be opened for a project — pick a project first "
                 "(no unscoped labs).")
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        prj = await conn.fetchrow("""
            SELECT id, slug, name, visibility, owner_kc_sub, group_id,
                   review_status
            FROM ops_workspace.project WHERE id = $1::uuid;
        """, project_id)
        if prj is None:
            raise HTTPException(404, "project not found")
        visible = (
            prj["visibility"] == "public"
            or str(prj["owner_kc_sub"]) == (user.kc_sub or "")
            or (prj["visibility"] == "group" and bool(await conn.fetchval("""
                    SELECT 1 FROM ops_artifact.workshop_group_member
                    WHERE group_id = $1::uuid AND kc_sub = $2::uuid;
                """, prj["group_id"], user.kc_sub))))
        # A reviewer may open a lab on a SUBMITTED project (in_review /
        # changes_requested) even if private — to run its notebooks (#42). This
        # is the ONLY spawn widening; approved (already public) is covered above,
        # an un-submitted draft is NOT (a reviewer can't open a private draft).
        if not visible and _is_reviewer(user) and prj["review_status"] in (
                "in_review", "changes_requested"):
            visible = True
        if not visible:
            raise HTTPException(404, "project not found")
    project_opts = {"project_id": str(prj["id"]),
                    "project_slug": prj["slug"]}

    if not JUPYTERHUB_TOKEN:
        raise HTTPException(503,
            "JupyterHub not configured (JUPYTERHUB_API_TOKEN unset). "
            "k3d + JupyterHub installation is part of the deployment bundle.")
    t0 = time.perf_counter()
    username = user.username
    async with httpx.AsyncClient(timeout=30) as c:
        hdrs = {"Authorization": f"token {JUPYTERHUB_TOKEN}"}
        r = await c.post(f"{JUPYTERHUB_URL}/hub/api/users/{username}/server",
                         headers=hdrs, json={"profile": p["slug"], **project_opts})
        if r.status_code == 404:
            # First spawn before any OIDC login: create the hub user, retry.
            cr = await c.post(f"{JUPYTERHUB_URL}/hub/api/users/{username}",
                              headers=hdrs)
            if cr.status_code not in (200, 201):
                raise HTTPException(502,
                    f"jupyterhub user create failed: {cr.status_code} {cr.text[:200]}")
            r = await c.post(f"{JUPYTERHUB_URL}/hub/api/users/{username}/server",
                             headers=hdrs, json={"profile": p["slug"], **project_opts})
        if r.status_code == 400 and "already running" in r.text.lower():
            pass                       # treat as success — the lab is up
        elif r.status_code not in (200, 201, 202):
            raise HTTPException(502, f"jupyterhub spawn failed: {r.status_code} {r.text[:200]}")
    await ops_db.log_gateway_query(
        user=user, method="POST", path="/api/workspace/spawn",
        mart_scope=["workspace"], filters={"profile": p["slug"], **project_opts},
        row_count=1, byte_count=None,
        latency_ms=int((time.perf_counter() - t0) * 1000),
        http_status=r.status_code, policy_decision="allow")
    await ops_db.log_data_event(
        user=user, kind="workspace.spawn",
        payload={"profile": p["slug"], "resources": p["resources"], **project_opts})
    return {"profile": p["slug"], "resources": p["resources"],
            "status": "spawning", "url": _lab_url(username), **project_opts}


@router.get("/status")
async def status(user: UserCtx = Depends(get_user)) -> dict[str, Any]:
    if not JUPYTERHUB_TOKEN:
        return {"running": False, "reason": "jupyterhub not configured in dev"}
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(
            f"{JUPYTERHUB_URL}/hub/api/users/{user.username}",
            headers={"Authorization": f"token {JUPYTERHUB_TOKEN}"})
    if r.status_code != 200:
        return {"running": False, "reason": f"jupyterhub {r.status_code}"}
    body = r.json()
    running = bool(body.get("server"))
    return {
        "running": running,
        "server": body.get("server"),
        "name":   body.get("name"),
        "last_activity": body.get("last_activity"),
        "url": _lab_url(user.username) if running else None,
    }


@router.post("/stop")
async def stop(user: UserCtx = Depends(get_user)) -> dict[str, Any]:
    if not JUPYTERHUB_TOKEN:
        raise HTTPException(503, "jupyterhub not configured")
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.delete(
            f"{JUPYTERHUB_URL}/hub/api/users/{user.username}/server",
            headers={"Authorization": f"token {JUPYTERHUB_TOKEN}"})
    if r.status_code not in (200, 202, 204):
        raise HTTPException(502, f"jupyterhub stop failed: {r.status_code}")
    await ops_db.log_data_event(
        user=user, kind="workspace.stop", payload={})
    return {"status": "stopped"}


# ── Resource-request flow ─────────────────────────────────────────────
class _ReqIn(dict):
    pass


@router.post("/resource-request")
async def submit_resource_request(
        user: UserCtx = Depends(get_user),
        requested_profile: str = Body(...),
        justification:     str = Body(...)) -> dict[str, Any]:
    cat = _load_profiles()
    p = next((x for x in cat["profiles"] if x["slug"] == requested_profile), None)
    if p is None:
        raise HTTPException(404, f"unknown profile {requested_profile!r}")
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO ops_governance.resource_request
                (requester, requested_profile, requested_cpu, requested_memory,
                 justification, status)
            VALUES ($1::uuid, $2, $3, $4, $5, 'pending')
            RETURNING id, requested_at;
        """, user.kc_sub, requested_profile,
             p["resources"].get("cpu_limit"),
             p["resources"].get("memory_limit"),
             justification)
    await ops_db.log_data_event(
        user=user, kind="workspace.resource_request",
        payload={"id": str(row["id"]), "profile": requested_profile})
    return {"id": str(row["id"]), "status": "pending",
            "requested_profile": requested_profile,
            "requested_at": row["requested_at"].isoformat()}


@router.get("/resource-requests/mine")
async def list_my_resource_requests(
        user: UserCtx = Depends(get_user),
        limit: int = Query(default=20, ge=1, le=200)) -> list[dict[str, Any]]:
    """The caller's own resource-request history. No admin gate — every
    user sees their own queue regardless of role."""
    if not user.kc_sub:
        return []
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, requested_profile, requested_cpu, requested_memory,
                   justification, status, requested_at, decision_at,
                   decision_note, granted_profile
            FROM ops_governance.resource_request
            WHERE requester = $1::uuid
            ORDER BY requested_at DESC LIMIT $2;
        """, user.kc_sub, limit)
        return [dict(r) for r in rows]


@router.get("/resource-requests")
async def list_resource_requests(
        user: UserCtx = Depends(get_user),
        status: str = Query(default="pending"),
        limit:  int = Query(default=50, ge=1, le=500)) -> list[dict[str, Any]]:
    await _require_capability(user, "view_ops_console")
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT r.id, r.requester, u.username AS requester_username,
                   r.requested_profile, r.requested_cpu, r.requested_memory,
                   r.justification, r.status, r.requested_at, r.decision_at,
                   r.decision_note, r.granted_profile
            FROM ops_governance.resource_request r
            LEFT JOIN ops_identity.user u ON u.kc_sub = r.requester
            WHERE r.status = $1
            ORDER BY r.requested_at DESC LIMIT $2;
        """, status, limit)
        return [dict(r) for r in rows]


@router.post("/resource-requests/{request_id}/decide")
async def decide_resource_request(
        request_id: str,
        user: UserCtx = Depends(get_user),
        decision_:       str = Body(..., alias="decision"),
        granted_profile: str | None = Body(default=None),
        note:            str | None = Body(default=None)) -> dict[str, Any]:
    if decision_ not in ("approved", "declined", "info_requested"):
        raise HTTPException(400, "decision must be approved/declined/info_requested")
    await _require_capability(user, "approve_access_request")
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            UPDATE ops_governance.resource_request
               SET status=$2, granted_profile=$3, decision_note=$4,
                   reviewer=$5::uuid, decision_at=now()
             WHERE id=$1::uuid;
        """, request_id, decision_, granted_profile, note, user.kc_sub)
    await ops_db.log_data_event(
        user=user, kind="workspace.resource_request.decide",
        payload={"id": request_id, "decision": decision_, "granted": granted_profile})
    return {"id": request_id, "status": decision_}
