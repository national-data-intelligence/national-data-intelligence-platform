/**
 * Widget · pub-access-modal — access-request modal (form + success view).
 * Re-homed verbatim from sections/AccessRequestModal.tsx (mockup L1472-1576).
 *
 * POSTs to /api/proxy/access-requests (FastAPI proxies to the gateway's
 * /api/public/access-requests endpoint, which returns the tracking ID).
 * Reads closeModal from the host.
 */
import { useState, useEffect } from 'react';
import { loadSiblingBases, fallbackBases, type SiblingBases } from '../../hooks/accessPoints';
import type { PublicWidget, PublicHost } from '../../runtime/types';

type AccessForm = {
  name: string; email: string; phone: string; org: string; role: string;
  dashboards: string[]; purpose: string;
  // P6: pre-filled by the "Verify with Fayda" popup. Sent through to the
  // backend so the admin queue can render a verified-Fayda badge.
  fayda_id: string;
  verified_via: '' | 'fayda';
};

const EMPTY: AccessForm = {
  name: '', email: '', phone: '', org: '', role: '', dashboards: [], purpose: '',
  fayda_id: '', verified_via: '',
};

function AccessRequestModal({ host }: { host: PublicHost }) {
  const onClose = host.closeModal;
  const [form, setForm] = useState<AccessForm>(EMPTY);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>('');
  const [verifying, setVerifying] = useState(false);
  // Admin-queue "View in admin queue" link — resolved from /api/access-points so
  // it points at the admin dashboard's nip.io Ingress host, not compile-time
  // localhost. Seeded with the same-origin fallback, refined on load.
  const [bases, setBases] = useState<SiblingBases>(fallbackBases);
  useEffect(() => { loadSiblingBases().then(setBases); }, []);

  // P6: listen for the Fayda popup's postMessage and pre-fill the form.
  useEffect(() => {
    const handler = (evt: MessageEvent) => {
      const m = (evt.data ?? {}) as { type?: string; payload?: any };
      if (m.type !== 'nhdw:fayda-verify') return;
      setVerifying(false);
      const p = m.payload || {};
      if (!p.ok) { setErr(`Fayda verification failed: ${p.error || 'unknown error'}`); return; }
      setForm(f => ({
        ...f,
        name:         p.name || `${p.given_name || ''} ${p.family_name || ''}`.trim() || f.name,
        phone:        p.phone || f.phone,
        fayda_id:     p.fayda_id || '',
        verified_via: 'fayda',
      }));
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  function verifyWithFayda() {
    setErr('');
    setVerifying(true);
    const w = window.open('/auth/fayda-start', 'fayda',
      'popup,width=520,height=640,scrollbars=yes');
    if (!w) {
      setVerifying(false);
      setErr('Popup blocked. Please allow popups from this site and retry.');
      return;
    }
    // Cancel path: the user closed the popup without signing in — the
    // postMessage never arrives, so revert the button instead of leaving it
    // stuck on "Opening Fayda…". (Success also closes the popup, but the
    // message handler has already flipped verified_via by then.)
    const watch = window.setInterval(() => {
      if (w.closed) { window.clearInterval(watch); setVerifying(false); }
    }, 500);
  }

  const update = (patch: Partial<AccessForm>) => setForm(f => ({ ...f, ...patch }));
  const toggleDash = (id: string, on: boolean) =>
    update({ dashboards: on
      ? Array.from(new Set([...form.dashboards, id]))
      : form.dashboards.filter(d => d !== id) });

  const onBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const submit = async () => {
    setErr(''); setBusy(true);
    try {
      const payload: any = {
        full_name: form.name,
        email:     form.email,
        purpose:   form.purpose || 'Public dashboard access request.',
      };
      if (form.phone)     payload.phone = form.phone;
      if (form.org)       payload.org   = form.org;
      if (form.role)      payload.role  = form.role;
      if (form.dashboards.length) payload.dashboards = form.dashboards;
      // P6: include Fayda verification when present
      if (form.fayda_id)     payload.fayda_id = form.fayda_id;
      if (form.verified_via) payload.verified_via = form.verified_via;
      const r = await fetch('/api/proxy/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.detail || ('HTTP ' + r.status));
      setSubmitted(body.tracking_id);
    } catch (e: any) {
      setErr(e.message || 'submit failed');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => { setForm(EMPTY); setSubmitted(null); setErr(''); onClose(); };

  return (
    <div className="modal-bg" onClick={onBackdrop}>
      <div className="modal" style={{ maxWidth: 640 }}>

        {!submitted && (
          <>
            <div className="modal-hdr">
              <h2>Request NHDW access</h2>
              <p>Tell us who you are and what you need · response within 2 business days</p>
            </div>
            <div className="modal-body">
              {/* P6: optional Fayda verification — pre-fills name + sets verified badge */}
              <div style={{
                background: form.verified_via === 'fayda' ? 'var(--good-50, #e7f5ee)' : 'var(--paper-2)',
                border: form.verified_via === 'fayda' ? '1px solid var(--good, #1d8b5a)' : '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)', padding: '0.9rem 1.1rem',
                marginBottom: '1rem', display: 'flex', gap: '0.85rem',
                alignItems: 'center', flexWrap: 'wrap',
              }}>
                <span className="ico-circle tint-navy" style={{ flexShrink: 0 }}>
                  <svg><use href="#i-shield-check" /></svg>
                </span>
                <div style={{ flex: '1 1 12rem', minWidth: 0 }}>
                  {form.verified_via === 'fayda' ? (
                    <>
                      <p className="text-sm" style={{ margin: 0, fontWeight: 600, color: 'var(--good, #1d8b5a)' }}>
                        ✓ Fayda-verified · {form.fayda_id}
                      </p>
                      <p className="text-xs muted" style={{ margin: '0.2rem 0 0' }}>
                        Reviewers will see this badge in the admin queue. Your government-issued identity has been verified.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm" style={{ margin: 0, fontWeight: 600 }}>
                        Optional · verify your Ethiopian National ID (Fayda)
                      </p>
                      <p className="text-xs muted" style={{ margin: '0.2rem 0 0' }}>
                        Citizens can pre-verify their identity to fast-track approval. Not required for org-tier accounts.
                      </p>
                    </>
                  )}
                </div>
                {form.verified_via !== 'fayda' && (
                  <button className="btn btn-sm btn-primary" onClick={verifyWithFayda} disabled={verifying} style={{ flexShrink: 0 }}>
                    {verifying ? 'Opening Fayda…' : 'Verify with Fayda'}
                  </button>
                )}
              </div>

              <div className="grid grid-2 gap-sm">
                <div className="field-group"><label>Full name</label>
                  <input type="text" value={form.name} placeholder="Dr Tigist Bekele"
                         onChange={e => update({ name: e.target.value })} /></div>
                <div className="field-group"><label>Email</label>
                  <input type="email" value={form.email} placeholder="tigist.bekele@moh.gov.et"
                         onChange={e => update({ email: e.target.value })} /></div>
                <div className="field-group"><label>Phone</label>
                  <input type="tel" value={form.phone} placeholder="+251 911 ..."
                         onChange={e => update({ phone: e.target.value })} /></div>
                <div className="field-group"><label>Organisation</label>
                  <input type="text" value={form.org} placeholder="FMoH / RHB / EPHI / Partner"
                         onChange={e => update({ org: e.target.value })} /></div>
              </div>
              <div className="field-group">
                <label>Role / job title</label>
                <input type="text" value={form.role}
                       placeholder="Programme M&E officer, RHB director, Researcher, ..."
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
                          placeholder="Briefly describe how you intend to use the data, your project, and the time horizon..."
                          onChange={e => update({ purpose: e.target.value })} />
              </div>
              <div className="field-group">
                <label>Supporting documentation</label>
                <input type="file" multiple />
                <p className="text-xs muted">Supervisor letter, IRB approval, project proposal, employment verification (PDF/DOCX, ≤ 10MB each)</p>
              </div>
              <p className="text-xs muted">
                By submitting, you accept the FMoH <a href="#">data use agreement</a> and confirm you will not redistribute restricted data.
              </p>
              {err && <p className="text-sm" style={{ color: 'var(--alert)' }}>{err}</p>}
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={submit}
                      disabled={busy || !form.name || !form.email || !form.purpose}>
                {busy ? 'Submitting…' : 'Submit request'}
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
                <p className="text-sm muted">Keep this ID. You'll receive an email confirmation, and the FMoH IT team will respond within 2 business days.</p>
              </div>

              <div style={{ background: 'var(--paper-2)', borderRadius: 'var(--radius-lg)', padding: '0.95rem 1.1rem', marginTop: '0.6rem' }}>
                <p className="text-sm" style={{ marginBottom: '0.4rem' }}><strong>What happens next</strong></p>
                <ol className="text-sm" style={{ paddingLeft: '1.2rem', color: 'var(--ink-2)', margin: 0 }}>
                  <li>Your request lands in the <strong>Infrastructure &amp; Access Management</strong> queue</li>
                  <li>A system administrator reviews scope &amp; supporting documents</li>
                  <li>You receive an approval/denial email with sign-in instructions</li>
                  <li>Approved? Open the dashboard you were granted from the <strong>Dashboards</strong> menu and sign in there</li>
                </ol>
              </div>

              <div style={{
                marginTop: '1rem', padding: '0.95rem 1.1rem',
                background: 'var(--paper-2)', borderRadius: 'var(--radius-lg)',
                color: 'var(--ink-2)', boxShadow: 'var(--shadow-1)',
                display: 'flex', gap: '0.85rem', alignItems: 'flex-start', flexWrap: 'wrap',
              }}>
                <span className="ico-circle tint-watch"><svg><use href="#i-info" /></svg></span>
                <div style={{ flex: '1 1 12rem', minWidth: 0 }}>
                  <p className="text-xs" style={{ fontWeight: 600, marginBottom: '0.2rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Demo mockup</p>
                  <p className="text-sm" style={{ margin: 0, color: 'var(--ink-2)' }}>
                    Since this is a design mockup, you can <strong>preview the admin side</strong> and
                    see your request appear in the IT operations queue in real-time.
                  </p>
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={reset}>Close</button>
              <a className="btn btn-primary"
                 href={`${bases.admin}/?new_request=${submitted}`}>
                <svg className="ico"><use href="#i-shield" /></svg> View in admin queue (demo) <svg className="ico"><use href="#i-arrow-right" /></svg>
              </a>
            </div>
          </>
        )}

      </div>
    </div>
  );
}

const widget: PublicWidget = { id: 'pub-access-modal', Component: AccessRequestModal };
export default widget;
