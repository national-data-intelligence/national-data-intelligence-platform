"""demo.py — the demo-control contract.

WHAT THIS IS. Five endpoints that let an external console drive this deployment
during a demo: is it up, which country is it showing, switch country, run a
scripted action, how is that going. NHDW implements them here; any other
Palladium project implements the same five however it likes. The console stays
ignorant of what is behind them, which is the whole point — adding a project
becomes a database row rather than an integration.

    GET   /api/demo/health      up? degraded? which components
    GET   /api/demo/profile     active profile + what else is installed
    POST  /api/demo/profile     switch → job id
    POST  /api/demo/action/{id} run a scripted action → job id
    GET   /api/demo/job/{id}    stage-by-stage progress for either of those

AUTHORISATION. Everything that mutates requires the demo-control service token
(`DEMO_CONTROL_TOKEN`), the same shared-secret pattern the DQ detector uses. An
absent token disables the mutating half entirely rather than falling back to
something weaker — a console that cannot swap a profile is an inconvenience, an
open endpoint that can is not. `/health` stays open so the console can show a
status tile before anyone signs in.

WHAT A SWAP ACTUALLY COSTS. A profile has three layers and they are not
comparable:

    presentation   copy, geography, branding   seconds — done here, in-process
    appsec         people, roles, policy       ~a minute — seed script
    data           source replicas → pipeline  a full pipeline run

Only `presentation` is applied in this process. The other two are long-running
host operations that need kubectl and the seed scripts, so this route records
the request as a job and reports honestly that an operator path has to run it.
Pretending otherwise would let the console show a green tick over a warehouse
that never changed.
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Any, Literal

from fastapi import APIRouter, Body, Header, HTTPException
from pydantic import BaseModel, Field

from . import profile as profile_route
from ..settings import settings

log = logging.getLogger("gateway.demo")
router = APIRouter(prefix="/api/demo", tags=["demo"])

Layer = Literal["presentation", "appsec", "data"]

# ── jobs ────────────────────────────────────────────────────────────────────
# In-memory and deliberately so: a job describes one demo operation that lasts
# seconds to minutes, and a gateway restart mid-swap is itself the answer to
# "did it finish". Durable history belongs in the console's activity log, which
# is the thing anyone actually audits.
_JOBS: dict[str, dict[str, Any]] = {}
_JOB_CAP = 200


def _new_job(kind: str, detail: str, stages: list[str]) -> dict[str, Any]:
    if len(_JOBS) >= _JOB_CAP:
        for key in sorted(_JOBS, key=lambda k: _JOBS[k]["started_at"])[: _JOB_CAP // 4]:
            _JOBS.pop(key, None)
    job = {
        "id": uuid.uuid4().hex[:12],
        "kind": kind,
        "detail": detail,
        "state": "running",
        "started_at": time.time(),
        "finished_at": None,
        "stages": [{"name": s, "state": "waiting", "note": None,
                    "started_at": None, "finished_at": None} for s in stages],
        "error": None,
    }
    _JOBS[job["id"]] = job
    return job


def _stage(job: dict[str, Any], name: str, state: str, note: str | None = None) -> None:
    for s in job["stages"]:
        if s["name"] == name:
            if state == "running" and s["started_at"] is None:
                s["started_at"] = time.time()
            if state in ("done", "failed", "skipped"):
                s["finished_at"] = time.time()
            s["state"] = state
            if note:
                s["note"] = note
            return


def _finish(job: dict[str, Any], state: str, error: str | None = None) -> None:
    job["state"] = state
    job["error"] = error
    job["finished_at"] = time.time()


def _job_view(job: dict[str, Any]) -> dict[str, Any]:
    now = time.time()
    return {
        **{k: v for k, v in job.items() if k != "stages"},
        "elapsed_s": round((job["finished_at"] or now) - job["started_at"], 1),
        "stages": [
            {**s, "elapsed_s": round(((s["finished_at"] or now) - s["started_at"]), 1)
                    if s["started_at"] else None}
            for s in job["stages"]
        ],
    }


# ── auth ────────────────────────────────────────────────────────────────────

def _require_control(token: str | None) -> None:
    configured = getattr(settings, "DEMO_CONTROL_TOKEN", "") or ""
    if not configured:
        raise HTTPException(
            503, "demo control is disabled on this deployment "
                 "(no DEMO_CONTROL_TOKEN configured)")
    if token != configured:
        raise HTTPException(403, "bad demo-control token")


# ── health ──────────────────────────────────────────────────────────────────

@router.get("/health")
async def health() -> dict[str, Any]:
    """Is this deployment demo-ready?

    Deliberately more than a ping. A gateway that answers while the warehouse is
    empty is not something you want to walk into a meeting with, so this reports
    the components a demo actually depends on and lets the console decide what
    to show."""
    components: list[dict[str, Any]] = []

    async def probe(name: str, coro, detail: str = "") -> None:
        started = time.perf_counter()
        try:
            ok = bool(await asyncio.wait_for(coro, timeout=5))
            components.append({"name": name, "ok": ok, "detail": detail,
                               "ms": int((time.perf_counter() - started) * 1000)})
        except Exception as exc:                                # noqa: BLE001
            components.append({"name": name, "ok": False, "detail": str(exc)[:120],
                               "ms": int((time.perf_counter() - started) * 1000)})

    async def ops_db_ok() -> bool:
        from .. import ops_db
        pool = await ops_db.ensure_pool()
        async with pool.acquire() as conn:
            return await conn.fetchval("SELECT 1") == 1

    async def marts_ok() -> bool:
        from .. import trino_client
        res = await trino_client.query(
            "SELECT count(*) AS n FROM marts.bi_quality.mart_data_quality")
        rows = res.get("rows") or []
        return bool(rows) and int(rows[0].get("n") or 0) > 0

    await probe("operations database", ops_db_ok())
    await probe("marts", marts_ok(), "the numbers every dashboard reads")

    profile_ok = True
    try:
        installed = profile_route.list_profiles()
    except Exception:                                           # noqa: BLE001
        installed, profile_ok = [], False
    components.append({"name": "country profiles", "ok": profile_ok and bool(installed),
                       "detail": f"{len(installed)} installed", "ms": 0})

    healthy = all(c["ok"] for c in components)
    return {
        "ok": healthy,
        "state": "live" if healthy else "degraded",
        "components": components,
        "active_profile": profile_route.active_key(),
        "checked_at": time.time(),
    }


# ── profile ─────────────────────────────────────────────────────────────────

@router.get("/profile")
async def get_profile() -> dict[str, Any]:
    return {"active": profile_route.active_key(),
            "installed": profile_route.list_profiles()}


class SwapRequest(BaseModel):
    profile: str = Field(min_length=1, max_length=64)
    # Which layers to apply. Presentation alone is the fast path and covers
    # "show this as another country" — the case a colleague preparing a demo
    # actually wants. Including `data` means a pipeline run.
    layers: list[Layer] = Field(default_factory=lambda: ["presentation"])


@router.post("/profile")
async def swap_profile(body: SwapRequest = Body(...),
                       x_demo_token: str | None = Header(default=None,
                                                         alias="X-Demo-Token")) -> dict[str, Any]:
    """Switch the active profile.

    Returns a job immediately. The presentation layer is applied synchronously
    because it is a pointer write and a cache drop; the heavier layers are
    reported as requiring an operator path rather than silently skipped."""
    _require_control(x_demo_token)

    available = {p["key"] for p in profile_route.list_profiles()}
    if body.profile not in available:
        raise HTTPException(404, f"no profile '{body.profile}' installed on this host "
                                 f"(have: {', '.join(sorted(available)) or 'none'})")

    ordered = [l for l in ("presentation", "appsec", "data") if l in body.layers]
    if not ordered:
        raise HTTPException(400, "no layers requested")

    job = _new_job("profile-swap", f"{profile_route.active_key()} → {body.profile}",
                   ordered + ["verify"])

    try:
        if "presentation" in ordered:
            _stage(job, "presentation", "running")
            profile_route.set_active(body.profile)
            _stage(job, "presentation", "done",
                   "copy, geography and branding now serve the new profile")

        for heavy in ("appsec", "data"):
            if heavy in ordered:
                _stage(job, heavy, "skipped", _HEAVY_NOTE[heavy])

        _stage(job, "verify", "running")
        active = profile_route.active_key()
        if active != body.profile:
            raise RuntimeError(f"pointer says '{active}' after writing '{body.profile}'")
        _stage(job, "verify", "done", f"serving {active}")
        _finish(job, "succeeded" if ordered == ["presentation"] else "partial")
    except Exception as exc:                                    # noqa: BLE001
        log.exception("demo: profile swap failed")
        _finish(job, "failed", str(exc)[:300])

    return _job_view(job)


_HEAVY_NOTE = {
    "appsec": "not applied here — people, roles and policy are reseeded by "
              "seed-app-security.sh, which needs cluster access the gateway does not have",
    "data": "not applied here — swapping source replicas means re-running the "
            "pipeline end to end (sources-up.sh then seed-realistic.sh); it is a "
            "scheduled operation, not a request/response",
}


# ── actions ─────────────────────────────────────────────────────────────────
# A demo action is a named, reversible-where-possible thing a presenter can fire
# from the console, with a deep link to the page that shows its effect. They are
# declared rather than free-form so the console can render them and so the blast
# radius of each is written down.

ACTIONS: list[dict[str, Any]] = [
    {
        "id": "reset-profile",
        "label": "Reset to the default profile",
        "description": "Switches presentation back to the profile this deployment ships with.",
        "deep_link": "/",
        "reversible": True,
        "blast_radius": "presentation only — no data is written",
    },
    {
        "id": "refresh-dq",
        "label": "Re-run quality detection",
        "description": "Runs the data-quality detector so the incident queue reflects "
                       "the warehouse as it stands right now.",
        "deep_link": "/admin/quality",
        "reversible": True,
        "blast_radius": "writes incident rows; deduped by fingerprint, so a re-run "
                        "updates rather than accumulates",
    },
]


@router.get("/actions")
async def list_actions() -> dict[str, Any]:
    return {"actions": ACTIONS}


@router.post("/action/{action_id}")
async def run_action(action_id: str,
                     x_demo_token: str | None = Header(default=None,
                                                       alias="X-Demo-Token")) -> dict[str, Any]:
    _require_control(x_demo_token)
    action = next((a for a in ACTIONS if a["id"] == action_id), None)
    if action is None:
        raise HTTPException(404, f"no demo action '{action_id}'")

    job = _new_job("demo-action", action["label"], ["run"])
    _stage(job, "run", "running")
    try:
        if action_id == "reset-profile":
            import os as _os
            default = _os.environ.get("NHDW_PROFILE", "et-v3")
            profile_route.set_active(default)
            _stage(job, "run", "done", f"serving {default}")
        elif action_id == "refresh-dq":
            from . import dq
            summary = await dq._run_detection()
            _stage(job, "run", "done",
                   f"{summary.get('findings', 0)} findings · "
                   f"{summary.get('open_flags', 0)} open")
        _finish(job, "succeeded")
    except Exception as exc:                                    # noqa: BLE001
        log.exception("demo: action %s failed", action_id)
        _stage(job, "run", "failed", str(exc)[:200])
        _finish(job, "failed", str(exc)[:300])

    return {**_job_view(job), "deep_link": action["deep_link"]}


# ── jobs ────────────────────────────────────────────────────────────────────

@router.get("/job/{job_id}")
async def get_job(job_id: str) -> dict[str, Any]:
    job = _JOBS.get(job_id)
    if job is None:
        raise HTTPException(404, "no such job (jobs are kept in memory and do not "
                                 "survive a gateway restart)")
    return _job_view(job)
