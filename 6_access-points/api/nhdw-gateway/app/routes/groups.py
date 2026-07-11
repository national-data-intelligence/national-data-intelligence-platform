"""/api/groups — workshop community groups.

Every authenticated caller can list groups and view a roster. Contributors
can create a group (becoming its owner-member) and self-serve join/leave:
join is immediate for `open` groups; `request`/`closed` groups refuse the
self-serve path honestly (a join-request approval flow is not built).
The `shared` artifact tier references group IDs from here, so this is the
canonical catalogue.

  GET  /api/groups             list every group + member count + recent artifact count
  GET  /api/groups/{id}        members + recent artifacts shared with this group
  POST /api/groups             create (contributor roles) → 201
  POST /api/groups/{id}/join   self-serve join (open groups)
  POST /api/groups/{id}/leave  leave (owners must transfer first)
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException

from ..auth import UserCtx, get_user
from .. import ops_db
from .graduation import CONTRIBUTOR_ROLES

log = logging.getLogger("gateway.groups")
router = APIRouter(prefix="/api/groups", tags=["groups"])


@router.get("")
async def list_groups(user: UserCtx = Depends(get_user)) -> dict[str, Any]:
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT
                g.id, g.name, g.description, g.visibility, g.created_at,
                (SELECT COUNT(*) FROM ops_artifact.workshop_group_member m
                   WHERE m.group_id = g.id)                         AS member_count,
                (SELECT COUNT(*) FROM ops_artifact.artifact a
                   WHERE a.workshop_group = g.id AND a.tier = 'shared') AS artifact_count,
                (SELECT MAX(a.updated_at) FROM ops_artifact.artifact a
                   WHERE a.workshop_group = g.id)                   AS last_activity_at,
                EXISTS (SELECT 1 FROM ops_artifact.workshop_group_member m
                          WHERE m.group_id = g.id AND m.kc_sub = $1::uuid) AS i_am_a_member
            FROM ops_artifact.workshop_group g
            ORDER BY g.name;
        """, user.kc_sub or "00000000-0000-0000-0000-000000000000")
    return {"groups": [dict(r) for r in rows]}


@router.get("/{group_id}")
async def get_group(group_id: str,
                    user: UserCtx = Depends(get_user)) -> dict[str, Any]:
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        group = await conn.fetchrow("""
            SELECT g.id, g.name, g.description, g.visibility,
                   g.created_at, u.username AS owner_username
            FROM ops_artifact.workshop_group g
            LEFT JOIN ops_identity.user u ON u.kc_sub = g.owner
            WHERE g.id = $1::uuid;
        """, group_id)
        if group is None:
            raise HTTPException(404, "group not found")
        members = await conn.fetch("""
            SELECT m.kc_sub, m.role, m.joined_at, u.username
            FROM ops_artifact.workshop_group_member m
            LEFT JOIN ops_identity.user u ON u.kc_sub = m.kc_sub
            WHERE m.group_id = $1::uuid
            ORDER BY m.role, m.joined_at;
        """, group_id)
        artifacts = await conn.fetch("""
            SELECT id, kind, title, description, peer_review_status,
                   created_at, updated_at
            FROM ops_artifact.artifact
            WHERE workshop_group = $1::uuid
            ORDER BY updated_at DESC NULLS LAST, created_at DESC
            LIMIT 25;
        """, group_id)
    return {
        "group":     dict(group),
        "members":   [dict(m) for m in members],
        "artifacts": [dict(a) for a in artifacts],
    }


async def _require_identity(conn, user: UserCtx) -> str:
    """Group writes FK onto ops_identity.user — refuse unprovisioned subjects
    with an honest 409 instead of a 500."""
    if not user.kc_sub:
        raise HTTPException(401, "no subject in token")
    row = await conn.fetchval(
        "SELECT 1 FROM ops_identity.user WHERE kc_sub = $1::uuid;", user.kc_sub)
    if row is None:
        raise HTTPException(409, "caller has no identity row")
    return user.kc_sub


@router.post("", status_code=201)
async def create_group(
        user: UserCtx = Depends(get_user),
        name: str = Body(..., embed=True, min_length=3, max_length=80),
        description: str | None = Body(default=None, embed=True),
        visibility: str = Body(default="open", embed=True),
        ) -> dict[str, Any]:
    if not any(r in CONTRIBUTOR_ROLES for r in user.roles):
        raise HTTPException(403, "group creation is for workshop contributors")
    if visibility not in ("open", "request", "closed"):
        raise HTTPException(400, "visibility must be open | request | closed")
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            kc = await _require_identity(conn, user)
            group = await conn.fetchrow("""
                INSERT INTO ops_artifact.workshop_group
                    (name, description, owner, visibility)
                VALUES ($1, $2, $3::uuid, $4)
                ON CONFLICT (name) DO NOTHING
                RETURNING id, name, description, visibility, created_at;
            """, name.strip(), description, kc, visibility)
            if group is None:
                raise HTTPException(409, "a group with that name already exists")
            await conn.execute("""
                INSERT INTO ops_artifact.workshop_group_member
                    (group_id, kc_sub, role)
                VALUES ($1::uuid, $2::uuid, 'owner');
            """, group["id"], kc)
    await ops_db.log_data_event(
        user=user, kind="group.created",
        payload={"group_id": str(group["id"]), "name": group["name"]})
    return dict(group)


@router.post("/{group_id}/join")
async def join_group(group_id: str,
                     user: UserCtx = Depends(get_user)) -> dict[str, Any]:
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            kc = await _require_identity(conn, user)
            visibility = await conn.fetchval("""
                SELECT visibility FROM ops_artifact.workshop_group
                WHERE id = $1::uuid;
            """, group_id)
            if visibility is None:
                raise HTTPException(404, "group not found")
            if visibility != "open":
                raise HTTPException(
                    403, f"this group is '{visibility}' — self-serve join is "
                         "only available for open groups")
            await conn.execute("""
                INSERT INTO ops_artifact.workshop_group_member
                    (group_id, kc_sub, role)
                VALUES ($1::uuid, $2::uuid, 'member')
                ON CONFLICT (group_id, kc_sub) DO NOTHING;
            """, group_id, kc)
    await ops_db.log_data_event(
        user=user, kind="group.joined", payload={"group_id": group_id})
    return {"joined": True, "group_id": group_id}


@router.post("/{group_id}/leave")
async def leave_group(group_id: str,
                      user: UserCtx = Depends(get_user)) -> dict[str, Any]:
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            kc = await _require_identity(conn, user)
            role = await conn.fetchval("""
                SELECT role FROM ops_artifact.workshop_group_member
                WHERE group_id = $1::uuid AND kc_sub = $2::uuid;
            """, group_id, kc)
            if role is None:
                raise HTTPException(404, "not a member of this group")
            if role == "owner":
                raise HTTPException(
                    409, "the owner cannot leave their own group")
            await conn.execute("""
                DELETE FROM ops_artifact.workshop_group_member
                WHERE group_id = $1::uuid AND kc_sub = $2::uuid;
            """, group_id, kc)
    await ops_db.log_data_event(
        user=user, kind="group.left", payload={"group_id": group_id})
    return {"left": True, "group_id": group_id}
