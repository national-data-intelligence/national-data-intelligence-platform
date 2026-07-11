"""/api/dq — data-quality + lineage surface for the Admin dashboard.

Reads dbt artifacts (manifest.json + run_results.json + catalog.json)
from MinIO at nhdw-artifacts/dbt/<project>/. dbt-marts uploads them
post-build via the entrypoint wrapper. The local bind-mount path is a
fallback for non-k8s setups (docker-compose dev).

  GET  /api/dq/summary        dbt build health — pass/fail counts + runtime
  GET  /api/dq/tests          per-test outcome + duration + msg + ack state
  GET  /api/dq/models         per-model latest status (model + its dbt tests)
  GET  /api/dq/lineage        DAG nodes + edges (tier + test-status). The
                              admin page renders only a compact summary of
                              this; the full graph lives in dbt Docs.
  GET  /api/dq/sources        per-source completeness/validity/timeliness +
                              report volume, from bi_quality.mart_data_quality
                              (all six ingested sources).
  GET  /api/dq/ingestion      per-source freshness + ingestion status from the
                              raw-lake _manifest.json sidecars: last successful
                              ingest, records last cycle, lag vs SLA, and which
                              sources changed last run (probe-lake fingerprint).
  GET  /api/dq/dimensions     five-dimension DQ scorecard (completeness ·
                              validity · timeliness · consistency · uniqueness).
  GET  /api/dq/reconciliation real cross-source agreement from the business
                              vault same-as links (facility + commodity master).
  GET  /api/dq/compliance     k-anonymity compliance for bi_public marts.
  POST /api/dq/ack            acknowledge a failing/warning dbt test —
                              persists to ops_governance.dq_flag + dq_ack.

Admin OPA-gated. Reads are read-only; /ack writes an operator ack.

dbt artifacts are cached in-process for ARTIFACT_CACHE_TTL_S (default 30s);
raw-lake ingestion manifests get their own short cache so the freshness
widget stays snappy without thrashing MinIO.
"""
from __future__ import annotations

import io
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..auth import UserCtx, get_user
from ..settings import settings
from .. import opa, ops_db, trino_client
# Admin ops-console surfaces gate on the RBAC capability, NOT opa.decide:
# no rego rule matches admin.* verbs, so opa.decide denies under OPA_ENFORCE (see #53).
from .perm_admin import _require_capability

log = logging.getLogger("gateway.dq")
router = APIRouter(prefix="/api/dq", tags=["dq"])

DBT_TARGET_DIR = Path(os.environ.get("DBT_TARGET_DIR", "/dbt-target/marts"))
DBT_PROJECT    = os.environ.get("DBT_PROJECT_NAME", "marts")
ARTIFACTS_BUCKET = os.environ.get("DBT_ARTIFACTS_BUCKET", "nhdw-artifacts")
RAW_BUCKET     = os.environ.get("DBT_RAW_BUCKET", "nhdw-raw")
ARTIFACT_CACHE_TTL_S = int(os.environ.get("DQ_CACHE_TTL_S", "30"))

# in-process artifact cache: {filename: (loaded_at_ts, content_dict)}
_cache: dict[str, tuple[float, dict[str, Any]]] = {}
# separate cache for the (heavier) raw-lake ingestion scan.
_ingest_cache: tuple[float, list[dict[str, Any]]] | None = None

# ── Source registry — the SIX directly-ingested sources, their raw-lake
# prefix (nhdw-raw/<prefix>/…), and the freshness SLA (hours) the ingestion
# widget grades lag against. Every one lands bytes via its own ingestor —
# Climate included (nhdw-raw/climate/… → hub_climate_week). There is no
# "derived, no ingest" source here. ──
SOURCES: list[dict[str, Any]] = [
    {"key": "DHIS2",    "raw_prefix": "dhis2",    "sla_hours": 6},
    {"key": "EthioEMR", "raw_prefix": "ethioemr", "sla_hours": 1},
    {"key": "HCMIS",    "raw_prefix": "hcmiswdm", "sla_hours": 4},
    {"key": "mBrana",   "raw_prefix": "mbrana",   "sla_hours": 2},
    {"key": "MFR",      "raw_prefix": "mfr",      "sla_hours": 48},
    {"key": "Climate",  "raw_prefix": "climate",  "sla_hours": 168},
]
_SOURCE_BY_PREFIX = {s["raw_prefix"]: s for s in SOURCES if s["raw_prefix"]}

