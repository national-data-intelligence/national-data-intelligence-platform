"""/api/graduation — PROJECT-centric graduation (public-review) pathway.

Owner model (2026-07-08): the unit of review is the PROJECT. An owner SUBMITS
A PROJECT to become public. Review is two-part:
  (a) an AUTOMATED essential-files check over the project's MinIO files (an
      inference script, a retrain script if a model is present, a model artifact
      or notebook, metadata/readme), and
  (b) a HUMAN reviewer who OPENS the project (spawns a lab — see workspace.py),
      runs its notebooks, and approves.
On approval the project becomes public and its model is integrated into the
catalogue (task #45 — a HOOK: ml_integration.integrate_approved_project_model).

Flow:
   POST /api/graduation/project/{project_id}/submit   (contributor + owner)
     → runs the essential-files check → review_checklist
     → project.review_status = 'in_review' (+ submitted_at/by)
     → returns the checklist + all_essentials_present (submit is allowed even
       with gaps — the human reviewer decides; the flag lets the UI warn)

   GET  /api/graduation/project-queue                 (reviewers only)
     → projects WHERE review_status IN ('in_review','changes_requested')

   GET  /api/graduation/project/{project_id}          (reviewer or owner)
     → full detail incl. checklist + file listing (so the reviewer inspects)

   POST /api/graduation/project/{project_id}/approve  (reviewers only)
     → review_status='approved', reviewed_at/by, visibility='public'
     → project_review verdict='approved'
     → THEN the #45 hook integrate_approved_project_model(...) (currently no-ops)

   POST /api/graduation/project/{project_id}/reject   (reviewers only)
     → {note, changes_requested?} → 'changes_requested' | 'rejected'
     → project_review verdict

The artifact-centric legs (multipart tarball /submit, /{artifact_id}/validate,
tarball validator hard-gate, /{artifact_id}/promote, /queue, /{artifact_id})
were RETIRED here and archived to
_archive/2026-07-08/graduation-artifact-centric/ (per the project working agreement — the old path
is GONE from the tree, not coexisting). The MLflow-alias primitive
`_set_mlflow_alias` is RETAINED below for task #45 (ml_integration) to reuse.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from uuid import UUID

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Path as PathParam

from ..auth import UserCtx, get_user
from ..settings import settings
from .. import ops_db, opa, minio_client, ml_integration

log = logging.getLogger("gateway.graduation")
router = APIRouter(prefix="/api/graduation", tags=["graduation"])

MLFLOW_URL      = os.environ.get("MLFLOW_URL",
                                 "http://mlflow.nhdw.svc.cluster.local:5000")
# Project files live in the same bucket/prefix projects.py writes to — mirror it
# exactly (repetition over coupling; the two routers stay independent).
PROJECTS_BUCKET = os.environ.get("ARTIFACTS_BUCKET", settings.ARTIFACTS_BUCKET)


def _files_prefix(pid: str) -> str:
    return f"projects/{pid}/files/"


# ── authz: DIRECT role gate (house pattern — see ml.py `_manage_gate`). The
# graduation verbs have no OPA rego arm (the data-plane policies only know DC.*
# read/write), so gate by role here. REVIEWER_ROLES / CONTRIBUTOR_ROLES are the
# stable contract IMPORTED by routes/groups.py + routes/datasets.py — keep them.
REVIEWER_ROLES    = ("R-OPS-ADM", "R-STEW", "R-SUPER")
CONTRIBUTOR_ROLES = ("R-CONS-SCI", "R-CONS-RES", "R-CONS-ANA",
                     "R-CONS-PRT") + REVIEWER_ROLES


def is_reviewer(user: UserCtx) -> bool:
    return any(r in REVIEWER_ROLES for r in user.roles)


def _review_gate(user: UserCtx) -> opa.Decision:
    """queue / approve / reject are REVIEWER actions. Full-role-set check:
    primary_role is just the first R- role in an unordered Keycloak claim, so a
    steward whose token carries e.g. ['R-CONS-ANA','R-STEW'] must not be denied."""
    allowed = is_reviewer(user)
    return opa.Decision(
        allow=allowed,
        reason=f"graduation review gate: roles {user.roles} "
               f"{'allowed' if allowed else 'denied'} (reviewers only)")


def _contrib_gate(user: UserCtx) -> opa.Decision:
    """submit is a CONTRIBUTOR action (any workshop contributor, and reviewers
    who are also contributors). Full-role-set check (see _review_gate)."""
    allowed = any(r in CONTRIBUTOR_ROLES for r in user.roles)
    return opa.Decision(
        allow=allowed,
        reason=f"graduation contributor gate: roles {user.roles} "
               f"{'allowed' if allowed else 'denied'} (contributors only)")


# ── essential-files check ─────────────────────────────────────────────────
# Heuristic, case-insensitive match on each file's BASENAME. Nested folders are
# fine (we match the last path segment). Requirements:
#   inference script            infer*.py | predict*.py           (required)
#   model artifact OR notebook  *.pkl|*.joblib|*.onnx|*.pt | *.ipynb (required)
#   retrain/train script        train*.py     (required IFF a model artifact present)
#   metadata/readme             README* | model_card* | manifest.y*ml (required)
_MODEL_EXTS   = (".pkl", ".joblib", ".onnx", ".pt")
_RE_INFER     = re.compile(r"^(infer|predict).*\.py$", re.I)
_RE_TRAIN     = re.compile(r"^train.*\.py$", re.I)
_RE_MANIFEST  = re.compile(r"^manifest\.ya?ml$", re.I)


def _basename(name: str) -> str:
    return name.rsplit("/", 1)[-1]


def _is_model(bn: str) -> bool:
    return bn.lower().endswith(_MODEL_EXTS)


def _is_notebook(bn: str) -> bool:
    return bn.lower().endswith(".ipynb")


def _is_meta(bn: str) -> bool:
    low = bn.lower()
    return (low.startswith("readme")
            or low.startswith("model_card")
            or bool(_RE_MANIFEST.match(bn)))


def essential_files_check(file_names: list[str]) -> list[dict]:
    """Build the checklist from a list of project-relative file names. Each item
    is {requirement, present, matched:[...], required}. `required` encodes the
    'retrain only if a model is present' rule so all_essentials_present can be
    derived consistently by both the gateway and the UI."""
    names = [n for n in file_names
             if n and n != ".keep" and not n.endswith("/.keep")]

    infer_m    = sorted(n for n in names if _RE_INFER.match(_basename(n)))
    train_m    = sorted(n for n in names if _RE_TRAIN.match(_basename(n)))
    model_m    = sorted(n for n in names if _is_model(_basename(n)))
    notebook_m = sorted(n for n in names if _is_notebook(_basename(n)))
    meta_m     = sorted(n for n in names if _is_meta(_basename(n)))
    has_model  = bool(model_m)

    return [
        {"requirement": "inference script (infer*/predict*.py)",
         "present": bool(infer_m), "matched": infer_m, "required": True},
        {"requirement": "model artifact (.pkl/.joblib/.onnx/.pt) or notebook (.ipynb)",
         "present": bool(model_m or notebook_m),
         "matched": model_m + notebook_m, "required": True},
        {"requirement": "retrain/train script (train*.py)",
         "present": bool(train_m), "matched": train_m,
         # required only when a model artifact is present in the project
         "required": has_model},
        {"requirement": "metadata/readme (README*/model_card*/manifest.y*ml)",
         "present": bool(meta_m), "matched": meta_m, "required": True},
    ]


def _all_essentials_present(checklist) -> bool:
    # jsonb round-trips to a Python list via the ops_db codec. Be defensive: a
    # legacy/edge row could hold a JSON *string* (double-encoded) — parse it
    # rather than 500 the whole reviewer queue.
    if isinstance(checklist, str):
        try:
            checklist = json.loads(checklist)
        except Exception:                                         # noqa: BLE001
            return False
    if not checklist or not isinstance(checklist, list):
        return False
    return all(item.get("present") for item in checklist
               if isinstance(item, dict) and item.get("required"))


async def _list_project_files(project_id: str) -> list[dict]:
    """Raw project file listing (name/size/last_modified), markers stripped."""
    objs = await minio_client.list_prefix(prefix=_files_prefix(project_id),
                                           bucket=PROJECTS_BUCKET)
    out = []
    for o in objs:
        name = o["name"]
        if not name or name == ".keep" or name.endswith("/.keep"):
            continue
        lm = o.get("last_modified")
        out.append({"name": name, "size": o.get("size", 0),
                    "last_modified": lm.isoformat() if hasattr(lm, "isoformat") else lm})
    return out


async def _model_manifest_fingerprint(project_id: str,
                                      model_name: str) -> tuple[str, str, int]:
    """Locate the adopted model's manifest object under the project's files/
    prefix and return (minio_key, sha256, byte_count) for its artifact version.
    The SHALLOWEST key whose basename is manifest.yml/.yaml wins (the package's
    top-level manifest). Honest fallback when none is present / readable: the
    files/ prefix itself, a hash of the model name, and byte_count 0 — so a
    project whose files were not (yet) uploaded still adopts cleanly."""
    prefix = _files_prefix(project_id)
    objs = await minio_client.list_prefix(prefix=prefix, bucket=PROJECTS_BUCKET)
    cand = sorted((o["key"] for o in objs
                   if _RE_MANIFEST.match(_basename(o["key"]))),
                  key=lambda k: (k.count("/"), k))
    if cand:
        raw = await minio_client.read_object(key=cand[0], bucket=PROJECTS_BUCKET)
        if raw is not None:
            return cand[0], hashlib.sha256(raw).hexdigest(), len(raw)
    return prefix, hashlib.sha256(model_name.encode()).hexdigest(), 0


def _proj_out(row) -> dict:
    """JSON-safe project row (uuid→str, ts→isoformat)."""
    d = dict(row)
    for k in ("id", "owner_kc_sub", "group_id", "submitted_by", "reviewed_by"):
        if d.get(k) is not None:
            d[k] = str(d[k])
    for k in ("created_at", "updated_at", "submitted_at", "reviewed_at"):
        v = d.get(k)
        if v is not None and hasattr(v, "isoformat"):
            d[k] = v.isoformat()
    return d


# ── submit (contributor + project owner/group-member) ─────────────────────
@router.post("/project/{project_id}/submit")
async def submit_project(
    project_id: str = PathParam(...),
    user: UserCtx = Depends(get_user),
) -> dict:
    decision = _contrib_gate(user)
    if not decision.allow:
        raise HTTPException(403, decision.reason or "denied")
    try:
        UUID(project_id)
    except (ValueError, TypeError):
        raise HTTPException(404, "project not found")

    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        prj = await conn.fetchrow("""
            SELECT owner_kc_sub, visibility, group_id, status, review_status
            FROM ops_workspace.project WHERE id = $1::uuid;
        """, project_id)
        if prj is None:
            raise HTTPException(404, "project not found")
        if prj["status"] != "active":
            raise HTTPException(409, "project is archived")
        # Owner rule: submit REQUIRES being the owner, or a member of a group
        # project's group (mirrors projects._assert_contribute).
        if str(prj["owner_kc_sub"]) != (user.kc_sub or ""):
            is_member = prj["visibility"] == "group" and bool(
                await conn.fetchval("""
                    SELECT 1 FROM ops_artifact.workshop_group_member
                    WHERE group_id = $1::uuid AND kc_sub = $2::uuid;
                """, prj["group_id"], user.kc_sub))
            if not is_member:
                raise HTTPException(
                    403, "you cannot submit this project "
                         "(owner or project-group members only)")
        if prj["review_status"] == "in_review":
            raise HTTPException(409, "project is already under review")
        if prj["review_status"] == "approved":
            raise HTTPException(409, "project is already approved (public)")

    # Essential-files check over the project's MinIO files (CPU/IO work; done
    # outside the DB transaction). Submit is ALLOWED even with gaps.
    files = await _list_project_files(project_id)
    checklist = essential_files_check([f["name"] for f in files])
    all_present = _all_essentials_present(checklist)

    async with pool.acquire() as conn:
        await conn.execute("""
            UPDATE ops_workspace.project
               SET review_status = 'in_review',
                   submitted_at = now(),
                   submitted_by = $2::uuid,
                   review_checklist = $3::jsonb,
                   reviewed_at = NULL, reviewed_by = NULL,
                   updated_at = now()
             WHERE id = $1::uuid
        """, project_id, user.kc_sub, checklist)

    await ops_db.log_data_event(
        user=user, kind="graduation.project_submitted",
        payload={"project_id": project_id,
                 "all_essentials_present": all_present,
                 "checklist": [{"r": c["requirement"], "p": c["present"],
                                "req": c["required"]} for c in checklist]})
    return {"project_id": project_id, "review_status": "in_review",
            "checklist": checklist, "all_essentials_present": all_present}


# ── reviewer queue ────────────────────────────────────────────────────────
@router.get("/project-queue")
async def project_queue(user: UserCtx = Depends(get_user)) -> dict:
    decision = _review_gate(user)
    if not decision.allow:
        raise HTTPException(403, decision.reason or "reviewers only")
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT p.id, p.slug, p.name, p.visibility, p.review_status,
                   p.owner_kc_sub, u.username AS owner_username,
                   p.submitted_at, p.submitted_by, p.review_checklist
            FROM ops_workspace.project p
            LEFT JOIN ops_identity."user" u ON u.kc_sub = p.owner_kc_sub
            WHERE p.review_status IN ('in_review','changes_requested')
            ORDER BY p.submitted_at DESC NULLS LAST LIMIT 200;
        """)
    queue = []
    for r in rows:
        d = _proj_out(r)
        d["all_essentials_present"] = _all_essentials_present(r["review_checklist"])
        queue.append(d)
    return {"queue": queue, "count": len(queue)}


