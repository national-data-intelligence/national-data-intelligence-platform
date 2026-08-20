/**
 * Access-request review modal — REAL decisions (§4.8 provisioning).
 *
 * Opened from the Access Requests queue (app.openReview). Approve-with-role
 * calls the gateway, which creates the Keycloak account, assigns the role +
 * data scope, and emails a set-password link (→ Google relay). Decline / Request-info
 * just record the decision. Controlled form: reads the reactive snapshot, edits
 * via setReview, submits via app.submitReview().
 */
import { useAdminApp } from '../../useAdminApp';

// moh-staff realm roles offered for provisioning (code → operator-facing label).
const PROVISION_ROLES: Array<{ code: string; label: string }> = [
  { code: 'R-CONS-ANA', label: 'R-CONS-ANA: Analyst (read-only BI)' },
  { code: 'R-CONS-SCI', label: 'R-CONS-SCI: Data scientist (Jupyter and read)' },
  { code: 'R-CONS-RES', label: 'R-CONS-RES: Researcher (Jupyter and aggregate)' },
  { code: 'R-CONS-PRT', label: 'R-CONS-PRT: Partner (aggregate only)' },
  { code: 'R-DEC',      label: 'R-DEC: Decision-maker (full BI)' },
  { code: 'R-STEW',     label: 'R-STEW: Data steward' },
  { code: 'R-PROD-CLIN',label: 'R-PROD-CLIN: Clinical producer' },
  { code: 'R-PROD-SUBMIT', label: 'R-PROD-SUBMIT: Facility submitter' },
  { code: 'R-OPS-ADM',  label: 'R-OPS-ADM: Operations admin' },
  { code: 'R-SUPER',    label: 'R-SUPER: Super-user (full access, break-glass)' },
];
// user_scope stores the 2-letter region_id, so the picker's VALUES are ids.
const REGIONS: Array<{ id: string; name: string }> = [
  { id: 'all', name: 'All regions (national)' },
  { id: 'AA', name: 'Addis Ababa' }, { id: 'AF', name: 'Afar' },
  { id: 'AM', name: 'Amhara' }, { id: 'BG', name: 'Benishangul Gumuz' },
  { id: 'CE', name: 'Central Ethiopia' }, { id: 'DD', name: 'Dire Dawa' },
  { id: 'GA', name: 'Gambella' }, { id: 'HA', name: 'Harari' },
  { id: 'OR', name: 'Oromia' }, { id: 'SI', name: 'Sidama' },
  { id: 'SO', name: 'Somali' }, { id: 'SE', name: 'South Ethiopia' },
  { id: 'SW', name: 'South West Ethiopia' }, { id: 'TI', name: 'Tigray' },
];
const PROGRAMMES = ['all', 'HIV', 'TB', 'EPI', 'MNCH', 'NCD', 'Malaria', 'FP', 'Nutrition'];

const DECISIONS: Array<{ v: string; label: string }> = [
  { v: 'approved', label: 'Approve' },
  { v: 'declined', label: 'Decline' },
  { v: 'more-info', label: 'Request info' },
];