# mart_data_quality still emits the legacy 'EWARS/Climate' label for its
# climate row (its accepted_values dbt test pins that exact string, and the
# marts are owned by another workstream). Normalise it to the canonical
# source key here so the source-health widget can fold each quality row into
# the SAME source as its ingestion-freshness row.
_MART_SOURCE_ALIAS = {"EWARS/Climate": "Climate"}


def _load_artifact(name: str) -> dict[str, Any]:
    """Read a dbt artifact (manifest.json, run_results.json, etc.) —
    prefer MinIO `nhdw-artifacts/dbt/<project>/<name>` so the gateway
    sees the latest dbt-marts run; fall back to the bind-mounted path
    for non-k8s setups. In-process cache with ARTIFACT_CACHE_TTL_S TTL."""
    now = time.time()
    hit = _cache.get(name)
    if hit and now - hit[0] < ARTIFACT_CACHE_TTL_S:
        return hit[1]

    # First try MinIO via the gateway's existing MinIO client.
    try:
        import boto3
        s3 = boto3.client(
            "s3",
            endpoint_url=settings.MINIO_ENDPOINT,
            aws_access_key_id=settings.MINIO_ACCESS_KEY,
            aws_secret_access_key=settings.MINIO_SECRET_KEY,
            region_name="us-east-1",
        )
        key = f"dbt/{DBT_PROJECT}/{name}"
        obj = s3.get_object(Bucket=ARTIFACTS_BUCKET, Key=key)
        data = json.load(io.BytesIO(obj["Body"].read()))
        _cache[name] = (now, data)
        return data
    except Exception as exc:                                    # noqa: BLE001
        log.debug("MinIO artifact fetch failed for %s: %s — trying local mount", name, exc)

    # Fall back to bind-mount.
    f = DBT_TARGET_DIR / name
    if f.exists():
        with f.open() as fh:
            data = json.load(fh)
        _cache[name] = (now, data)
        return data
    return {}


def _load_run_results() -> dict[str, Any]:
    return _load_artifact("run_results.json")


def _load_manifest() -> dict[str, Any]:
    return _load_artifact("manifest.json")


async def _gate(user: UserCtx, action: str = "admin.dq.read",
                resource: str = "dbt") -> None:
    """Shared admin gate — every /api/dq/* route requires the ops-console RBAC
    capability. (action/resource kept for call-site compatibility but unused: the
    capability check is the real gate — admin.* verbs match no rego rule.)"""
    await _require_capability(user, "view_ops_console")


def _s3():
    """boto3 S3 client against MinIO (same construction as _load_artifact)."""
    import boto3
    return boto3.client(
        "s3",
        endpoint_url=settings.MINIO_ENDPOINT,
        aws_access_key_id=settings.MINIO_ACCESS_KEY,
        aws_secret_access_key=settings.MINIO_SECRET_KEY,
        region_name="us-east-1",
    )


_DAY_RE = re.compile(r"/year=(\d{4})/month=(\d{2})/day=(\d{2})/")


def _scan_source_manifests(s3, prefix: str, *, cap: int = 160
                           ) -> list[dict[str, Any]]:
    """List + read the `_manifest.json` sidecars under nhdw-raw/<prefix>/.

    Returns one dict per manifest with the day parsed from its key. Capped
    so a busy source can't stall the request."""
    out: list[dict[str, Any]] = []
    paginator = s3.get_paginator("list_objects_v2")
    keys: list[str] = []
    for page in paginator.paginate(Bucket=RAW_BUCKET, Prefix=f"{prefix}/"):
        for obj in page.get("Contents") or []:
            k = obj["Key"]
            if k.endswith("_manifest.json"):
                keys.append(k)
    # Newest partitions first (keys sort lexically by year/month/day).
    keys.sort(reverse=True)
    for k in keys[:cap]:
        m = _DAY_RE.search(k)
        day = f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None
        try:
            body = s3.get_object(Bucket=RAW_BUCKET, Key=k)["Body"].read()
            doc = json.loads(body)
        except Exception:                                       # noqa: BLE001
            continue
        out.append({
            "day":                   day,
            "object":                doc.get("object"),
            "row_count":             int(doc.get("row_count") or 0),
            "completed_at":          doc.get("completed_at"),
            "watermark_used":        doc.get("watermark_used"),
            "watermark_advanced_to": doc.get("watermark_advanced_to"),
            "run_id":                doc.get("run_id"),
        })
    return out