# ── detail (reviewer or owner) ────────────────────────────────────────────
@router.get("/project/{project_id}")
async def project_detail(project_id: str = PathParam(...),
                         user: UserCtx = Depends(get_user)) -> dict:
    try:
        UUID(project_id)
    except (ValueError, TypeError):
        raise HTTPException(404, "not found")
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        prj = await conn.fetchrow("""
            SELECT p.*, u.username AS owner_username
            FROM ops_workspace.project p
            LEFT JOIN ops_identity."user" u ON u.kc_sub = p.owner_kc_sub
            WHERE p.id = $1::uuid;
        """, project_id)
        if prj is None:
            raise HTTPException(404, "not found")
        is_owner = bool(user.kc_sub) and str(prj["owner_kc_sub"]) == user.kc_sub
        # A reviewer may see the project ONLY once it has been submitted
        # (in_review / changes_requested / approved) — never an un-submitted
        # draft (anti-enumeration: 404, not 403).
        reviewer_ok = is_reviewer(user) and prj["review_status"] in (
            "in_review", "changes_requested", "approved")
        if not (is_owner or reviewer_ok):
            raise HTTPException(404, "not found")
        reviews = [dict(r) for r in await conn.fetch("""
            SELECT id, reviewer, verdict, comment, reviewed_at
            FROM ops_workspace.project_review
            WHERE project_id = $1::uuid ORDER BY reviewed_at DESC LIMIT 50;
        """, project_id)]

    files = await _list_project_files(project_id)
    # Re-derive the checklist live over CURRENT files so the reviewer sees the
    # up-to-date picture (the stored one is the snapshot at submit time).
    checklist = essential_files_check([f["name"] for f in files])
    out = _proj_out(prj)
    for rv in reviews:
        rv["id"] = str(rv["id"]); rv["reviewer"] = str(rv["reviewer"])
        if hasattr(rv["reviewed_at"], "isoformat"):
            rv["reviewed_at"] = rv["reviewed_at"].isoformat()
    return {"project": out,
            "checklist": checklist,
            "all_essentials_present": _all_essentials_present(checklist),
            "files": files, "file_count": len(files),
            "reviews": reviews}


