/**
 * Project-centric graduation (public-review) API client — backs the ADMIN
 * reviewer console (widgets/adm-models-datasets/Review.tsx).
 *
 * The unit of review is the **PROJECT** (tasks #42/#43). An owner submits a
 * project to become public; a reviewer opens it, (optionally) spawns a lab to
 * run its notebooks, then **approves** (→ the project becomes public) or
 * **rejects / requests changes**. The old artifact-centric endpoints
 * (`/queue`, `/{id}`, `/{id}/promote`, `/{id}/reject`) are RETIRED and now 404.
 *
 * Backend lives at /api/graduation in the gateway; admin's /gw/{path} proxy
 * forwards to nhdw-gateway/api/{path}, so client paths begin /gw/graduation.
 * These routes are reviewer-gated server-side (403 for non-reviewer roles); the
 * console keeps a defence-in-depth 403 panel. Structured values (byte counts,
 * timestamps) come back RAW and are formatted CLIENT-SIDE — never pre-humanized.
 *
 * Per the repo's no-shared-modules rule this is a copy, not an import.
 */
import { authFetch } from './useAuth';

const GW = '/gw/graduation';

export type ReviewStatus =
  | 'draft' | 'in_review' | 'changes_requested' | 'approved' | 'rejected' | string;

/** One essential-files checklist item — the SAME shape the submit / queue /
 *  detail responses all carry. `required` encodes "retrain script is required
 *  only if a model artifact is present". */
export type ChecklistItem = {
  requirement: string;
  present: boolean;
  matched: string[];
  required: boolean;
};

/** One row of GET /gw/graduation/project-queue. */
export type ProjectQueueItem = {
  id: string;
  slug: string;
  name: string;
  visibility: string;
  review_status: ReviewStatus;
  owner_kc_sub: string;
  owner_username: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  review_checklist: ChecklistItem[] | null;
  all_essentials_present: boolean;
};

/** The project block of the detail envelope (core columns always present;
 *  the gateway may fold in extra fields, kept optional and never fabricated). */
export type ReviewProject = {
  id: string;
  slug: string;
  name: string;
  visibility: string;
  review_status: ReviewStatus;
  owner_kc_sub: string;
  owner_username?: string | null;
  description?: string | null;
  submitted_at?: string | null;
  submitted_by?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  review_checklist?: ChecklistItem[] | null;
  created_at?: string;
  updated_at?: string;
  [k: string]: unknown;
};

/** One object under projects/<id>/files/, as listed by the gateway. */
export type ProjectFile = {
  name: string;
  size: number;
  last_modified: string;
};

/** One verdict from the project's review trail. */
export type ProjectReviewVerdict = {
  id?: string;
  reviewer?: string;
  reviewer_username?: string | null;
  verdict: string;                 // approved | changes_requested | rejected
  comment?: string | null;
  note?: string | null;
  reviewed_at?: string | null;
  [k: string]: unknown;
};

/** GET /gw/graduation/project/{id} — the full review bundle. */
export type ProjectReviewDetail = {
  project: ReviewProject;
  checklist: ChecklistItem[];
  all_essentials_present: boolean;
  files: ProjectFile[];
  file_count: number;
  reviews: ProjectReviewVerdict[];
};

/** POST …/approve result. `integration` is the #45 hook — currently a no-op
 *  ({integrated:false}); approval never fails on it, so surface it as info. */
export type ApproveResult = {
  project_id: string;
  review_status: 'approved' | string;
  visibility: string;
  integration?: { integrated: boolean; reason?: string } | null;
};

export type RejectResult = {
  project_id: string;
  review_status: 'changes_requested' | 'rejected' | string;
};

/** POST /gw/workspace/spawn — the reviewer's lab-on-a-submitted-project (#42). */
export type SpawnResult = {
  status?: string;
  url?: string | null;
  [k: string]: unknown;
};

/** Error carrying the HTTP status so callers can render 401/403/404 honestly. */
export class GraduationHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function _json<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const r = await authFetch(input, init);
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new GraduationHttpError(r.status, `${r.status} ${r.statusText}: ${body}`);
  }
  return r.json();
}

/** Accept `{ queue: [...] }`, `{ items: [...] }`, or a bare array. */
function unwrapQueue(j: unknown): ProjectQueueItem[] {
  if (Array.isArray(j)) return j as ProjectQueueItem[];
  if (j && typeof j === 'object') {
    const o = j as Record<string, unknown>;
    if (Array.isArray(o.queue)) return o.queue as ProjectQueueItem[];
    if (Array.isArray(o.items)) return o.items as ProjectQueueItem[];
  }
  return [];
}

/** GET /gw/graduation/project-queue — projects awaiting review (reviewer-only). */
export async function listProjectQueue(): Promise<ProjectQueueItem[]> {
  return unwrapQueue(await _json(`${GW}/project-queue`));
}

/** GET /gw/graduation/project/{id} — full review bundle for one project. */
export function getProjectDetail(id: string): Promise<ProjectReviewDetail> {
  return _json<ProjectReviewDetail>(`${GW}/project/${encodeURIComponent(id)}`);
}

/** POST /gw/graduation/project/{id}/approve — Approve → project becomes public. */
export function approveProject(
  id: string, body: { comment?: string } = {},
): Promise<ApproveResult> {
  return _json<ApproveResult>(`${GW}/project/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** POST /gw/graduation/project/{id}/reject — Reject or request changes.
 *  `changes_requested:true` bounces it back (owner may re-submit); false rejects. */
export function rejectProject(
  id: string, body: { note?: string; changes_requested?: boolean },
): Promise<RejectResult> {
  return _json<RejectResult>(`${GW}/project/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** POST /gw/workspace/spawn — a reviewer opens a lab on a SUBMITTED project to
 *  run its notebooks (#42). Returns the lab url (or a spawning status). */
export function spawnReviewerLab(
  projectId: string, profile = 'Small',
): Promise<SpawnResult> {
  return _json<SpawnResult>(`/gw/workspace/spawn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, profile }),
  });
}

/* ── presentation helpers (real vocabulary only) ───────────────────── */

export function reviewStatusLabel(s: string): string {
  return ({
    draft: 'draft', in_review: 'in review',
    changes_requested: 'changes requested',
    approved: 'approved', rejected: 'rejected',
  } as Record<string, string>)[s] || s;
}
export function reviewStatusPillClass(s: string): string {
  return s === 'approved' ? 'good'
       : s === 'in_review' ? 'info'
       : s === 'changes_requested' ? 'watch'
       : s === 'rejected' ? 'alert'
       : 'neutral';
}

/* ── client-side formatting from structured gateway values ─────────── */

export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n; let i = -1;
  do { v /= 1024; i += 1; } while (v >= 1024 && i < units.length - 1);
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined,
    { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined,
    { year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit' });
}
