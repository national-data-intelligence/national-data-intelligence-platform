/**
 * Widget · pub-access-modal — access-request modal (form + success view).
 *
 * POSTs to /api/proxy/access-requests (FastAPI proxies to the gateway's
 * /api/public/access-requests endpoint, which returns the tracking ID and,
 * on a duplicate pending request, a 409). Reads closeModal + setPage from the
 * host — a public requester is NEVER linked to the admin console.
 *
 * Identity verification (§6.3) is modelled as explicit states:
 *   not-started → validating → verified            (Fayda: real popup verify)
 *                            → could-not-verify     (Fayda returned an error)
 *                            → service-unavailable  (Fayda popup unreachable)
 *   not-started → provided                          (National ID / Passport:
 *                                                     number recorded, pending
 *                                                     manual verification — we
 *                                                     never fake a verify here)
 */
import { useState, useEffect } from 'react';
import type { PublicWidget, PublicHost } from '../../runtime/types';

type IdType = 'fayda' | 'national-id' | 'passport';

/** Explicit verification lifecycle — one clear status is rendered per state. */
type VerifyState =
  | 'not-started'
  | 'validating'          // Fayda popup open, awaiting the postMessage result
  | 'verified'            // Fayda confirmed the citizen
  | 'could-not-verify'    // Fayda returned ok:false (bad/expired/mismatched)
  | 'service-unavailable' // the Fayda popup could not be opened / reached
  | 'provided';           // National ID / Passport number entered + format-valid

type AccessForm = {
  name: string; email: string; phone: string; org: string; role: string;
  dashboards: string[]; purpose: string;
  id_type: IdType;
  identifier: string;                 // the entered FAN / national-id / passport number
  verifyState: VerifyState;
  fayda_id: string;                   // set ONLY on a real Fayda verify
  verified_via: '' | 'fayda';         // 'fayda' ONLY when genuinely verified
};

const EMPTY: AccessForm = {
  name: '', email: '', phone: '', org: '', role: '', dashboards: [], purpose: '',
  id_type: 'fayda', identifier: '', verifyState: 'not-started',
  fayda_id: '', verified_via: '',
};

type FieldErr = { name?: string; email?: string; purpose?: string; identifier?: string };