# ── approve (reviewers only) ──────────────────────────────────────────────
@router.post("/project/{project_id}/approve")
async def approve_project(
    project_id: str = PathParam(...),
    user: UserCtx = Depends(get_user),
    comment: str | None = Body(default=None, embed=True),
) -> dict:
    decision = _review_gate(user)
    if not decision.allow:
        raise HTTPException(403, decision.reason or "reviewers only")
    try:
        UUID(project_id)
    except (ValueError, TypeError):
        raise HTTPException(404, "not found")

    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        prj = await conn.fetchrow("""
            SELECT review_status, review_checklist FROM ops_workspace.project
            WHERE id = $1::uuid;
        """, project_id)
        if prj is None:
            raise HTTPException(404, "not found")
        if prj["review_status"] not in ("in_review", "changes_requested"):
            raise HTTPException(
                409, f"project is not awaiting review "
                     f"(review_status={prj['review_status']})")
        checklist_obj = prj["review_checklist"]
        # All writes commit together (see the artifact-centric predecessor): a
        # failure must never leave the project public with no verdict trail.
        async with conn.transaction():
            # Approve → publish: visibility='public'. The DB CHECK forbids a
            # group_id on non-group visibility, so clear it on the transition
            # (a group project graduating to public drops its group linkage).
            await conn.execute("""
                UPDATE ops_workspace.project
                   SET review_status = 'approved',
                       visibility = 'public', group_id = NULL,
                       reviewed_at = now(), reviewed_by = $2::uuid,
                       updated_at = now()
                 WHERE id = $1::uuid
            """, project_id, user.kc_sub)
            await conn.execute("""
                INSERT INTO ops_workspace.project_review
                    (project_id, reviewer, verdict, comment, checklist)
                VALUES ($1::uuid, $2::uuid, 'approved', $3, $4::jsonb)
            """, project_id, user.kc_sub, comment, checklist_obj)

        # #45 HOOK — integrate the approved project's model into the catalogue.
        # Currently a no-op stub; approval must NOT fail on it (the project is
        # already public + the verdict recorded above).
        try:
            integration = await ml_integration.integrate_approved_project_model(
                conn, project_id, user)
        except Exception as exc:                                  # noqa: BLE001
            log.warning("ml_integration hook failed for %s: %s", project_id, exc)
            integration = {"integrated": False, "reason": f"hook error: {exc}"[:300]}

    await ops_db.log_policy_decision(
        user=user, action="approve.project", resource=project_id,
        decision="allow", rule_hits=decision.rule_hits,
        explanation={"review_status": "approved", "visibility": "public",
                     "integration": integration})
    return {"project_id": project_id, "review_status": "approved",
            "visibility": "public", "integration": integration}