def _rollup_source(key: str, manifests: list[dict[str, Any]], sla_hours: int
                   ) -> dict[str, Any]:
    """Aggregate a source's manifests into one freshness/status row."""
    if not manifests:
        return {"source": key, "ingested": False, "last_ingest": None,
                "records_last_cycle": None, "lag_hours": None,
                "sla_hours": sla_hours, "status": "unknown",
                "changed_last_run": None, "run_id": None, "trend": []}

    # Latest ingest = max completed_at.
    def _ts(v: str | None) -> float:
        if not v:
            return 0.0
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
        except Exception:                                       # noqa: BLE001
            return 0.0

    latest = max(manifests, key=lambda m: _ts(m.get("completed_at")))
    last_ts = _ts(latest.get("completed_at"))
    lag_hours = round((time.time() - last_ts) / 3600.0, 1) if last_ts else None

    # Records in the most recent day partition; per-day trend (oldest→newest).
    by_day: dict[str, int] = {}
    changed_by_day: dict[str, bool] = {}
    for m in manifests:
        d = m.get("day")
        if not d:
            continue
        by_day[d] = by_day.get(d, 0) + (m.get("row_count") or 0)
        # "changed" = the ingestor advanced its watermark or wrote rows.
        adv = bool(m.get("watermark_advanced_to")
                   and m.get("watermark_advanced_to") != m.get("watermark_used"))
        changed_by_day[d] = changed_by_day.get(d, False) or adv or bool(m.get("row_count"))
    days_sorted = sorted(by_day)
    trend = [{"day": d, "rows": by_day[d]} for d in days_sorted][-12:]
    latest_day = days_sorted[-1] if days_sorted else None
    records_last_cycle = by_day.get(latest_day) if latest_day else None
    changed_last_run = changed_by_day.get(latest_day) if latest_day else None

    # Owner rule (2026-07-06): a source is only DOWN after ≥3 days of silence —
    # a few hours past SLA is "stale", never "down" (batch cadences + demo
    # clusters idle overnight). Sources with an even longer SLA window (MFR,
    # Climate) keep their larger 2×SLA down threshold.
    down_after = max(72.0, sla_hours * 2)
    if lag_hours is None:
        status = "unknown"
    elif lag_hours <= sla_hours:
        status = "live"
    elif lag_hours <= down_after:
        status = "stale"
    else:
        status = "down"

    return {"source": key, "ingested": True,
            "last_ingest": latest.get("completed_at"),
            "records_last_cycle": records_last_cycle,
            "lag_hours": lag_hours, "sla_hours": sla_hours,
            "status": status, "changed_last_run": changed_last_run,
            "run_id": latest.get("run_id"), "trend": trend}


@router.get("/summary")
async def summary(user: UserCtx = Depends(get_user)) -> dict[str, Any]:
    await _gate(user)
    rr = _load_run_results()
    results = rr.get("results") or []
    # dbt uses `success` for model runs, `pass`/`fail`/`warn`/`skip`/`error`
    # for tests. Bucket both into the same shape.
    pass_n = sum(1 for r in results
                  if r.get("status") in ("pass", "success"))
    fail_n = sum(1 for r in results if r.get("status") in ("fail", "error"))
    warn_n = sum(1 for r in results if r.get("status") == "warn")
    skip_n = sum(1 for r in results if r.get("status") == "skip")
    total_runtime = sum(float(r.get("execution_time") or 0) for r in results)
    return {
        "total":      len(results),
        "pass":       pass_n,
        "fail":       fail_n,
        "warn":       warn_n,
        "skip":       skip_n,
        "runtime_s":  round(total_runtime, 2),
        "generated_at": rr.get("generated_at") or rr.get("metadata", {}).get(
            "generated_at"),
    }


