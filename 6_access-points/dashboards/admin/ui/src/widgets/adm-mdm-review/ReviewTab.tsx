/**
 * Review matches — the matcher's suggestions, one at a time.
 *
 * Left: the waiting queue (best score first). Right: the selected
 * suggestion with its source records side by side, field by field, as each
 * source holds them (GET /api/mdm/compare). The verdict buttons are today's
 * one-step decide (POST /api/mdm/candidate/{id}/decide) behind a confirm
 * step; they give way to propose → approve when Approvals ships.
 * J / K move through the queue when focus is not in a form field.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as mdm from '../../api/mdm';
import { ActionError, LoadError, RULE_LABEL, featureLine, fmtWhen, rulePill } from './parts';

type Entity = 'facility' | 'commodity';

const RESULT_PILL: Record<mdm.FieldResult, [string, string]> = {
  difference:   ['watch', 'Difference'],
  missing:      ['neutral', 'Missing'],
  not_reported: ['info', 'Not reported'],
  agreement:    ['good', 'Agreement'],
};

function candidateName(c: mdm.Candidate): string {
  const f = c.match_features as Record<string, unknown>;
  return String(f.source_name ?? f.norm_name ?? `${c.left_source_system_code} record`);
}

function Comparison({ cmp }: { cmp: mdm.Comparison }) {
  const systems = [...new Set(cmp.records.map(r => r.source_system))];
  return (
    <>
      <p className="rv-detail-desc">{cmp.records.length} records from {systems.join(', ')}</p>
      <div className="rv-section-h mdm-section">What each source reported</div>
      <div className="tk-scroll">
        <table className="dash mdm-compare">
          <thead>
            <tr>
              <th>Field</th>
              {cmp.records.map(r => (
                <th key={r.source_system + r.record_key} title={r.record_key}>
                  <span className="mdm-src">{r.name ?? 'Record not found'}</span>
                  <span className="mdm-src-sub">
                    {r.source_system} · {r.role === 'suggested' ? 'suggested' : 'in master'}
                  </span>
                </th>
              ))}
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {cmp.fields.map(f => (
              <tr key={f.field}>
                <td>{f.label}</td>
                {f.cells.map((cell, i) => (
                  <td key={i} className={cell.state !== 'value' ? 'mdm-nv'
                    : (f.field === 'coordinates' || f.field === 'code') ? 'mdm-mono' : undefined}>
                    {cell.state === 'value' ? cell.value
                      : cell.state === 'missing' ? 'Missing' : 'Not reported'}
                  </td>
                ))}
                <td><span className={`pill ${RESULT_PILL[f.result][0]}`}>{RESULT_PILL[f.result][1]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cmp.more_members > 0 &&
        <p className="muted text-sm">{cmp.more_members} more source record{cmp.more_members === 1 ? '' : 's'} in this master.</p>}

      <div className="rv-section-h mdm-section">What agrees and differs</div>
      <div className="mdm-summary">
        {cmp.summary.difference.length === 0 && cmp.summary.missing.length === 0
          ? 'Every field the records share agrees.'
          : <ul>
              {cmp.summary.difference.map(l => <li key={'d' + l}>{l}: different values reported</li>)}
              {cmp.summary.missing.map(l => <li key={'m' + l}>{l}: missing in some records</li>)}
              {cmp.summary.not_reported.map(l => <li key={'n' + l}>{l}: not carried by every source</li>)}
            </ul>}
      </div>
    </>
  );
}

export default function ReviewTab({ onDecided, onOpenMaster }:
    { onDecided: () => void; onOpenMaster: (bk: string) => void }) {
  const [entity, setEntity] = useState<Entity>('facility');
  const [rule, setRule] = useState('');
  const [rows, setRows] = useState<mdm.Candidate[] | null>(null);
  const [counts, setCounts] = useState<mdm.RuleCount[]>([]);
  const [err, setErr] = useState('');
  const [selId, setSelId] = useState('');
  const [cmp, setCmp] = useState<mdm.Comparison | null>(null);
  const [cmpErr, setCmpErr] = useState('');
  const [verdict, setVerdict] = useState<'accept' | 'reject' | null>(null);
  const [busy, setBusy] = useState(false);
  const [actErr, setActErr] = useState('');
  const [flash, setFlash] = useState('');

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
  const totalPending = Object.values(pending).reduce((a, n) => a + n, 0);

  const sel = rows?.find(c => c.candidate_id === selId) ?? rows?.[0] ?? null;
  const idx = sel && rows ? rows.indexOf(sel) : -1;

  const loadCompare = useCallback(() => {
    if (!sel || sel.entity_class_code !== 'facility') { setCmp(null); setCmpErr(''); return; }
    let live = true;
    setCmp(null); setCmpErr('');
    mdm.compare(sel.candidate_id)
      .then(r => { if (live) setCmp(r); })
      .catch(e => { if (live) setCmpErr(String(e?.message || e)); });
    return () => { live = false; };
  }, [sel?.candidate_id]);
  useEffect(loadCompare, [loadCompare]);
  useEffect(() => { setVerdict(null); setActErr(''); }, [sel?.candidate_id]);

  const move = useCallback((step: number) => {
    if (!rows || rows.length === 0) return;
    const next = rows[Math.min(rows.length - 1, Math.max(0, idx + step))];
    setSelId(next.candidate_id);
  }, [rows, idx]);

  // J / K step through the queue unless the steward is typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select') || t.isContentEditable)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'j' || e.key === 'J') move(1);
      if (e.key === 'k' || e.key === 'K') move(-1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move]);

  async function save() {
    if (!sel || !verdict) return;
    setBusy(true); setActErr(''); setFlash('');
    try {
      await mdm.decide(sel.candidate_id, verdict);
      setFlash(`Saved: ${verdict === 'accept' ? `same ${noun}` : `different ${plural}`}. In effect on the next read.`);
      setVerdict(null);
      if (rows && idx + 1 < rows.length) setSelId(rows[idx + 1].candidate_id);
      load(); onDecided();
    } catch (e: any) {
      setActErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  const noun = entity === 'facility' ? 'facility' : 'commodity';
  const plural = entity === 'facility' ? 'facilities' : 'commodities';
  return (
    <>
      <div className="local-controls">
        <span className="lc-label">Show</span>
        <select value={entity} aria-label="List"
                onChange={e => { setEntity(e.target.value as Entity); setRule(''); setSelId(''); }}>
          <option value="facility">Facilities</option>
          <option value="commodity">Commodities</option>
        </select>
        <span className="lc-label">Rule</span>
        <select value={rule} aria-label="Match rule" onChange={e => { setRule(e.target.value); setSelId(''); }}>
          <option value="">All rules · {totalPending}</option>
          {Object.keys(RULE_LABEL).map(r => (
            <option key={r} value={r}>{RULE_LABEL[r]} · {pending[r] ?? 0}</option>
          ))}
        </select>
      </div>
      {flash && (
        <div className="rv-note rv-note-good" role="status">
          <svg className="ico ico-sm"><use href="#i-check-circle" /></svg>
          <span className="rv-note-txt">{flash}</span>
        </div>
      )}

      {err && <LoadError what="matches" err={err} retry={load} />}
      {rows === null && !err && <p className="muted">Loading matches…</p>}
      {rows !== null && rows.length === 0 && !err &&
        <p className="muted">{rule ? 'No matches for this filter.' : 'No matches to review.'}</p>}

      {rows !== null && rows.length > 0 && sel && (
        <div className="rv-layout mdm-review">
          <div className="card rv-list">
            <div className="rv-list-hdr">
              <h4>{rows.length} possible match{rows.length === 1 ? '' : 'es'}</h4>
              <span className="mdm-kbd" title="Next match">J</span>
              <span className="mdm-kbd" title="Previous match">K</span>
            </div>
            <div className="rv-list-body" role="listbox" aria-label="Possible matches">
              {rows.map(c => (
                <button key={c.candidate_id} role="option" aria-selected={c === sel}
                        className={`rv-row${c === sel ? ' active' : ''}`}
                        onClick={() => setSelId(c.candidate_id)}>
                  <span className="rv-row-main">
                    <span className="rv-row-name">{candidateName(c)}</span>
                    <span className="rv-row-sub">
                      <span className="mdm-mono">{c.suggested_master_bk ?? c.left_source_system_code}</span>
                      <span className={`pill ${rulePill(c.match_rule)}`}>{RULE_LABEL[c.match_rule] ?? c.match_rule}</span>
                      {c.score.toFixed(2)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="rv-detail-wrap">
            <div className="card card-elev rv-detail">
              <div className="card-hdr">
                <span className="meta">Match {idx + 1} of {rows.length}</span>
                <span className="rv-actions">
                  <button className="btn btn-sm btn-ghost" title="Previous match (K)" disabled={idx <= 0}
                          onClick={() => move(-1)}>Previous</button>
                  <button className="btn btn-sm btn-ghost" title="Next match (J)" disabled={idx >= rows.length - 1}
                          onClick={() => move(1)}>Next</button>
                </span>
              </div>
              <div className="mdm-q">
                <h3 className="rv-detail-name mdm-name">Are these the same {noun}?</h3>
                <span className={`pill ${rulePill(sel.match_rule)}`}>{RULE_LABEL[sel.match_rule] ?? sel.match_rule}</span>
              </div>
              {sel.suggested_master_bk && (
                <div className="mdm-q">
                  <span className="rv-detail-desc">Suggested master <span className="mdm-mono">{sel.suggested_master_bk}</span></span>
                  {entity === 'facility' &&
                    <button className="btn btn-sm btn-ghost" onClick={() => onOpenMaster(sel.suggested_master_bk!)}>Open record</button>}
                </div>
              )}

              {entity === 'facility' && cmpErr && <LoadError what="this comparison" err={cmpErr} retry={loadCompare} />}
              {entity === 'facility' && !cmp && !cmpErr && <p className="muted">Loading comparison…</p>}
              {entity === 'facility' && cmp && <Comparison cmp={cmp} />}
              {entity === 'commodity' && <p className="rv-detail-desc">{featureLine(sel.match_features)}</p>}

              <div className="rv-section-h mdm-section">What do you think?</div>
              <div className="rv-actions">
                <button className="btn" disabled={busy || !sel.suggested_master_bk}
                        onClick={() => setVerdict('accept')}>Same {noun}</button>
                <button className="btn" disabled={busy} onClick={() => setVerdict('reject')}>Different {plural}</button>
              </div>
              {verdict && (
                <div className="mdm-confirm" role="region" aria-label="Confirm decision">
                  <p className="rv-detail-desc">
                    {verdict === 'accept'
                      ? `The ${sel.left_source_system_code} record joins ${sel.suggested_master_bk}. In effect on the next read.`
                      : `The suggestion closes and the ${sel.left_source_system_code} record keeps its own identity.`}
                  </p>
                  <div className="rv-actions">
                    <button className="btn btn-primary" disabled={busy} onClick={save}>
                      {verdict === 'accept' ? `Confirm: same ${noun}` : `Confirm: different ${plural}`}
                    </button>
                    <button className="btn btn-ghost" disabled={busy} onClick={() => setVerdict(null)}>Cancel</button>
                  </div>
                </div>
              )}
              {actErr && <ActionError text="Could not save the decision." err={actErr} />}

              <details className="mdm-disclosure">
                <summary>About this suggestion</summary>
                <dl className="mdm-kv">
                  <dt>Score</dt><dd className="mdm-mono">{sel.score.toFixed(2)}</dd>
                  <dt>Rule</dt><dd>{RULE_LABEL[sel.match_rule] ?? sel.match_rule}</dd>
                  <dt>Evidence</dt><dd>{featureLine(sel.match_features) || '—'}</dd>
                  <dt>Found</dt><dd>{fmtWhen(sel.discovered_at)}</dd>
                </dl>
              </details>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