# ── adopt a platform model onto its project (reviewers only) ───────────────
@router.post("/project/{project_id}/adopt-model")
async def adopt_model(
    project_id: str = PathParam(...),
    user: UserCtx = Depends(get_user),
    model_name: str = Body(..., embed=True),
    title: str | None = Body(default=None, embed=True),
    description: str | None = Body(default=None, embed=True),
    note: str | None = Body(default=None, embed=True),
) -> dict:
    """Bind an ALREADY-INTEGRATED platform model (trained by seed-ml.sh into
    MLflow + ops_ml.model_deployment) onto a workshop PROJECT as an approved,
    public project: a kind='model' artifact bound to the MLflow model + an
    approved review record, and the project published. It does NOT re-train,
    fork, or spawn a runner (the model is already integrated) — it only makes
    the project the catalogue home of that platform model. Convergent +
    idempotent: re-running reuses the existing artifact / review row and
    re-asserts the approved+public state. Platform models bypass the
    submit→review gate — ANY current review_status (incl. draft) is adopted."""
    decision = _review_gate(user)
    if not decision.allow:
        raise HTTPException(403, decision.reason or "reviewers only")
    try:
        UUID(project_id)
    except (ValueError, TypeError):
        raise HTTPException(404, "not found")

    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        # The model must be a REAL integrated platform model — its deployment row
        # is registered by seed-ml.sh. Never adopt a name that isn't served.
        if not await conn.fetchval(
                "SELECT 1 FROM ops_ml.model_deployment WHERE model_name = $1",
                model_name):
            raise HTTPException(404, f"model not registered: {model_name}")
        prj = await conn.fetchrow("""
            SELECT owner_kc_sub, slug, review_status
            FROM ops_workspace.project WHERE id = $1::uuid;
        """, project_id)
        if prj is None:
            raise HTTPException(404, "not found")
        owner = prj["owner_kc_sub"]

        # Fingerprint the model's manifest object for the artifact version's real
        # size + hash (MinIO IO — outside the write path, like approve's
        # essential-files check). Honest fallback when no manifest is present.
        minio_key, sha256, byte_count = await _model_manifest_fingerprint(
            project_id, model_name)

        # All writes commit together (mirrors approve_project): a failure must
        # never leave a public project with no artifact / verdict trail.
        async with conn.transaction():
            # Convergent artifact: reuse the model artifact already bound to this
            # (project, MLflow model) pair rather than creating a duplicate.
            aid = await conn.fetchval("""
                SELECT id FROM ops_artifact.artifact
                WHERE project_id = $1::uuid AND kind = 'model'
                  AND mlflow_model_name = $2;
            """, project_id, model_name)
            if aid is None:
                aid = await conn.fetchval("""
                    INSERT INTO ops_artifact.artifact
                        (owner, kind, title, description, license, tier,
                         project_id, mlflow_model_name, peer_review_status, tags)
                    VALUES ($1, 'model', $2, $3, 'CC-BY-4.0', 'public',
                            $4::uuid, $5, 'approved', $6::text[])
                    RETURNING id;
                """, owner, title or model_name, description, project_id,
                     model_name, ["model", "platform"])
                await conn.execute("""
                    INSERT INTO ops_artifact.artifact_version
                        (artifact_id, version, minio_bucket, minio_key,
                         sha256, byte_count, change_note)
                    VALUES ($1, 1, $2, $3, $4, $5,
                            'platform model adopted onto project');
                """, aid, PROJECTS_BUCKET, minio_key, sha256, byte_count)

            # Approve → publish. Platform models bypass the submit→review gate,
            # so ANY current review_status transitions to approved. The DB CHECK
            # forbids a group_id on non-group visibility → clear it on publish.
            await conn.execute("""
                UPDATE ops_workspace.project
                   SET review_status = 'approved',
                       visibility = 'public', group_id = NULL,
                       reviewed_at = now(), reviewed_by = $2::uuid,
                       updated_at = now()
                 WHERE id = $1::uuid
            """, project_id, user.kc_sub)

            # Convergent review-audit row: one approved verdict, not one per re-run.
            if not await conn.fetchval("""
                    SELECT 1 FROM ops_workspace.project_review
                    WHERE project_id = $1::uuid AND verdict = 'approved';
            """, project_id):
                await conn.execute("""
                    INSERT INTO ops_workspace.project_review
                        (project_id, reviewer, verdict, comment, checklist)
                    VALUES ($1::uuid, $2::uuid, 'approved', $3, NULL)
                """, project_id, user.kc_sub, note)

    await ops_db.log_policy_decision(
        user=user, action="adopt.model", resource=project_id,
        decision="allow", rule_hits=decision.rule_hits,
        explanation={"model_name": model_name, "artifact_id": str(aid),
                     "review_status": "approved", "adopted": True})
    return {"project_id": project_id, "model_name": model_name,
            "artifact_id": str(aid), "review_status": "approved",
            "adopted": True}


