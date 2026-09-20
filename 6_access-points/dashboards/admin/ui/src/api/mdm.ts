/**
 * Thin fetch wrappers for /gw/mdm/* — the MDM stewardship surface
 * (candidate queue, verdicts, the bitemporal decision log) served by
 * nhdw-gateway's /api/mdm/* routes. Same auth pattern as dq.ts.
 */
import { authFetch } from './useAuth';

const GW = '/gw/mdm';

export type Candidate = {
  candidate_id: string;
  deployment_context: string;
  entity_class_code: string;
  left_source_system_code: string;
  left_source_record_key: string;
  right_source_system_code: string;
  right_source_record_key: string;
  suggested_master_bk: string | null;
  score: number;
  match_rule: string;
  match_features: Record<string, unknown>;
  status: string;
  discovered_at: string;
};

export type RuleCount = { match_rule: string; status: string; n: number };

export type Decision = {
  decision_id: string;
  deployment_context: string;
  entity_class_code: string;
  source_system_code: string;
  source_record_key: string;
  decision: string;
  master_bk: string | null;
  candidate_id: string | null;
  score: number | null;
  decided_by: string;
  note: string | null;
  valid_from: string;
  valid_to: string;
  recorded_from: string;
  recorded_to: string | null;
  current: boolean;
};

async function _json<T>(path: string): Promise<T> {
  const r = await authFetch(`${GW}/${path}`);
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`${r.status} ${r.statusText}: ${body}`);
  }
  return r.json();
}

async function _post<T>(path: string, payload: unknown): Promise<T> {
  const r = await authFetch(`${GW}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`${r.status} ${r.statusText}: ${body}`);
  }
  return r.json();
}

export function queue(status = 'pending', rule?: string, limit = 500,
                      entityClass = 'facility'):
    Promise<{ candidates: Candidate[]; counts: RuleCount[] }> {
  const q = new URLSearchParams({ status, limit: String(limit), entity_class: entityClass });
  if (rule) q.set('match_rule', rule);
  return _json(`queue?${q}`);
}

export function decide(candidateId: string, decision: 'accept' | 'reject', note?: string):
    Promise<{ candidate_id: string; decision: string; decision_id: string }> {
  return _post(`candidate/${candidateId}/decide`, { decision, note: note ?? null });
}

export function decisions(currentOnly = true, limit = 200):
    Promise<{ decisions: Decision[] }> {
  return _json(`decisions?current_only=${currentOnly}&limit=${limit}`);
}

export function revert(decisionId: string, note?: string):
    Promise<{ decision_id: string; superseded: boolean }> {
  return _post(`decision/${decisionId}/revert`, { note: note ?? null });
}

export type MasterDetail = {
  master_bk: string;
  entity_class: string;
  members: Array<{ source_system: string; source_name: string; match_strategy: string; source_record_key: string }>;
  n_source_systems: number;
  golden: Record<string, unknown> | null;
  identifiers: Array<{ identifier_namespace: string; identifier_value: string }>;
  decisions: Array<{ source_system_code: string; decision: string; decided_by: string; recorded_from: string }>;
};

export function master(entityClass: string, masterBk: string): Promise<MasterDetail> {
  return _json(`master/${encodeURIComponent(entityClass)}/${encodeURIComponent(masterBk)}`);
}

export type Release = {
  release_id: string;
  status: string;
  entity_class_code: string;
  deployment_context: string;
  decisions_as_of: string;
  source_watermark: string;
  note: string | null;
  created_by: string;
  created_at: string;
  published_at: string | null;
  superseded_by: string | null;
  stats: Record<string, number>;
};

export function releases(entityClass = 'facility'): Promise<{ releases: Release[] }> {
  return _json(`releases?entity_class=${encodeURIComponent(entityClass)}`);
}

export async function publishRelease(releaseId: string, note?: string, entityClass = 'facility'):
    Promise<{ release_id: string; stats: Record<string, number>; reproduce_with: string }> {
  const r = await authFetch(`${GW}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ release_id: releaseId, note: note ?? null, entity_class: entityClass }),
  });
  if (!r.ok) {
    const b = await r.text().catch(() => '');
    throw new Error(`${r.status} ${r.statusText}: ${b}`);
  }
  return r.json();
}