@router.get("/tests")
async def tests(user: UserCtx = Depends(get_user),
                status: str | None = Query(default=None,
                                            description="filter: pass|fail|warn|skip|error"),
                limit:  int = Query(default=200, ge=1, le=2000)
                ) -> list[dict[str, Any]]:
    await _gate(user)
    rr = _load_run_results()
    rows: list[dict[str, Any]] = []
    for r in rr.get("results") or []:
        if status and r.get("status") != status:
            continue
        rows.append({
            "unique_id":    r.get("unique_id"),
            "status":       r.get("status"),
            "execution_time": r.get("execution_time"),
            "failures":     r.get("failures"),
            "message":      r.get("message"),
            "compiled_at":  r.get("timing", [{}])[-1].get("started_at")
                              if r.get("timing") else None,
            "acked":        False,
            "acked_by":     None,
            "acked_at":     None,
        })
        if len(rows) >= limit:
            break

    # Annotate operator acknowledgements (ops_governance.dq_flag + dq_ack).
    acked = await _acked_dbt_tests({row["unique_id"] for row in rows})
    for row in rows:
        info = acked.get(row["unique_id"])
        if info:
            row["acked"]    = True
            row["acked_by"] = info.get("last_by")
            row["acked_at"] = info.get("last_at")
    return rows


@router.get("/models")
async def models(user: UserCtx = Depends(get_user)) -> list[dict[str, Any]]:
    """Per-model rollup. We pair each model with the dbt tests that
    reference it (extracted from manifest.json `depends_on.nodes`)."""
    await _gate(user)
    rr = _load_run_results()
    manifest = _load_manifest()
    nodes = manifest.get("nodes") or {}
    results_by_uid = {r["unique_id"]: r
                      for r in (rr.get("results") or []) if "unique_id" in r}

    out: list[dict[str, Any]] = []
    for uid, node in nodes.items():
        if not uid.startswith("model."):
            continue
        # Collect test-result statuses for this model.
        test_results: list[dict[str, Any]] = []
        for tuid, tnode in nodes.items():
            if not tuid.startswith("test."):
                continue
            if uid in (tnode.get("depends_on", {}).get("nodes") or []):
                tr = results_by_uid.get(tuid)
                if tr:
                    test_results.append({"test_id": tuid,
                                          "status": tr.get("status"),
                                          "execution_time": tr.get("execution_time")})
        run = results_by_uid.get(uid, {})
        out.append({
            "model_id":      uid,
            "name":          node.get("name"),
            "schema":        node.get("schema"),
            "materialized":  (node.get("config") or {}).get("materialized"),
            "run_status":    run.get("status") or "unrun",
            "run_time_s":    run.get("execution_time"),
            "tests_total":   len(test_results),
            "tests_failed":  sum(1 for t in test_results
                                  if t["status"] in ("fail", "error")),
            "tests":         test_results,
        })
    return out


