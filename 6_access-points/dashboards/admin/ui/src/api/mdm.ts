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