# ── reject / request-changes (reviewers only) ─────────────────────────────
@router.post("/project/{project_id}/reject")
async def reject_project(
    project_id: str = PathParam(...),
    user: UserCtx = Depends(get_user),
    note: str | None = Body(default=None, embed=True),
    changes_requested: bool = Body(default=False, embed=True),
) -> dict:
    decision = _review_gate(user)
    if not decision.allow:
        raise HTTPException(403, decision.reason or "reviewers only")
    try:
        UUID(project_id)
    except (ValueError, TypeError):
        raise HTTPException(404, "not found")

    new_status = "changes_requested" if changes_requested else "rejected"
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        prj = await conn.fetchrow("""
            SELECT review_status, review_checklist FROM ops_workspace.project
            WHERE id = $1::uuid;
        """, project_id)
        if prj is None:
            raise HTTPException(404, "not found")
        if prj["review_status"] not in ("in_review", "changes_requested"):
            raise HTTPException(
                409, f"project is not awaiting review "
                     f"(review_status={prj['review_status']})")
        checklist_obj = prj["review_checklist"]
        async with conn.transaction():
            await conn.execute("""
                UPDATE ops_workspace.project
                   SET review_status = $2,
                       reviewed_at = now(), reviewed_by = $3::uuid,
                       updated_at = now()
                 WHERE id = $1::uuid
            """, project_id, new_status, user.kc_sub)
            await conn.execute("""
                INSERT INTO ops_workspace.project_review
                    (project_id, reviewer, verdict, comment, checklist)
                VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb)
            """, project_id, user.kc_sub, new_status, note, checklist_obj)

    await ops_db.log_data_event(
        user=user, kind="graduation.project_rejected",
        payload={"project_id": project_id, "review_status": new_status,
                 "note": note})
    return {"project_id": project_id, "review_status": new_status}


# ── MLflow alias primitive — RETAINED for task #45 (ml_integration) ────────
async def _set_mlflow_alias(canonical_name: str, alias: str) -> dict:
    """Point the MLflow alias at the latest registered version of the canonical
    model. RETAINED (not currently called by the project-centric flow) so #45's
    model integration (ml_integration.integrate_approved_project_model) can
    reuse it. Raises on failure (caller decides how to surface)."""
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(
            f"{MLFLOW_URL}/api/2.0/mlflow/model-versions/search",
            params={"filter": f"name='{canonical_name}'", "max_results": "200"})
        r.raise_for_status()
        versions = (r.json() or {}).get("model_versions") or []
        if not versions:
            raise RuntimeError(
                f"no MLflow versions registered under {canonical_name!r} — "
                f"run the runner train Job for the package first")
        latest = max(versions, key=lambda v: int(v.get("version") or 0))
        r = await c.post(
            f"{MLFLOW_URL}/api/2.0/mlflow/registered-models/alias",
            json={"name": canonical_name, "alias": alias,
                  "version": latest["version"]})
        r.raise_for_status()
    return {"alias": alias, "version": latest["version"]}