export default function ReviewModal() {
  const { state, app, setReview } = useAdminApp();
  if (!state.reviewOpen) return null;
  const r = state.selectedRequest || {};
  const dec = state.reviewDecision;
  const scope = state.reviewScope;
  const submitLabel = dec === 'approved' ? 'Approve & provision'
    : dec === 'declined' ? 'Decline' : dec === 'more-info' ? 'Send request' : 'Select a decision';

  return (
    <div className="modal-bg" onClick={(e) => { if (e.target === e.currentTarget) app.closeReview(); }}>
      <div className="modal" style={{ maxWidth: '680px' }} data-testid="review-modal">
        <div className="modal-hdr">
          <h2>Review access request <code>{r.code}</code></h2>
          <p>{r.name}{r.org && r.org !== '—' ? ` · ${r.org}` : ''} · {r.email}</p>
        </div>
        <div className="modal-body" style={{ maxHeight: '68vh', overflowY: 'auto' }}>

          <div className="card" style={{ padding: '0.7rem 0.9rem', marginBottom: '1rem', fontSize: '0.86rem' }}>
            <div><strong>Requested:</strong> {(r.dashboards || []).join(', ') || '—'}</div>
            <div style={{ marginTop: '0.25rem' }}><strong>Purpose:</strong> {r.purpose || '—'}</div>
            {r.supervisorEmail && <div style={{ marginTop: '0.25rem' }}><strong>Supervisor:</strong> {r.supervisorEmail}</div>}
            {r.fayda_id && <div style={{ marginTop: '0.25rem' }}><span className="pill good">Fayda-verified</span> <span className="muted text-xs">{r.fayda_id}</span></div>}
            {r.provisioning_status && r.provisioning_status !== 'not_provisioned' && (
              <div style={{ marginTop: '0.25rem' }}><span className="pill info">Provisioning: {r.provisioning_status}</span></div>
            )}
          </div>

          <div className="field-group" style={{ marginBottom: '1rem' }}>
            <label>Decision</label>
            <div className="seg" style={{ display: 'flex', gap: '0.4rem' }}>
              {DECISIONS.map(d => (
                <button key={d.v} type="button" data-testid={`decision-${d.v}`}
                        className={`btn btn-sm ${dec === d.v ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setReview({ reviewDecision: d.v })}>{d.label}</button>
              ))}
            </div>
          </div>

          {dec === 'approved' && (
            <>
              <div className="field-group" style={{ marginBottom: '0.8rem' }}>
                <label>Granted role</label>
                <select value={state.reviewRole} data-testid="review-role"
                        onChange={(e) => setReview({ reviewRole: e.target.value })}>
                  {PROVISION_ROLES.map(x => <option key={x.code} value={x.code}>{x.label}</option>)}
                </select>
              </div>
              <div className="grid grid-2 gap-md" style={{ marginBottom: '0.8rem' }}>
                <div className="field-group">
                  <label>Region scope</label>
                  <select value={scope.region} data-testid="review-region"
                          onChange={(e) => setReview({ reviewScope: { ...scope, region: e.target.value } })}>
                    {REGIONS.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </div>
                <div className="field-group">
                  <label>Programme scope</label>
                  <select value={scope.programme}
                          onChange={(e) => setReview({ reviewScope: { ...scope, programme: e.target.value } })}>
                    {PROGRAMMES.map(p => <option key={p} value={p}>{p === 'all' ? 'All programmes' : p}</option>)}
                  </select>
                </div>
              </div>
              <p className="muted text-xs" style={{ marginBottom: '0.8rem' }}>
                On approval a Keycloak account is created for <strong>{r.email}</strong>, the role +
                scope are assigned, and a set-password link is emailed to them.
              </p>
            </>
          )}

          <div className="field-group" style={{ marginBottom: '0.6rem' }}>
            <label>Reviewer note {dec === 'more-info' ? '(what to ask for)' : '(optional)'}</label>
            <textarea rows={3} value={state.reviewNote} data-testid="review-note"
                      onChange={(e) => setReview({ reviewNote: e.target.value })}
                      placeholder={dec === 'declined' ? 'Reason for declining…' : dec === 'more-info' ? 'Information needed…' : 'Internal note…'} />
          </div>

          {state.reviewError && (
            <p className="text-sm" data-testid="review-error" style={{ color: 'var(--alert, #d9534f)' }}>{state.reviewError}</p>
          )}
        </div>
        <div className="modal-foot" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button className="btn btn-ghost" onClick={() => app.closeReview()} disabled={state.reviewBusy}>Cancel</button>
          <button className="btn btn-primary" data-testid="review-submit"
                  onClick={() => app.submitReview()}
                  disabled={!dec || state.reviewBusy}>
            {state.reviewBusy ? 'Working…' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