@router.get("/lineage")
async def lineage(user: UserCtx = Depends(get_user)) -> dict[str, Any]:
    """Full lineage DAG: nodes (sources + models + tests) + edges. Each
    node carries its tier (source / staging / vault_raw / vault_business
    / mart) inferred from schema + dbt path, plus its latest test status.

    Frontend lineage widget consumes this to render the 4-column flow
    + test-status colored nodes.
    """
    await _gate(user)

    manifest = _load_manifest()
    rr = _load_run_results()
    if not manifest:
        return {"nodes": [], "edges": [], "as_of": None,
                "note": "dbt manifest not yet uploaded — run dbt-marts first"}

    results_by_uid = {r["unique_id"]: r
                      for r in (rr.get("results") or []) if "unique_id" in r}
    nodes_raw = manifest.get("nodes") or {}
    sources_raw = manifest.get("sources") or {}
    metadata = manifest.get("metadata") or {}

    def tier_of(node: dict[str, Any]) -> str:
        # Classify by schema first (most reliable in this pipeline).
        s = (node.get("schema") or "").lower()
        if s.startswith("nhdw_landing") or s.startswith("nhdw_staging"):
            return "staging"
        if s.startswith("nhdw_vault_raw"):
            return "vault_raw"
        if s.startswith("nhdw_vault_business"):
            return "vault_business"
        if s.startswith("bi_"):
            return "mart"
        # Fallback: dbt path.
        path = (node.get("original_file_path") or "").lower()
        if "raw_vault" in path:      return "vault_raw"
        if "business_vault" in path: return "vault_business"
        if "staging" in path:        return "staging"
        if "marts" in path:          return "mart"
        return "other"

    nodes_out: list[dict[str, Any]] = []
    # Sources (per dbt convention these are external systems we read from).
    for uid, src in sources_raw.items():
        nodes_out.append({
            "id":           uid,
            "name":         src.get("name") or uid.split(".")[-1],
            "tier":         "source",
            "schema":       src.get("schema"),
            "test_status":  None,
            "tests_total":  0,
            "tests_failed": 0,
            "materialized": "source",
        })
    # Models.
    for uid, node in nodes_raw.items():
        if not uid.startswith("model."):
            continue
        # Count tests targeting this model + roll up status.
        tests = [t_uid for t_uid, t_node in nodes_raw.items()
                 if t_uid.startswith("test.")
                 and uid in (t_node.get("depends_on", {}).get("nodes") or [])]
        statuses = [results_by_uid.get(t_uid, {}).get("status") for t_uid in tests]
        failed = sum(1 for s in statuses if s in ("fail", "error"))
        warn = sum(1 for s in statuses if s == "warn")
        if failed > 0:
            test_status = "fail"
        elif warn > 0:
            test_status = "warn"
        elif statuses:
            test_status = "pass"
        else:
            test_status = "untested"
        nodes_out.append({
            "id":           uid,
            "name":         node.get("name"),
            "tier":         tier_of(node),
            "schema":       node.get("schema"),
            "test_status":  test_status,
            "tests_total":  len(statuses),
            "tests_failed": failed,
            "materialized": (node.get("config") or {}).get("materialized"),
            "run_status":   results_by_uid.get(uid, {}).get("status", "unrun"),
            "description":  (node.get("description") or "")[:240],
        })

    # Edges: every model node's depends_on.nodes (excluding tests).
    edges: list[dict[str, str]] = []
    valid_ids = {n["id"] for n in nodes_out}
    for uid, node in nodes_raw.items():
        if not uid.startswith("model."):
            continue
        for upstream in (node.get("depends_on", {}).get("nodes") or []):
            if upstream in valid_ids:
                edges.append({"from": upstream, "to": uid})

    return {
        "nodes":       nodes_out,
        "edges":       edges,
        "as_of":       metadata.get("generated_at"),
        "tier_order":  ["source", "staging", "vault_raw", "vault_business", "mart"],
    }


# ═══════════════════════════════════════════════════════════════════════
# Source pulse — per-source completeness/validity from mart_data_quality.
# ═══════════════════════════════════════════════════════════════════════
@router.get("/sources")
async def sources(user: UserCtx = Depends(get_user)) -> dict[str, Any]:
    """Roll bi_quality.mart_data_quality up to one row per source. Powers
    the source-pulse strip. Degrades to an empty list with a note if the
    mart hasn't been (re)built yet."""
    await _gate(user)
    q = """
        SELECT source,
               max(period_id)                  AS latest_period,
               round(avg(completeness_pct), 1) AS completeness,
               round(avg(validity_pct), 1)     AS validity,
               round(avg(timeliness_pct), 1)   AS timeliness,
               sum(reports_received)           AS reports
        FROM marts.bi_quality.mart_data_quality
        GROUP BY source
        ORDER BY source
    """
    try:
        res = await trino_client.query(q)
        rows = [{**r, "source": _MART_SOURCE_ALIAS.get(r.get("source"),
                                                        r.get("source"))}
                for r in res["rows"]]
        return {"sources": rows, "note": None,
                "expected": [s["key"] for s in SOURCES]}
    except Exception as exc:                                    # noqa: BLE001
        return {"sources": [], "expected": [s["key"] for s in SOURCES],
                "note": f"mart_data_quality not yet queryable: {exc}"}


