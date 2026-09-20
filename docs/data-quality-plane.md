# The data-quality plane — detector, thresholds, governance record

Batch 2 of the data-layer enhancement (Track B). The platform stops merely
*measuring* quality and starts **raising and remembering** it: incidents are
detected from signals the pipeline already produces, deduped, kept forever,
and distilled into governance KPIs. In-app only — no email path exists here.

## What runs

| Piece | Where | Notes |
|---|---|---|
| Threshold store | `ops_governance.dq_threshold` (`3_storage/postgres/init/38_governance.sql`) | single home for SLA hours + UI bands; CHECK-guarded; seed reconciles via `managed_by='seed'`; consumers fall back to coded defaults |
| Incident record | `ops_governance.dq_flag` (+`fingerprint`, `updated_at`, `resolved_at`) and append-only `dq_flag_event` | one OPEN flag per finding; every transition appended; touch triggers keep `updated_at` honest |
| Detector | `POST /api/dq/detect` (`6_access-points/api/nhdw-gateway/app/routes/dq.py`) | service token (`dq-detect-secrets`) or admin bearer; audit-logged; classes: `dbt_test` (fk_orphan/not_null in `key->>'test_class'`), `stale_ingest`, `volume_outlier`, `mdm_backlog` |
| Queue + KPIs | `GET /api/dq/flags` (paged) · `GET /api/dq/kpi` | the Admin DQ page's incidents section reads these |
| Schedule | `5_orchestrator/dags/dq_detection.py` | daily 06:15, `max_active_runs=1`, retries 1; only calls the endpoint |
| Deadlines | `reporting_deadlines` seed → `bi_quality` | joined into `mart_data_quality` (cadence/offset/grace); `timeliness_pct` stays NULL — no per-report arrival signal in the current loads |
| Boot & regression | bootstrap step 7.85 (non-fatal first detection) · `verify-system.sh` §6e · `seed-app-security.sh` heal loop applies 38 on warm clusters | cold boots show real findings; a missing table or DAG fails the gate |

## Governance KPIs (`GET /api/dq/kpi`) — definitions

- **open_by** — open incidents grouped by class × severity × source.
- **raised_weekly** — first-raise events per ISO week, from `dq_flag_event`.
- **avg_hours_to_ack** — mean hours from raise to the first operator ack (`dq_ack`); null until an ack exists.
- **avg_hours_to_resolve** — mean hours from raise to `resolved_at`; null until something is resolved.
- **reopened_fingerprints** — findings that came back after being resolved (recurrence).
- **steward** — undecided MDM match candidates + decisions made (read-only over the stewardship stores).

Nulls render as "—", never as zero: an unmeasured latency is not a fast one.

## Semantics worth knowing

- Re-running the detector is always safe: unchanged findings update the open
  flag (description/severity/updated_at) and add **no** history rows.
- `wontfix` silences a finding permanently (it keeps absorbing upserts);
  `resolved` lets it come back as a new incident. Choose accordingly.
- A threshold edit changes what counts as an incident from then on;
  `managed_by='runtime'` rows survive re-seeds.
