/**
 * MDM stewardship — the human half of master-data conformance.
 *
 * The matcher (2_pipelines/mdm) proposes same-entity candidates with scores
 * and evidence (names, admin area, distance); a steward accepts or rejects
 * here. Verdicts land in the APPEND-ONLY bitemporal decision log that the
 * vault's resolution views read LIVE, so a verdict re-keys the source record
 * on the next read; the insert-only hubs/links record it on the next build.
 * Reverting supersedes (recorded_to) and re-opens the candidate — proven live
 * to restore the previous conformed keys byte for byte.
 *
 * Two tabs: the work queue (pending candidates, best score first, rule
 * filter) and the decision log (current beliefs; full history on demand).
 * No mock rows — an unreachable gateway degrades to a clear error note.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as mdm from '../../api/mdm';
import { useTableKit, TableToolbar, TablePager, SortTh } from '../../kit/tableKit';
import type { AdminWidget } from '../../runtime/types';

const RULE_LABEL: Record<string, string> = {
  name_exact: 'Exact name',
  name_ambiguous: 'Ambiguous name',
  name_probabilistic: 'Probabilistic',
};

function rulePill(rule: string): string {
  if (rule === 'name_exact') return 'good';
  if (rule === 'name_ambiguous') return 'watch';
  return 'info';
}

function featureLine(f: Record<string, unknown>): string {
  const bits: string[] = [];
  if (f.norm_name) bits.push(String(f.source_name ?? f.norm_name));
  if (f.master_name && f.master_name !== f.norm_name) bits.push(`≈ ${f.master_name}`);
  if (f.similarity != null) bits.push(`sim ${Number(f.similarity).toFixed(2)}`);
  if (f.n_targets != null && Number(f.n_targets) > 1) bits.push(`${f.n_targets} possible masters`);
  if (f.left_woreda) bits.push(`woreda ${f.left_woreda}`);
  if (f.left_zone) bits.push(`zone ${f.left_zone}`);
  if (f.distance_km != null) bits.push(`${f.distance_km} km`);
  return bits.join(' · ');
}


/** The "who is this?" panel: what the platform knows about one master —
 *  its source members and HOW each resolves, the golden record with
 *  per-field provenance, and every namespaced identifier it answers to.
 *  Sections the vault has not built yet come back empty rather than
 *  failing the panel. */