# ═══════════════════════════════════════════════════════════════════════
# Ingestion freshness — raw-lake _manifest.json sidecars (probe-lake).
# ═══════════════════════════════════════════════════════════════════════
@router.get("/ingestion")
async def ingestion(user: UserCtx = Depends(get_user)) -> dict[str, Any]:
    """Per-source freshness + ingestion status from nhdw-raw manifests:
    last successful ingest, records last cycle, lag vs SLA, which sources
    changed last run, and a short daily-volume trend."""
    await _gate(user)
    global _ingest_cache
    now = time.time()
    if _ingest_cache and now - _ingest_cache[0] < ARTIFACT_CACHE_TTL_S:
        return {"sources": _ingest_cache[1], "note": None}

    out: list[dict[str, Any]] = []
    note: str | None = None
    try:
        s3 = _s3()
        for src in SOURCES:
            manifests = _scan_source_manifests(s3, src["raw_prefix"])
            out.append(_rollup_source(src["key"], manifests, src["sla_hours"]))
        _ingest_cache = (now, out)
    except Exception as exc:                                    # noqa: BLE001
        note = f"raw-lake scan unavailable: {exc}"
    return {"sources": out, "note": note}


# ═══════════════════════════════════════════════════════════════════════
# DQ dimension scorecard.
# ═══════════════════════════════════════════════════════════════════════
@router.get("/dimensions")
async def dimensions(user: UserCtx = Depends(get_user)) -> dict[str, Any]:
    """Five-dimension rollup. completeness/validity/timeliness from
    mart_data_quality; consistency/uniqueness from dbt generic-test pass
    rates (relationship / unique test families)."""
    await _gate(user)
    dims: dict[str, float | None] = {"completeness": None, "validity": None,
                                     "timeliness": None, "consistency": None,
                                     "uniqueness": None}
    basis: dict[str, str] = {}

    try:
        res = await trino_client.query("""
            SELECT round(avg(completeness_pct), 1) AS c,
                   round(avg(validity_pct), 1)     AS v,
                   round(avg(timeliness_pct), 1)   AS t
            FROM marts.bi_quality.mart_data_quality
        """)
        if res["rows"]:
            r = res["rows"][0]
            dims["completeness"] = r.get("c")
            dims["validity"]     = r.get("v")
            dims["timeliness"]   = r.get("t")
            for k in ("completeness", "validity", "timeliness"):
                if dims[k] is not None:
                    basis[k] = "avg across mart_data_quality"
    except Exception as exc:                                    # noqa: BLE001
        basis["mart_error"] = str(exc)

    rr = _load_run_results()
    fam = {"unique": [0, 0], "relationship": [0, 0]}
    for r in rr.get("results") or []:
        uid = r.get("unique_id") or ""
        if not uid.startswith("test."):
            continue
        st = r.get("status")
        for name in ("unique", "relationship"):
            if name in uid:
                fam[name][1] += 1
                if st in ("pass", "success"):
                    fam[name][0] += 1
    if fam["unique"][1]:
        dims["uniqueness"] = round(100.0 * fam["unique"][0] / fam["unique"][1], 1)
        basis["uniqueness"] = f"{fam['unique'][0]}/{fam['unique'][1]} unique tests pass"
    if fam["relationship"][1]:
        dims["consistency"] = round(100.0 * fam["relationship"][0] / fam["relationship"][1], 1)
        basis["consistency"] = f"{fam['relationship'][0]}/{fam['relationship'][1]} relationship tests pass"
    return {"dimensions": dims, "basis": basis}


