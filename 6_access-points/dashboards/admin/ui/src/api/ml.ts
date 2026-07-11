/**
 * Thin fetch wrappers for /gw/ml/* — admin's surface onto the MLflow
 * alias-based registry + the ephemeral runner Jobs (train / promote),
 * plus the fleet-monitoring feed (drift / performance) that backs the
 * Model Monitoring page. Same auth pattern as permAdmin.ts.
 */
import { authFetch } from './useAuth';

const GW = '/gw/ml';

/** Error carrying the HTTP status so pages can render a 404 (endpoint not
 *  deployed yet / nothing recorded) differently from a real failure. */
export class MlHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function _json<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await authFetch(`${GW}${path}`, init);
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new MlHttpError(r.status, `${r.status} ${r.statusText}: ${body}`);
  }
  return r.json();
}

export type ModelInfo = {
  name: string;
  latest_version: string | null;
  champion_version: string | null;          // version @champion points at
  aliases: Record<string, string>;          // alias → version
  deployment_kind: string;                  // batch | on_demand
  schedule: string | null;                  // cron (informational)
  enabled: boolean | null;
  last_updated: number | null;
};

export type ModelVersion = {
  version: string;
  aliases: string[];                        // e.g. ['champion']
  creation_timestamp: number | null;
  last_updated_timestamp: number | null;
  run_id: string | null;
  source: string | null;
  description: string | null;
};

export type ModelRun = {
  id: string;
  model_version: string;
  deployment_kind: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'failed';
  row_count: number | null;
  latency_ms: number | null;
  trigger_kind: 'schedule' | 'manual' | 'api';
  error_msg: string | null;
};

export const listModels   = () => _json<{ models: ModelInfo[]; count: number }>('');
export const listVersions = (model: string) =>
    _json<{ model: string; versions: ModelVersion[] }>(`/${model}/versions`);
export const listRuns     = (model: string, limit = 10) =>
    _json<{ model: string; runs: ModelRun[] }>(`/${model}/runs?limit=${limit}`);
export const promote      = (model: string, version: string, alias = 'champion') =>
    _json<{ model: string; version: string; alias: string }>(
        `/${model}/promote?version=${version}&alias=${alias}`, { method: 'POST' });
export const retrain      = (model: string) =>
    _json<{ model: string; job_name: string; namespace: string;
            package_ref: string; poll: string }>(
        `/${model}/retrain`, { method: 'POST' });

/* ── fleet monitoring (Model Monitoring page) ─────────────────────────
 * Contract for GET /gw/ml/monitoring/fleet + the per-model drilldowns.
 * The gateway endpoint ships separately; a 404 means the gateway hasn't
 * been rebuilt with it yet — callers render an honest empty/error state,
 * never fabricated numbers. */

export type FleetItem = {
  model_name: string;
  alias: string | null;                     // e.g. 'champion' | 'challenger'
  latest_run_at: string | null;
  latest_run_status: string | null;         // running | success | failed
  drifted_features: number | null;
  features_checked: number | null;
  max_psi: number | null;
  latest_metric: string | null;             // e.g. 'auroc'
  latest_metric_value: number | null;
  perf_computed_at: string | null;
  stale: boolean;
};

export type DriftRow = {
  feature: string;
  kind: string;                             // e.g. numeric | categorical
  psi: number | null;
  ks: number | null;
  psi_threshold: number | null;
  drifted: boolean;
  computed_at: string | null;
  note: string | null;
};

export type PerfRow = {
  model_version: string | null;
  window_start: string | null;
  window_end: string | null;
  metric: string;
  value: number | null;
  sample_size: number | null;
  computed_at: string | null;
};

export const getFleet = () =>
    _json<{ items: FleetItem[] }>('/monitoring/fleet');
export const getDrift = (model: string, limit = 200) =>
    _json<{ items: DriftRow[] }>(
        `/${encodeURIComponent(model)}/drift?limit=${limit}`);
export const getPerformance = (model: string, limit = 200) =>
    _json<{ items: PerfRow[] }>(
        `/${encodeURIComponent(model)}/performance?limit=${limit}`);
