/**
 * Audit logs page. Server-side paginated view of the gateway's own access log:
 * GET /gw/audit/events → ops_audit.gateway_log (newest-first by default), joined
 * to ops_identity."user" so the actor shows a real name.
 *
 * Everything is done on the server, one page at a time — the whole log is never
 * loaded into the browser:
 *   · pagination (page / page_size), fixed-height scroll body with a sticky head
 *   · filters: free-text search, decision, HTTP method, status class, date range
 *   · sortable columns (time / decision / method / path / actor / status / latency)
 *   · KPI tiles computed by the query over the WHOLE filtered set (not the page)
 * Click any row to open a detail modal with every captured field (client IP,
 * user-agent, jwt id, byte count, mart scope, request filters, obligations…).
 * No figure on this page is hardcoded. The first page auto-refreshes every 30s.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  fetchAuditEvents, AuditEvent, AuditPage, AuditStats,
} from '../../api/audit';

const PAGE_SIZES = [25, 50, 100, 200];

const DECISION_PILL: Record<AuditEvent['policy_decision'], string> = {
  allow: 'good',
  deny:  'alert',
  error: 'watch',
};

type SortKey = 'ts' | 'decision' | 'method' | 'path' | 'actor' | 'http_status' | 'latency_ms';

const COLUMNS: { key: SortKey; label: string; align?: 'num' }[] = [
  { key: 'ts',          label: 'Time' },
  { key: 'decision',    label: 'Decision' },
  { key: 'method',      label: 'Method' },
  { key: 'path',        label: 'Path' },
  { key: 'actor',       label: 'Actor' },
  { key: 'http_status', label: 'Status', align: 'num' },
  { key: 'latency_ms',  label: 'Latency', align: 'num' },
];

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—'
    : d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function fmtFull(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}
function shortSub(sub: string): string {
  return sub.length > 10 ? `${sub.slice(0, 8)}…` : sub;
}
function actorLabel(r: AuditEvent): string {
  return r.full_name || r.username || (r.kc_sub ? shortSub(r.kc_sub) : 'anonymous');
}
function fmtSpan(ms: number): string {
  if (ms <= 0) return 'a single instant';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), rem = m % 60;
  if (h < 24) return rem ? `${h}h ${rem}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
function fmtBytes(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
function codeClass(code: number | null): string {
  if (code == null) return '';
  return `c${Math.floor(code / 100)}`;
}

// ───────────────────────── Detail modal ─────────────────────────
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (<><dt>{label}</dt><dd>{children}</dd></>);
}

function AuditDetail({ ev, onClose }: { ev: AuditEvent; onClose: () => void }) {
  const hasFilters = ev.filters && Object.keys(ev.filters).length > 0;
  const hasObl = ev.policy_obligations && Object.keys(ev.policy_obligations).length > 0;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
        <div className="modal-hdr">
          <h2>Audit event #{ev.id}</h2>
          <p>{ev.method} {ev.path}</p>
        </div>
        <div className="modal-body" style={{ maxHeight: '70vh', overflow: 'auto' }}>
          <dl className="kv-grid">
            <Row label="Timestamp"><span className="mono">{fmtFull(ev.ts)}</span></Row>
            <Row label="Decision">
              <span className={`pill pill-xs ${DECISION_PILL[ev.policy_decision]}`}>{ev.policy_decision}</span>
              {ev.denied_reason ? <span className="text-xs muted"> · {ev.denied_reason}</span> : null}
            </Row>
            <Row label="HTTP status">
              {ev.http_status != null
                ? <span className={`code-chip ${codeClass(ev.http_status)}`}>{ev.http_status}</span>
                : '—'}
            </Row>
            <Row label="Latency"><span className="mono">{ev.latency_ms != null ? `${ev.latency_ms} ms` : '—'}</span></Row>

            <div className="kv-sep" />
            <Row label="Actor">{actorLabel(ev)}</Row>
            <Row label="Username"><span className="mono">{ev.username ?? '—'}</span></Row>
            <Row label="Email"><span className="mono">{ev.email ?? '—'}</span></Row>
            <Row label="Role · realm">
              {ev.role_label ?? '—'}{ev.realm ? <span className="text-xs muted"> · {ev.realm}</span> : null}
            </Row>
            <Row label="kc_sub"><span className="mono">{ev.kc_sub ?? 'unauthenticated'}</span></Row>
            <Row label="JWT id"><span className="mono">{ev.jwt_jti ?? '—'}</span></Row>

            <div className="kv-sep" />
            <Row label="Request"><span className="mono">{ev.method} {ev.path}</span></Row>
            <Row label="Mart scope">{ev.mart_scope.length ? ev.mart_scope.join(', ') : '—'}</Row>
            <Row label="Rows returned"><span className="mono">{ev.row_count != null ? ev.row_count.toLocaleString() : '—'}</span></Row>
            <Row label="Bytes"><span className="mono">{fmtBytes(ev.byte_count)}</span></Row>

            <div className="kv-sep" />
            <Row label="Client IP"><span className="mono">{ev.client_ip ?? '—'}</span></Row>
            <Row label="User-agent"><span className="mono" style={{ fontSize: '0.74rem' }}>{ev.user_agent ?? '—'}</span></Row>

            {hasFilters && (<>
              <div className="kv-sep" />
              <dt>Request filters</dt><dd className="mono text-xs">jsonb</dd>
              <pre className="audit-json">{JSON.stringify(ev.filters, null, 2)}</pre>
            </>)}
            {hasObl && (<>
              <dt>Policy obligations</dt><dd className="mono text-xs">jsonb</dd>
              <pre className="audit-json">{JSON.stringify(ev.policy_obligations, null, 2)}</pre>
            </>)}
          </dl>
        </div>
        <div className="modal-foot">
          <button className="btn btn-primary btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── KPI tiles ─────────────────────────
function Kpis({ stats, loading }: { stats: AuditStats | null; loading: boolean }) {
  const s = stats;
  const httpErrors = (s?.http4xx ?? 0) + (s?.http5xx ?? 0);
  const span = s && s.min_ts && s.max_ts
    ? new Date(s.max_ts).getTime() - new Date(s.min_ts).getTime() : 0;
  const dash = (v: number | null | undefined) => (loading && s == null ? '—' : (v ?? 0).toLocaleString());
  return (
    <div className="grid grid-4">
      <div className="ops-kpi info">
        <div className="lbl">Events matched</div>
        <div className="v">{dash(s?.total)}</div>
        <div className="sub">{s == null ? 'loading…' : s.total ? `over ${fmtSpan(span)}` : 'no events'}</div>
      </div>
      <div className="ops-kpi warn">
        <div className="lbl">Policy denials</div>
        <div className="v">{dash(s?.deny)}</div>
        <div className="sub">{s?.error ? `+${s.error} policy errors` : 'policy_decision = deny'}</div>
      </div>
      <div className="ops-kpi alert">
        <div className="lbl">HTTP errors</div>
        <div className="v">{loading && s == null ? '—' : httpErrors.toLocaleString()}</div>
        <div className="sub">{s?.auth_denied ?? 0} auth-denied (401/403) · {s?.http5xx ?? 0} server (5xx)</div>
      </div>
      <div className="ops-kpi good">
        <div className="lbl">Avg latency</div>
        <div className="v">{s?.avg_lat == null ? '—' : `${s.avg_lat} ms`}</div>
        <div className="sub">{s?.max_lat == null ? 'no timing recorded' : `peak ${s.max_lat} ms`}</div>
      </div>
    </div>
  );
}

// ───────────────────────── Page ─────────────────────────
function Audit() {
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ]               = useState('');            // debounced
  const [decision, setDecision] = useState<'' | AuditEvent['policy_decision']>('');
  const [method, setMethod]     = useState('');
  const [statusClass, setStatusClass] = useState<'' | '2xx' | '3xx' | '4xx' | '5xx'>('');
  const [since, setSince]       = useState('');            // YYYY-MM-DD
  const [until, setUntil]       = useState('');
  const [sort, setSort]         = useState<SortKey>('ts');
  const [dir, setDir]           = useState<'asc' | 'desc'>('desc');

  const [data, setData] = useState<AuditPage | null>(null);
  const [err, setErr]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const reqId = useRef(0);

  // Debounce the free-text box; typing resets to page 1.
  useEffect(() => {
    const t = setTimeout(() => { setQ(searchInput.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    const mine = ++reqId.current;
    setLoading(true);
    try {
      const res = await fetchAuditEvents({
        page, pageSize, q, decision, method, statusClass,
        since: since ? `${since}T00:00:00` : '',
        until: until ? `${until}T23:59:59` : '',
        sort, dir,
      });
      if (mine !== reqId.current) return;   // a newer request already returned
      setData(res); setErr(null);
    } catch (e: any) {
      if (mine === reqId.current) setErr(e?.message || String(e));
    } finally {
      if (mine === reqId.current) setLoading(false);
    }
  }, [page, pageSize, q, decision, method, statusClass, since, until, sort, dir]);

  useEffect(() => { load(); }, [load]);

  // Live-tail: only auto-refresh when the operator is on the newest page with
  // the default newest-first sort — never yank a page they're studying.
  const isLiveTail = page === 1 && sort === 'ts' && dir === 'desc';
  useEffect(() => {
    if (!isLiveTail) return;
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [isLiveTail, load]);

  const onSort = (key: SortKey) => {
    if (key === sort) setDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSort(key); setDir(key === 'ts' || key === 'latency_ms' ? 'desc' : 'asc'); }
    setPage(1);
  };

  const resetFilter = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(1); };

  const anyFilter = !!(q || decision || method || statusClass || since || until);
  const clearAll = () => {
    setSearchInput(''); setQ(''); setDecision(''); setMethod('');
    setStatusClass(''); setSince(''); setUntil(''); setPage(1);
  };

  const rows = data?.items ?? [];
  const stats = data?.stats ?? null;
  const totalPages = data?.pages ?? 1;
  const total = data?.total ?? 0;
  const firstIdx = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastIdx = Math.min(page * pageSize, total);

  const lede = useMemo(() => {
    if (err) return 'Gateway access log';
    if (data == null) return 'Loading gateway access log…';
    return `${total.toLocaleString()} event${total === 1 ? '' : 's'} match${anyFilter ? ' the current filters' : ''} · gateway access log`;
  }, [err, data, total, anyFilter]);

  return (
    <section>
      <p className="page-lede">{lede}</p>

      <Kpis stats={stats} loading={loading} />

      <div className="section-hdr" style={{ alignItems: 'flex-start' }}>
        <h3>Audit events</h3>
        <div className="audit-filters">
          <span className="search-row" style={{ display: 'inline-flex', flex: '0 0 auto' }}>
            <span className="search-ico"><svg className="ico"><use href="#i-search" /></svg></span>
            <input type="text" placeholder="Search path, actor, method, mart, filters…" className="search-input"
                   style={{ width: 250 }} value={searchInput} onChange={e => setSearchInput(e.target.value)} />
          </span>
          <select value={decision} onChange={e => resetFilter(setDecision)(e.target.value as any)}>
            <option value="">All decisions</option>
            <option value="allow">Allow</option>
            <option value="deny">Deny</option>
            <option value="error">Error</option>
          </select>
          <select value={method} onChange={e => resetFilter(setMethod)(e.target.value)}>
            <option value="">Any method</option>
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={statusClass} onChange={e => resetFilter(setStatusClass)(e.target.value as any)}>
            <option value="">Any status</option>
            <option value="2xx">2xx success</option>
            <option value="3xx">3xx redirect</option>
            <option value="4xx">4xx client</option>
            <option value="5xx">5xx server</option>
          </select>
          <input type="date" title="From date" value={since} onChange={e => resetFilter(setSince)(e.target.value)} />
          <span className="dr-sep">→</span>
          <input type="date" title="To date" value={until} onChange={e => resetFilter(setUntil)(e.target.value)} />
          {anyFilter && (
            <button className="btn btn-ghost btn-sm" onClick={clearAll}>Clear</button>
          )}
        </div>
      </div>

      {err && (
        <div className="card card-elev" style={{ borderLeft: '3px solid var(--alert, #c0392b)' }}>
          <strong>Audit feed error:</strong> {err}
        </div>
      )}

      {!err && (
        <>
          <div className="audit-tablewrap">
            <table className="dash">
              <thead>
                <tr>
                  {COLUMNS.map(c => (
                    <th key={c.key} className={`sortable${c.align === 'num' ? ' num' : ''}`}
                        onClick={() => onSort(c.key)} title="Sort">
                      {c.label}
                      <span className={`caret${sort === c.key ? '' : ' idle'}`}>
                        {sort === c.key ? (dir === 'asc' ? '▲' : '▼') : '▾'}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data == null ? (
                  <tr><td colSpan={COLUMNS.length} className="muted" style={{ padding: '1.1rem' }}>Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={COLUMNS.length} className="muted" style={{ padding: '1.1rem' }}>
                    {anyFilter ? 'No events match the current filters.' : 'No audit events recorded yet.'}
                  </td></tr>
                ) : rows.map(r => {
                  const cls = r.policy_decision === 'deny' ? 'deny'
                            : (r.http_status ?? 0) >= 400 ? 'err4' : '';
                  return (
                    <tr key={r.id} className={cls} onClick={() => setSelected(r)}>
                      <td className="mono" title={fmtFull(r.ts)}>{fmtTime(r.ts)}</td>
                      <td><span className={`pill pill-xs ${DECISION_PILL[r.policy_decision]}`}>{r.policy_decision}</span></td>
                      <td className="mono">{r.method}</td>
                      <td className="path" title={r.path}>{r.path}</td>
                      <td title={r.kc_sub ?? 'unauthenticated'}>{actorLabel(r)}</td>
                      <td className="num">
                        {r.http_status != null
                          ? <span className={`code-chip ${codeClass(r.http_status)}`}>{r.http_status}</span>
                          : <span className="muted">—</span>}
                      </td>
                      <td className="num mono">{r.latency_ms != null ? `${r.latency_ms}` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="audit-pager">
            <div>
              {total === 0 ? 'No rows' : `Showing ${firstIdx.toLocaleString()}–${lastIdx.toLocaleString()} of ${total.toLocaleString()}`}
              {loading && data != null && <span className="muted"> · updating…</span>}
              {isLiveTail && <span className="muted"> · live (30s)</span>}
            </div>
            <div className="pg-btns">
              <label className="muted" style={{ marginRight: '0.3rem' }}>
                Rows{' '}
                <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                        style={{ padding: '0.25rem 0.4rem', borderRadius: 'var(--radius)', border: '1px solid var(--border-2)' }}>
                  {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(1)}>« First</button>
              <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>‹ Prev</button>
              <span style={{ minWidth: 92, textAlign: 'center' }}>Page {page} of {totalPages}</span>
              <button className="btn btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next ›</button>
              <button className="btn btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>Last »</button>
            </div>
          </div>
        </>
      )}

      {selected && <AuditDetail ev={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}

/* ── widget-module registration (admin catalog runtime) ─────────────────
   1:1 — page admin/audit has exactly this widget. */
import type { AdminWidget } from '../../runtime/types';
const widget: AdminWidget = {
  id: 'adm-audit-events',
  Component: Audit,
};
export default widget;