# ═══════════════════════════════════════════════════════════════════════
# Cross-source reconciliation — real master-data agreement (business vault).
# ═══════════════════════════════════════════════════════════════════════
@router.get("/reconciliation")
async def reconciliation(user: UserCtx = Depends(get_user)) -> dict[str, Any]:
    """Real cross-source agreement from the business-vault same-as links:
    what share of conformed facilities / commodities are recognised by ≥2
    source systems. No mock rows — a check is omitted if its link/view pair
    can't be reached.

    source_system lives on the resolution VIEW (v_facility_resolution /
    v_commodity_resolution), never on the keys-only link (per DV2.0). We join
    the link to its resolution view on the same-as PK `hk_same_as_*` — NOT on
    the source-hub FK `hk_source_*`: the source hubs hash unqualified integer
    BKs whose spaces overlap (HCMIS vs mBrana → 891 identical hk_source_facility
    / 34 identical hk_source_commodity live), so joining on that FK would fan a
    single edge across colliding systems. The same-as PK embeds source_system,
    so it maps each edge to exactly one system. We then fold the fine-grained
    record channels (MFR.location/organization, mBrana.dbo/ussd) up to their
    parent SYSTEM with split_part(source_system,'.',1) so "≥2 sources" means
    ≥2 real source systems, not ≥2 channels of one system."""
    await _gate(user)
    checks: list[dict[str, Any]] = []
    note: str | None = None

    def _clean(s: str | None) -> str:
        return (s or "").lstrip("!")

    for label, link_tbl, conformed_col, resview, same_as_pk, systems in (
        ("Facility master", "lnk_same_as_facility", "hk_facility_conformed",
         "v_facility_resolution", "hk_same_as_facility",
         "DHIS2 · HCMIS · MFR · mBrana"),
        ("Commodity master", "lnk_same_as_commodity", "hk_commodity_conformed",
         "v_commodity_resolution", "hk_same_as_commodity",
         "HCMIS · mBrana"),
    ):
        try:
            per = await trino_client.query(f"""
                SELECT split_part(rv.source_system, '.', 1) AS source_system,
                       count(distinct l.{conformed_col})    AS n
                FROM marts.nhdw_vault_business.{link_tbl} l
                JOIN marts.nhdw_vault_business.{resview}  rv
                  ON l.{same_as_pk} = rv.{same_as_pk}
                GROUP BY split_part(rv.source_system, '.', 1)
                ORDER BY 1
            """)
            agg = await trino_client.query(f"""
                SELECT count(*) AS total, count_if(n_src >= 2) AS matched
                FROM (
                    SELECT l.{conformed_col} AS k,
                           count(distinct split_part(rv.source_system, '.', 1))
                                                            AS n_src
                    FROM marts.nhdw_vault_business.{link_tbl} l
                    JOIN marts.nhdw_vault_business.{resview}  rv
                      ON l.{same_as_pk} = rv.{same_as_pk}
                    GROUP BY l.{conformed_col}
                ) t
            """)
            total   = (agg["rows"][0]["total"]   if agg["rows"] else 0) or 0
            matched = (agg["rows"][0]["matched"] if agg["rows"] else 0) or 0
            pct = round(100.0 * matched / total, 1) if total else None
            checks.append({
                "check":       label,
                "systems":     systems,
                "conformed":   total,
                "matched":     matched,
                "agreement_pct": pct,
                "sources":     [{"source": _clean(r["source_system"]),
                                 "count": r["n"]} for r in per["rows"]],
            })
        except Exception as exc:                                # noqa: BLE001
            note = ("business-vault same-as links not reachable via Trino "
                    f"(check bi_reader SELECT grant on nhdw_vault_business): {exc}")
    return {"checks": checks, "note": note}


# ═══════════════════════════════════════════════════════════════════════
# k-anonymity compliance — bi_public marts.
# ═══════════════════════════════════════════════════════════════════════
@router.get("/compliance")
async def compliance(user: UserCtx = Depends(get_user)) -> dict[str, Any]:
    """Is every bi_public mart k≥5? Reads the singular `k_anonymity_public
    _marts` dbt test result (fails = a group with n<5 got published)."""
    await _gate(user)
    rr = _load_run_results()
    manifest = _load_manifest()
    kanon: dict[str, Any] | None = None
    for r in rr.get("results") or []:
        uid = r.get("unique_id") or ""
        if "k_anonymity" in uid:
            kanon = {"test_id": uid, "status": r.get("status"),
                     "failures": r.get("failures")}
            break
    public_marts = [node.get("name")
                    for uid, node in (manifest.get("nodes") or {}).items()
                    if uid.startswith("model.")
                    and (node.get("schema") or "") == "bi_public"]
    return {"k_anon": {
        "present":           kanon is not None,
        "passed":            bool(kanon and kanon["status"] in ("pass", "success")),
        "status":            kanon["status"] if kanon else None,
        "failures":          kanon["failures"] if kanon else None,
        "public_mart_count": len(public_marts),
        "public_marts":      sorted(m for m in public_marts if m),
    }}