/** Identity-type options — label, the field label, and an example placeholder. */
const ID_TYPES: { v: IdType; label: string; field: string; placeholder: string }[] = [
  { v: 'fayda',       label: 'Fayda (Ethiopian National ID)', field: 'Fayda number (FAN or FIN)', placeholder: 'e.g. 123456789012' },
  { v: 'national-id', label: 'National ID card',              field: 'National ID number',        placeholder: 'ID card number' },
  { v: 'passport',    label: 'Passport',                      field: 'Passport number',           placeholder: 'e.g. EP1234567' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Basic client-side format rules per identity type (documented so reviewers know
 * what "format-valid" means — this is a shape check, not a verification):
 *   · Fayda:       12 to 16 digits, numeric (Ethiopia's FIN is 12, the FAN 16).
 *   · National ID: 6 to 20 letters/digits/hyphen.
 *   · Passport:    6 to 15 letters/digits.
 */
function validateIdentifier(type: IdType, value: string): string | null {
  const v = value.trim();
  if (!v) return 'Enter your identifier number first.';
  if (type === 'fayda')
    return /^\d{12,16}$/.test(v) ? null : 'Enter a valid Fayda number (12 to 16 digits).';
  if (type === 'national-id')
    return /^[A-Za-z0-9-]{6,20}$/.test(v) ? null : 'Enter a valid National ID number (6 to 20 letters or digits).';
  return /^[A-Za-z0-9]{6,15}$/.test(v) ? null : 'Enter a valid passport number (6 to 15 letters or digits).';
}

/** Turn a gateway error response into a friendly line — never raw HTTP/validation text. */
function friendlyError(status: number, body: any): string {
  const detail = body?.detail;
  if (status === 409) {
    if (detail && typeof detail === 'object' && detail.message) return String(detail.message);
    if (typeof detail === 'string') return detail;
    return 'You already have a pending request for this access. We will review it shortly.';
  }
  if (status === 422) {
    // FastAPI 422 detail is an ARRAY of field errors — map to a concise field
    // list and never surface the library's raw message strings.
    const fields = new Set<string>();
    if (Array.isArray(detail)) {
      for (const d of detail) {
        const loc = Array.isArray(d?.loc) ? d.loc : [];
        const f = loc[loc.length - 1];
        if (f === 'full_name') fields.add('full name');
        else if (f === 'email') fields.add('email');
        else if (f === 'purpose') fields.add('purpose');
        else if (typeof f === 'string') fields.add(String(f));
      }
    }
    return fields.size
      ? `Please check these fields and try again: ${Array.from(fields).join(', ')}.`
      : 'Please review the form and try again.';
  }
  if (status === 502 || status === 503)
    return 'The service is temporarily unavailable. Please try again in a moment.';
  return 'Something went wrong submitting your request. Please try again in a moment.';
}

/** One human line + tone for the current verification state. */
function statusFor(state: VerifyState, idType: IdType, faydaId: string):
    { tone: 'good' | 'watch' | 'alert' | 'muted'; text: string } | null {
  switch (state) {
    case 'validating':
      return { tone: 'watch', text: 'Waiting for Fayda to confirm your identity in the popup window.' };
    case 'verified':
      return { tone: 'good', text: faydaId
        ? `Identity verified with Fayda (${faydaId}). Reviewers will see a verified badge.`
        : 'Identity verified with Fayda. Reviewers will see a verified badge.' };
    case 'could-not-verify':
      return { tone: 'alert', text: 'We could not verify this identity with Fayda. You can retry, or continue without verification.' };
    case 'service-unavailable':
      return { tone: 'alert', text: 'The Fayda verification service could not be reached. You can retry, or continue without verification.' };
    case 'provided':
      return { tone: 'watch', text: idType === 'passport'
        ? 'Passport number recorded. A reviewer will verify it manually before approval.'
        : 'National ID number recorded. A reviewer will verify it manually before approval.' };
    default:
      return null;
  }
}

function AccessRequestModal({ host }: { host: PublicHost }) {
  const onClose = host.closeModal;
  const { setPage } = host;
  const [form, setForm] = useState<AccessForm>(EMPTY);
  const [fieldErr, setFieldErr] = useState<FieldErr>({});
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>('');

  const update = (patch: Partial<AccessForm>) => setForm(f => ({ ...f, ...patch }));

  // Listen for the Fayda popup's postMessage and resolve the verification state.
  useEffect(() => {
    const handler = (evt: MessageEvent) => {
      const m = (evt.data ?? {}) as { type?: string; payload?: any };
      if (m.type !== 'nhdw:fayda-verify') return;
      const p = m.payload || {};
      setForm(f => {
        if (f.id_type !== 'fayda') return f;             // stray message; ignore
        if (!p.ok) return { ...f, verifyState: 'could-not-verify', verified_via: '', fayda_id: '' };
        return {
          ...f,
          verifyState: 'verified',
          verified_via: 'fayda',
          fayda_id: p.fayda_id || f.identifier.trim(),
          name:  f.name  || p.name || `${p.given_name || ''} ${p.family_name || ''}`.trim(),
          phone: f.phone || p.phone || '',
        };
      });
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const currentType = ID_TYPES.find(t => t.v === form.id_type)!;

  // Changing the identity TYPE clears the entered value + any prior verification.
  const changeType = (v: IdType) => {
    setFieldErr(fe => ({ ...fe, identifier: undefined }));
    update({ id_type: v, identifier: '', verifyState: 'not-started', fayda_id: '', verified_via: '' });
  };

  // Editing the identifier invalidates any earlier verify/provide result.
  const changeIdentifier = (value: string) => {
    setFieldErr(fe => ({ ...fe, identifier: undefined }));
    setForm(f => ({
      ...f, identifier: value,
      verifyState: 'not-started', fayda_id: '', verified_via: '',
    }));
  };

  // Fayda path — validate the entered FAN, then drive the existing popup with it.
  const verifyFayda = () => {
    const e = validateIdentifier('fayda', form.identifier);
    if (e) { setFieldErr(fe => ({ ...fe, identifier: e })); return; }
    setFieldErr(fe => ({ ...fe, identifier: undefined }));
    setErr('');
    update({ verifyState: 'validating' });
    const fan = form.identifier.trim();
    const w = window.open(`/auth/fayda-start?fan=${encodeURIComponent(fan)}`, 'fayda',
      'popup,width=520,height=640,scrollbars=yes');
    if (!w) {
      // Popup blocked / could not open → the verification service is unreachable.
      update({ verifyState: 'service-unavailable' });
      return;
    }
    // Cancel path: the user closed the popup without a result → revert to
    // not-started rather than leaving it stuck on "validating".
    const watch = window.setInterval(() => {
      if (w.closed) {
        window.clearInterval(watch);
        setForm(f => (f.verifyState === 'validating' ? { ...f, verifyState: 'not-started' } : f));
      }
    }, 500);
  };

  // National ID / Passport path — no backend verify exists, so we only record
  // the number as "provided, pending manual verification". Never faked as OK.
  const provideIdentifier = () => {
    const e = validateIdentifier(form.id_type, form.identifier);
    if (e) { setFieldErr(fe => ({ ...fe, identifier: e })); return; }
    setFieldErr(fe => ({ ...fe, identifier: undefined }));
    update({ verifyState: 'provided', verified_via: '', fayda_id: '' });
  };

  const toggleDash = (id: string, on: boolean) =>
    update({ dashboards: on
      ? Array.from(new Set([...form.dashboards, id]))
      : form.dashboards.filter(d => d !== id) });

  const onBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  // Mirror the backend PublicSubmission constraints so a short purpose / bad
  // email is caught inline BEFORE we submit (no round-trip 422).
  const validate = (): boolean => {
    const fe: FieldErr = {};
    if (form.name.trim().length < 2) fe.name = 'Enter your full name (at least 2 characters).';
    if (!EMAIL_RE.test(form.email.trim())) fe.email = 'Enter a valid email address.';
    if (form.purpose.trim().length < 10) fe.purpose = 'Describe your intended use in at least 10 characters.';
    if (form.identifier.trim()) {
      const ie = validateIdentifier(form.id_type, form.identifier);
      if (ie) fe.identifier = ie;
    }
    setFieldErr(fe);
    return Object.keys(fe).length === 0;
  };

  const submit = async () => {
    setErr('');
    if (!validate()) return;
    setBusy(true);
    try {
      // Only send filled optionals — empty strings become omitted so nothing
      // invalid reaches the backend.
      const payload: Record<string, unknown> = {
        full_name: form.name.trim(),
        email:     form.email.trim(),
        purpose:   form.purpose.trim(),
      };
      if (form.phone.trim()) payload.phone = form.phone.trim();
      if (form.org.trim())   payload.org   = form.org.trim();
      if (form.role.trim())  payload.role  = form.role.trim();
      if (form.dashboards.length) payload.dashboards = form.dashboards;
      // Identity: only 'fayda' + fayda_id when genuinely verified; otherwise the
      // entered value travels as id_number (provided, pending manual review).
      if (form.identifier.trim() || form.verifyState === 'verified') {
        payload.id_type = form.id_type;
        if (form.id_type === 'fayda' && form.verifyState === 'verified') {
          payload.fayda_id = form.fayda_id || form.identifier.trim();
          payload.verified_via = 'fayda';
        } else if (form.identifier.trim()) {
          payload.id_number = form.identifier.trim();
        }
      }
      const r = await fetch('/api/proxy/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(friendlyError(r.status, body)); return; }
      setSubmitted(body.tracking_id);
      // Reset the form after a successful submit so a re-open starts clean.
      setForm(EMPTY);
      setFieldErr({});
    } catch {
      setErr('We could not reach the server. Please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  // Success-view actions — user-authorized only, never a link to the admin console.
  const closeAll = () => { setSubmitted(null); setForm(EMPTY); setFieldErr({}); setErr(''); onClose(); };
  const returnToDatasets = () => { setSubmitted(null); setForm(EMPTY); setFieldErr({}); setErr(''); setPage('data'); onClose(); };

  const verified = form.verifyState === 'verified';
  const provided = form.verifyState === 'provided';
  const status = statusFor(form.verifyState, form.id_type, form.fayda_id);
  const toneColor = (t: 'good' | 'watch' | 'alert' | 'muted') =>
    t === 'good' ? 'var(--good, #1d8b5a)'
    : t === 'alert' ? 'var(--alert, #c0392b)'
    : t === 'watch' ? 'var(--watch, #b7791f)'
    : 'var(--ink-3)';

  return (
    <div className="modal-bg" onClick={onBackdrop}>
      <div className="modal" style={{ maxWidth: 640 }}>

        {!submitted && (
          <>
            <div className="modal-hdr">
              <h2>Request NHDW access</h2>
              <p>Tell us who you are and what you need. We respond within 2 business days.</p>
            </div>
            <div className="modal-body">
              {/* Identity verification (optional) — realistic identifier entry */}
              <div style={{
                background: verified ? 'var(--good-50, #e7f5ee)' : 'var(--paper-2)',
                border: verified ? '1px solid var(--good, #1d8b5a)' : '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)', padding: '0.9rem 1.1rem',
                marginBottom: '1rem',
              }} data-verify-state={form.verifyState}>
                <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'flex-start' }}>
                  <span className="ico-circle tint-navy" style={{ flexShrink: 0 }}>
                    <svg><use href="#i-shield-check" /></svg>
                  </span>
                  <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <p className="text-sm" style={{ margin: 0, fontWeight: 600 }}>
                      Verify your identity (optional)
                    </p>
                    <p className="text-xs muted" style={{ margin: '0.2rem 0 0' }}>
                      Providing a government ID helps reviewers approve faster. Not required for organisation accounts.
                    </p>
                  </div>
                </div>

                <div className="grid grid-2 gap-sm" style={{ marginTop: '0.8rem' }}>
                  <div className="field-group">
                    <label>ID type</label>
                    <select value={form.id_type} onChange={e => changeType(e.target.value as IdType)}>
                      {ID_TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
                    </select>
                  </div>
                  <div className="field-group">
                    <label>{currentType.field}</label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input type="text" inputMode={form.id_type === 'fayda' ? 'numeric' : 'text'}
                             value={form.identifier} placeholder={currentType.placeholder}
                             aria-invalid={!!fieldErr.identifier}
                             onChange={e => changeIdentifier(e.target.value)}
                             style={{ flex: '1 1 auto', minWidth: 0 }} />
                      {form.id_type === 'fayda' ? (
                        <button type="button" className="btn btn-sm btn-primary"
                                onClick={verifyFayda}
                                disabled={form.verifyState === 'validating' || verified}
                                style={{ flexShrink: 0 }}>
                          {form.verifyState === 'validating' ? 'Opening Fayda' : verified ? 'Verified' : 'Verify'}
                        </button>
                      ) : (
                        <button type="button" className="btn btn-sm btn-primary"
                                onClick={provideIdentifier} disabled={provided}
                                style={{ flexShrink: 0 }}>
                          {provided ? 'Saved' : 'Use this ID'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {fieldErr.identifier && (
                  <p className="text-xs" style={{ margin: '0.35rem 0 0', color: 'var(--alert, #c0392b)' }}>
                    {fieldErr.identifier}
                  </p>
                )}
                {status && (
                  <p className="text-xs" role="status" aria-live="polite"
                     style={{ margin: '0.5rem 0 0', fontWeight: 500, color: toneColor(status.tone) }}>
                    {status.text}
                  </p>
                )}
              </div>

              <div className="grid grid-2 gap-sm">
                <div className="field-group"><label>Full name</label>
                  <input type="text" value={form.name} placeholder="Dr Tigist Bekele"
                         aria-invalid={!!fieldErr.name}
                         onChange={e => { update({ name: e.target.value }); if (fieldErr.name) setFieldErr(fe => ({ ...fe, name: undefined })); }} />
                  {fieldErr.name && <p className="text-xs" style={{ margin: '0.25rem 0 0', color: 'var(--alert, #c0392b)' }}>{fieldErr.name}</p>}
                </div>
                <div className="field-group"><label>Email</label>
                  <input type="email" value={form.email} placeholder="tigist.bekele@moh.gov.et"
                         aria-invalid={!!fieldErr.email}
                         onChange={e => { update({ email: e.target.value }); if (fieldErr.email) setFieldErr(fe => ({ ...fe, email: undefined })); }} />
                  {fieldErr.email && <p className="text-xs" style={{ margin: '0.25rem 0 0', color: 'var(--alert, #c0392b)' }}>{fieldErr.email}</p>}
                </div>
                <div className="field-group"><label>Phone</label>
                  <input type="tel" value={form.phone} placeholder="+251 911 000000"
                         onChange={e => update({ phone: e.target.value })} /></div>
                <div className="field-group"><label>Organisation</label>
                  <input type="text" value={form.org} placeholder="FMoH / RHB / EPHI / Partner"
                         onChange={e => update({ org: e.target.value })} /></div>
              </div>
              <div className="field-group">
                <label>Role / job title</label>
                <input type="text" value={form.role}
                       placeholder="Programme M&amp;E officer, RHB director, Researcher"
                       onChange={e => update({ role: e.target.value })} />
              </div>
              <div className="field-group">
                <label>Dashboards requested</label>
                <div className="check-list">
                  {[
                    { v: 'internal-bi',        label: 'Internal Business Intelligence',           extra: null },
                    { v: 'infra-admin',        label: 'Infrastructure & Access Management',       extra: <span className="pill alert text-xs">privileged</span> },
                    { v: 'community-workshop', label: 'Community Workshop Portal',                extra: null },
                    { v: 'submission-portal',  label: 'Data Submission Portal',                   extra: null },
                    { v: 'research-api',       label: 'Research-tier API access',                 extra: null },
                  ].map(d => (
                    <label key={d.v}>
                      <input type="checkbox" value={d.v}
                             checked={form.dashboards.includes(d.v)}
                             onChange={e => toggleDash(d.v, e.target.checked)} />
                      <span>{d.label}</span>{d.extra}
                    </label>
                  ))}
                </div>
              </div>
              <div className="field-group">
                <label>Purpose &amp; intended use</label>
                <textarea rows={3} value={form.purpose}
                          aria-invalid={!!fieldErr.purpose}
                          placeholder="Briefly describe how you intend to use the data, your project, and the time horizon."
                          onChange={e => { update({ purpose: e.target.value }); if (fieldErr.purpose) setFieldErr(fe => ({ ...fe, purpose: undefined })); }} />
                {fieldErr.purpose && <p className="text-xs" style={{ margin: '0.25rem 0 0', color: 'var(--alert, #c0392b)' }}>{fieldErr.purpose}</p>}
              </div>
              <div className="field-group">
                <label>Supporting documentation</label>
                <input type="file" multiple />
                <p className="text-xs muted">Supervisor letter, IRB approval, project proposal, employment verification (PDF/DOCX, up to 10MB each)</p>
              </div>
              <p className="text-xs muted">
                By submitting, you accept the FMoH <a href="#">data use agreement</a> and confirm you will not redistribute restricted data.
              </p>
              {err && <p className="text-sm" role="alert" style={{ color: 'var(--alert)' }}>{err}</p>}
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={submit} disabled={busy}>
                {busy ? 'Submitting' : 'Submit request'}
              </button>
            </div>
          </>
        )}

        {submitted && (
          <>
            <div className="modal-hdr">
              <h2><svg className="ico"><use href="#i-check-circle" /></svg> Request submitted</h2>
              <p>Your request has been queued for FMoH IT review.</p>
            </div>
            <div className="modal-body">
              <div style={{ textAlign: 'center', padding: '1.2rem 0' }}>
                <span className="ico-circle tint-navy"
                      style={{ width: 64, height: 64, marginBottom: '0.6rem' }}>
                  <svg style={{ width: 32, height: 32 }}><use href="#i-mail" /></svg>
                </span>
                <p className="text-sm muted">Your tracking ID</p>
                <p style={{
                  fontFamily: 'var(--font-mono)', fontSize: '1.6rem', fontWeight: 700,
                  color: 'var(--navy-800)', letterSpacing: '0.04em',
                  margin: '0.2rem 0 0.6rem',
                }}>
                  <span>{submitted}</span>
                </p>
                <p className="text-sm muted">Keep this ID. You will receive an email confirmation, and the FMoH IT team will respond within 2 business days.</p>
              </div>

              <div style={{ background: 'var(--paper-2)', borderRadius: 'var(--radius-lg)', padding: '0.95rem 1.1rem', marginTop: '0.6rem' }}>
                <p className="text-sm" style={{ marginBottom: '0.4rem' }}><strong>What happens next</strong></p>
                <ol className="text-sm" style={{ paddingLeft: '1.2rem', color: 'var(--ink-2)', margin: 0 }}>
                  <li>A system administrator reviews your scope and supporting documents</li>
                  <li>You receive an approval or denial email with sign-in instructions</li>
                  <li>Once approved, open the dashboard you were granted from the <strong>Dashboards</strong> menu and sign in there</li>
                </ol>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={closeAll}>Close</button>
              <button className="btn btn-primary" onClick={returnToDatasets}>Return to datasets</button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}

const widget: PublicWidget = { id: 'pub-access-modal', Component: AccessRequestModal };
export default widget;