function MasterPanel({ entity, masterBk, onClose }:
    { entity: string; masterBk: string; onClose: () => void }) {
  const [d, setD] = useState<mdm.MasterDetail | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    mdm.master(entity, masterBk)
      .then(r => { if (live) { setD(r); setErr(''); } })
      .catch(e => { if (live) setErr(String(e?.message || e)); });
    return () => { live = false; };
  }, [entity, masterBk]);

  const g = (d?.golden ?? {}) as Record<string, any>;
  const goldenRows: Array<[string, any, string | undefined]> = d?.golden ? [
    ['Name', g.canonical_name, g.name_source],
    ['Status', g.operational_status, g.status_source],
    ['Contact', g.telecom, g.telecom_source],
    ['Coordinates', (g.latitude != null && g.longitude != null)
      ? `${g.latitude}, ${g.longitude}` : null, g.coord_source],
    ['Woreda', g.woreda_name, g.admin_source],
    ['Zone', g.zone_name, g.admin_source],
  ] : [];

  return (
    <div className="card" style={{ marginBottom: '0.75rem' }}>
      <div className="section-hdr">
        <h4 style={{ margin: 0 }}>{masterBk}</h4>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>Close</button>
      </div>
      {err && <p className="muted">Detail unavailable: {err}</p>}
      {!d && !err && <p className="muted text-xs">Loading…</p>}
      {d && (
        <div className="tk-scroll">
          <p className="muted text-xs">
            {d.members.length} source record{d.members.length === 1 ? '' : 's'} from{' '}
            {d.n_source_systems} system{d.n_source_systems === 1 ? '' : 's'}
            {d.decisions.length > 0 && ` · ${d.decisions.length} standing steward decision(s)`}
          </p>
          <table className="dash">
            <thead>
              <tr><th>Source record</th><th>Resolves by</th><th>Golden attribute</th><th>From</th></tr>
            </thead>
            <tbody>
              {d.members.map((m, i) => (
                <tr key={m.source_record_key + m.source_system}>
                  <td>
                    <div className="v">{m.source_name || '—'}</div>
                    <div className="muted text-xs">{m.source_system}</div>
                  </td>
                  <td>
                    <span className={`pill ${m.match_strategy === 'steward_decision' ? 'good' : 'info'}`}>
                      {m.match_strategy}
                    </span>
                  </td>
                  <td>{goldenRows[i]
                    ? <><span className="muted text-xs">{goldenRows[i][0]}: </span>
                        <span className="v">{String(goldenRows[i][1] ?? '—')}</span></>
                    : ''}</td>
                  <td className="muted text-xs">{goldenRows[i]?.[2] ?? ''}</td>
                </tr>
              ))}
              {goldenRows.slice(d.members.length).map(([label, value, src]) => (
                <tr key={label}>
                  <td></td><td></td>
                  <td><span className="muted text-xs">{label}: </span>
                      <span className="v">{String(value ?? '—')}</span></td>
                  <td className="muted text-xs">{src ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!d.golden &&
            <p className="muted text-xs">No golden record yet — the canonical satellite builds with the vault.</p>}
          <p className="muted text-xs" style={{ marginTop: '0.5rem' }}>
            Known as: {d.identifiers.length === 0
              ? 'no identifiers recorded yet'
              : d.identifiers.map(i => `${i.identifier_namespace} ${i.identifier_value}`).join(' · ')}
          </p>
        </div>
      )}
    </div>
  );
}

function QueueTab({ onDecided }: { onDecided: () => void }) {
  const [rows, setRows] = useState<mdm.Candidate[] | null>(null);
  const [counts, setCounts] = useState<mdm.RuleCount[]>([]);
  const [rule, setRule] = useState<string>('');
  const [entity, setEntity] = useState<'facility' | 'commodity'>('facility');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string>('');   // candidate_id in flight
  const [flash, setFlash] = useState('');
  const [inspect, setInspect] = useState<string>('');   // master_bk being inspected

  const load = useCallback(() => {
    mdm.queue('pending', rule || undefined, 500, entity)
      .then(r => { setRows(r.candidates); setCounts(r.counts); setErr(''); })
      .catch(e => setErr(String(e?.message || e)));
  }, [rule, entity]);
  useEffect(load, [load]);

  const pending = useMemo(
    () => counts.filter(c => c.status === 'pending')
                .reduce<Record<string, number>>((a, c) => ({ ...a, [c.match_rule]: c.n }), {}),
    [counts]);

  const kit = useTableKit(rows ?? [], {
    pageSize: 12,
    search: c => `${c.left_source_system_code} ${c.left_source_record_key} `
               + `${c.suggested_master_bk ?? ''} ${JSON.stringify(c.match_features)}`,
    sortVals: {
      score:  c => c.score,
      record: c => `${c.left_source_system_code}/${c.left_source_record_key}`,
      master: c => c.suggested_master_bk ?? '',
      rule:   c => c.match_rule,
    },
    initialSort: { key: 'score', dir: 'desc' },
  });

  async function verdict(c: mdm.Candidate, d: 'accept' | 'reject') {
    setBusy(c.candidate_id);
    try {
      await mdm.decide(c.candidate_id, d);
      setFlash(`${d === 'accept' ? 'Accepted' : 'Rejected'} — in effect on the next dashboard read`);
      load(); onDecided();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <div className="section-hdr">
        <div>
          {(['facility', 'commodity'] as const).map(e => (
            <button key={e}
                    className={`btn btn-sm ${entity === e ? '' : 'btn-ghost'}`}
                    onClick={() => { setEntity(e); setRule(''); }}>
              {e === 'facility' ? 'Facilities' : 'Commodities'}
            </button>
          ))}
          <span className="muted"> · </span>
          {Object.keys(RULE_LABEL).map(r => (
            <button key={r}
                    className={`btn btn-sm ${rule === r ? '' : 'btn-ghost'}`}
                    onClick={() => setRule(rule === r ? '' : r)}>
              {RULE_LABEL[r]} <span className="muted">{pending[r] ?? 0}</span>
            </button>
          ))}
        </div>
        {flash && <span className="muted text-xs">{flash}</span>}
      </div>
      {err && <p className="muted">Queue unavailable: {err}</p>}
      {rows !== null && rows.length === 0 && !err &&
        <p className="muted">Queue is clear — no pending candidates{rule ? ` for ${RULE_LABEL[rule]}` : ''}.</p>}
      {inspect && <MasterPanel entity={entity} masterBk={inspect} onClose={() => setInspect('')} />}
      {rows !== null && rows.length > 0 && (
        <>
          <TableToolbar kit={kit} placeholder="Search record, master, name…" unit="candidates" />
          <div className="tk-scroll">
            <table className="dash">
              <thead>
                <tr>
                  <SortTh kit={kit} k="record">Source record</SortTh>
                  <SortTh kit={kit} k="master">Suggested master</SortTh>
                  <SortTh kit={kit} k="rule">Rule · evidence</SortTh>
                  <SortTh kit={kit} k="score">Score</SortTh>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {kit.pageRows.map(c => (
                  <tr key={c.candidate_id}>
                    <td>
                      <div className="v">{c.left_source_system_code}</div>
                      <div className="muted text-xs">{c.left_source_record_key.slice(0, 16)}…</div>
                    </td>
                    <td>
                      <button className="btn btn-sm btn-ghost"
                              title="What does the platform know about this master?"
                              onClick={() => setInspect(c.suggested_master_bk ?? '')}>
                        {c.suggested_master_bk}
                      </button>
                    </td>
                    <td>
                      <span className={`pill ${rulePill(c.match_rule)}`}>{RULE_LABEL[c.match_rule] ?? c.match_rule}</span>
                      <div className="muted text-xs">{featureLine(c.match_features)}</div>
                    </td>
                    <td className="v">{c.score.toFixed(2)}</td>
                    <td>
                      <button className="btn btn-sm" disabled={busy === c.candidate_id}
                              onClick={() => verdict(c, 'accept')}>Accept</button>{' '}
                      <button className="btn btn-sm btn-ghost" disabled={busy === c.candidate_id}
                              onClick={() => verdict(c, 'reject')}>Reject</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePager kit={kit} />
        </>
      )}
    </>
  );
}

function DecisionsTab({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<mdm.Decision[] | null>(null);
  const [history, setHistory] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    mdm.decisions(!history)
      .then(r => { setRows(r.decisions); setErr(''); })
      .catch(e => setErr(String(e?.message || e)));
  }, [history]);
  useEffect(load, [load, refreshKey]);

  async function undo(d: mdm.Decision) {
    try { await mdm.revert(d.decision_id); load(); }
    catch (e: any) { setErr(String(e?.message || e)); }
  }

  const kit = useTableKit(rows ?? [], {
    pageSize: 12,
    search: d => `${d.source_system_code} ${d.source_record_key} ${d.master_bk ?? ''} ${d.decided_by}`,
    sortVals: {
      when:    d => d.recorded_from,
      record:  d => `${d.source_system_code}/${d.source_record_key}`,
      verdict: d => d.decision,
    },
    initialSort: { key: 'when', dir: 'desc' },
  });

  return (
    <>
      <div className="section-hdr">
        <label className="muted text-xs">
          <input type="checkbox" checked={history} onChange={e => setHistory(e.target.checked)} />
          {' '}show superseded history
        </label>
      </div>
      {err && <p className="muted">Decision log unavailable: {err}</p>}
      {rows !== null && rows.length === 0 && !err &&
        <p className="muted">No decisions yet — verdicts from the queue land here (append-only, bitemporal).</p>}
      {rows !== null && rows.length > 0 && (
        <>
          <TableToolbar kit={kit} placeholder="Search record, master, steward…" unit="decisions" />
          <div className="tk-scroll">
            <table className="dash">
              <thead>
                <tr>
                  <SortTh kit={kit} k="record">Source record</SortTh>
                  <SortTh kit={kit} k="verdict">Verdict</SortTh>
                  <th>Master</th>
                  <th>By</th>
                  <SortTh kit={kit} k="when">Recorded</SortTh>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {kit.pageRows.map(d => (
                  <tr key={d.decision_id} className={d.current ? undefined : 'muted'}>
                    <td>
                      <div className="v">{d.source_system_code}</div>
                      <div className="muted text-xs">{d.source_record_key.slice(0, 16)}…</div>
                    </td>
                    <td><span className={`pill ${d.decision === 'accept' ? 'good' : 'alert'}`}>{d.decision}</span>
                        {!d.current && <span className="muted text-xs"> superseded</span>}</td>
                    <td className="v">{d.master_bk ?? '—'}</td>
                    <td className="text-sm">{d.decided_by}</td>
                    <td className="text-sm">{new Date(d.recorded_from).toLocaleString()}</td>
                    <td>{d.current &&
                      <button className="btn btn-sm btn-ghost" onClick={() => undo(d)}>Revert</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePager kit={kit} />
        </>
      )}
    </>
  );
}


/** Master-data releases: named, reproducible cuts of who the masters were.
 *  A release pins BOTH coordinates that determine a master — the decision-log
 *  timestamp and the source watermark — because either one moving changes the
 *  answer. Published releases are immutable; correcting one means publishing a
 *  successor. */
function ReleasesTab() {
  const [rows, setRows] = useState<mdm.Release[] | null>(null);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');

  const load = useCallback(() => {
    mdm.releases()
      .then(r => { setRows(r.releases); setErr(''); })
      .catch(e => setErr(String(e?.message || e)));
  }, []);
  useEffect(load, [load]);

  async function publish() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await mdm.publishRelease(name.trim(), note.trim() || undefined);
      setFlash(`Published ${r.release_id} — ${r.stats.masters} masters pinned`);
      setName(''); setNote(''); load();
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setBusy(false); }
  }

  const kit = useTableKit(rows ?? [], {
    pageSize: 10,
    search: r => `${r.release_id} ${r.created_by} ${r.note ?? ''} ${r.status}`,
    sortVals: { release: r => r.release_id, when: r => r.created_at, status: r => r.status },
    initialSort: { key: 'when', dir: 'desc' },
  });

  return (
    <>
      <div className="section-hdr">
        <div>
          <input value={name} onChange={e => setName(e.target.value)}
                 placeholder="release id (e.g. R-2026-09)" />{' '}
          <input value={note} onChange={e => setNote(e.target.value)}
                 placeholder="what it is for (optional)" />{' '}
          <button className="btn btn-sm" disabled={busy || !name.trim()} onClick={publish}>
            Publish release
          </button>
        </div>
        {flash && <span className="muted text-xs">{flash}</span>}
      </div>
      <p className="muted text-xs">
        A release pins the decision-log cut AND the source watermark, then records
        the master counts — so a report quoting it can be re-derived exactly. It
        stores the two coordinates, not a copy of the data.
      </p>
      {err && <p className="muted">Releases unavailable: {err}</p>}
      {rows !== null && rows.length === 0 && !err &&
        <p className="muted">No releases published yet.</p>}
      {rows !== null && rows.length > 0 && (
        <>
          <TableToolbar kit={kit} placeholder="Search release, steward, note…" unit="releases" />
          <div className="tk-scroll">
            <table className="dash">
              <thead>
                <tr>
                  <SortTh kit={kit} k="release">Release</SortTh>
                  <SortTh kit={kit} k="status">Status</SortTh>
                  <th>Pinned coordinates</th>
                  <th>Masters</th>
                  <SortTh kit={kit} k="when">Published</SortTh>
                </tr>
              </thead>
              <tbody>
                {kit.pageRows.map(r => (
                  <tr key={r.release_id}>
                    <td>
                      <div className="v">{r.release_id}</div>
                      <div className="muted text-xs">{r.note ?? ''}</div>
                    </td>
                    <td><span className={`pill ${r.status === 'published' ? 'good' : 'info'}`}>{r.status}</span>
                        {r.superseded_by && <div className="muted text-xs">→ {r.superseded_by}</div>}</td>
                    <td className="muted text-xs">
                      decisions {new Date(r.decisions_as_of).toLocaleString()}<br />
                      sources {new Date(r.source_watermark).toLocaleString()}
                    </td>
                    <td className="v">{r.stats?.masters ?? '—'}
                      <div className="muted text-xs">
                        {r.stats?.conformed ?? 0} conformed · {r.stats?.decisions_applied ?? 0} decisions
                      </div>
                    </td>
                    <td className="text-sm">{r.created_by}<br />
                      <span className="muted text-xs">
                        {r.published_at ? new Date(r.published_at).toLocaleString() : '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePager kit={kit} />
        </>
      )}
    </>
  );
}

function MdmReview() {
  const [tab, setTab] = useState<'queue' | 'decisions' | 'releases'>('queue');
  const [decidedTick, setDecidedTick] = useState(0);

  return (
    <div className="card card-elev">
      <div className="section-hdr">
        <h3>MDM stewardship</h3>
        <div>
          <button className={`btn btn-sm ${tab === 'queue' ? '' : 'btn-ghost'}`}
                  onClick={() => setTab('queue')}>Candidate queue</button>{' '}
          <button className={`btn btn-sm ${tab === 'decisions' ? '' : 'btn-ghost'}`}
                  onClick={() => setTab('decisions')}>Decision log</button>{' '}
          <button className={`btn btn-sm ${tab === 'releases' ? '' : 'btn-ghost'}`}
                  onClick={() => setTab('releases')}>Releases</button>
        </div>
      </div>
      <p className="muted text-xs">
        Accepting maps the source record onto its master in the append-only
        decision log, which the warehouse reads live — dashboards reflect it on
        the next read, and the vault's insert-only history records it on the
        next build. Nothing merges automatically: probabilistic matches always
        wait here, and a revert restores the previous keys exactly.
      </p>
      {tab === 'queue' && <QueueTab onDecided={() => setDecidedTick(t => t + 1)} />}
      {tab === 'decisions' && <DecisionsTab refreshKey={decidedTick} />}
      {tab === 'releases' && <ReleasesTab />}
    </div>
  );
}

const widget: AdminWidget = {
  id: 'adm-mdm-review',
  Component: MdmReview,
};
export default widget;