# ═══════════════════════════════════════════════════════════════════════
# Acknowledge a failing / warning dbt test → ops_governance.dq_flag + dq_ack.
# ═══════════════════════════════════════════════════════════════════════
class AckBody(BaseModel):
    unique_id: str = Field(..., min_length=1)
    model:    str | None = None
    test:     str | None = None
    message:  str | None = None
    severity: str | None = None
    note:     str | None = None


_SEV_MAP = {"fail": "error", "error": "error", "warn": "warn"}


async def _acked_dbt_tests(unique_ids: set[str]) -> dict[str, dict[str, Any]]:
    """Which of these dbt test unique_ids already carry an operator ack."""
    if not unique_ids:
        return {}
    try:
        pool = await ops_db.ensure_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT f.key->>'unique_id'                          AS uid,
                       count(a.*)                                   AS n,
                       max(a.acked_at)                              AS last_at,
                       (array_agg(COALESCE(u.username, a.acker::text)
                                  ORDER BY a.acked_at DESC))[1]     AS last_by
                FROM ops_governance.dq_flag f
                JOIN ops_governance.dq_ack  a ON a.flag_id = f.id
                LEFT JOIN ops_identity."user" u ON u.kc_sub = a.acker
                WHERE f.error_class = 'dbt_test'
                  AND f.key->>'unique_id' = ANY($1::text[])
                GROUP BY f.key->>'unique_id'
            """, list(unique_ids))
        return {r["uid"]: {
                    "count":   r["n"],
                    "last_at": r["last_at"].isoformat() if r["last_at"] else None,
                    "last_by": r["last_by"],
                } for r in rows}
    except Exception as exc:                                    # noqa: BLE001
        log.warning("dq ack lookup failed: %s", exc)
        return {}


@router.post("/ack")
async def ack(body: AckBody, user: UserCtx = Depends(get_user)) -> dict[str, Any]:
    """Record an operator acknowledgement of a dbt test. Find-or-create the
    governance flag for the test, then append an ack by the calling user."""
    await _gate(user, action="admin.dq.ack", resource="dq")
    if not user.kc_sub:
        raise HTTPException(400, "ack requires an identified user")
    # dq_ack.acker FKs ops_identity.user — make sure the caller's row exists.
    await ops_db.upsert_user(user)

    sev  = _SEV_MAP.get((body.severity or "").lower(), "warn")
    model = body.model or "dbt"
    desc = (body.message or f"{body.test or body.unique_id} acknowledged").strip()[:500]

    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            flag_id = await conn.fetchval("""
                SELECT id FROM ops_governance.dq_flag
                WHERE error_class = 'dbt_test'
                  AND key->>'unique_id' = $1
                LIMIT 1
            """, body.unique_id)
            if flag_id is None:
                flag_id = await conn.fetchval("""
                    INSERT INTO ops_governance.dq_flag
                        (raised_by, source, table_name, key, error_class,
                         severity, description, status)
                    VALUES ('system', 'dbt', $1, $2::jsonb, 'dbt_test',
                            $3, $4, 'acked')
                    RETURNING id
                """, model, json.dumps({"unique_id": body.unique_id}), sev, desc)
            else:
                await conn.execute(
                    "UPDATE ops_governance.dq_flag SET status = 'acked' WHERE id = $1",
                    flag_id)
            acked_at = await conn.fetchval("""
                INSERT INTO ops_governance.dq_ack (flag_id, acker, note)
                VALUES ($1, $2::uuid, $3)
                RETURNING acked_at
            """, flag_id, user.kc_sub, body.note)

    await ops_db.log_data_event(user=user, kind="dq.test.ack",
                                payload={"unique_id": body.unique_id,
                                         "flag_id": str(flag_id),
                                         "model": model, "severity": sev})
    return {"ok": True, "flag_id": str(flag_id), "acked_by": user.username,
            "acked_at": acked_at.isoformat() if acked_at else None}
