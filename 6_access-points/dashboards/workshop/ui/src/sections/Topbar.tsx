/**
 * Workshop topbar — spec-driven page title, the Request-compute action
 * (opens the compute-request ModalDef through the runtime modal host), and
 * the now-WIRED "Open JupyterLab" affordance:
 *
 *   GET  /gw/workspace/status → running       → link to the lab url
 *                             → not configured → honestly DISABLED, the
 *                               backend reason verbatim as the title
 *                             → not running   → click spawns
 *                               (POST /gw/workspace/spawn) then re-checks
 *
 * User chip + sign-out from /auth/me (useAuth), as before.
 */
import { useCallback, useEffect, useState } from 'react';
import { authFetch, useAuth } from '../api/useAuth';
import { host } from '../runtime/host';

type LabState =
  | { kind: 'checking' }
  | { kind: 'running'; url: string | null }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'stopped'; reason?: string }
  | { kind: 'spawning' };

function initials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'NH';
}

export default function Topbar({ pageTitle }: { pageTitle: string }) {
  const { user, logout } = useAuth();
  const [lab, setLab] = useState<LabState>({ kind: 'checking' });

  const displayName = user?.full_name || user?.username || '';
  const displayRole = user?.primary_role === 'R-CONS-SCI' ? 'Researcher'
                    : user?.primary_role === 'R-CONS-RES' ? 'External researcher'
                    : user?.primary_role || '';

  const checkStatus = useCallback(async (): Promise<LabState> => {
    try {
      const r = await authFetch('/gw/workspace/status');
      if (!r.ok) return { kind: 'stopped', reason: `workspace status HTTP ${r.status}` };
      const st = await r.json();
      if (st.running) return { kind: 'running', url: st.url || st.server || null };
      if (/not configured/i.test(st.reason || '')) return { kind: 'unavailable', reason: st.reason };
      return { kind: 'stopped', reason: st.reason || undefined };
    } catch {
      return { kind: 'stopped', reason: 'workspace status unreachable' };
    }
  }, []);

  useEffect(() => {
    let stale = false;
    checkStatus().then(s => { if (!stale) setLab(s); });
    return () => { stale = true; };
  }, [checkStatus]);

  async function spawnLab() {
    setLab({ kind: 'spawning' });
    try {
      const r = await authFetch('/gw/workspace/spawn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        setLab({ kind: 'stopped', reason: `spawn failed: ${r.status} ${body.slice(0, 160)}` });
        return;
      }
      const body = await r.json().catch(() => ({} as any));
      if (body?.url) { window.open(body.url, '_blank', 'noreferrer'); }
      setLab(await checkStatus());
    } catch (e: any) {
      setLab({ kind: 'stopped', reason: `spawn failed: ${e?.message || String(e)}` });
    }
  }

  return (
    <header className="ws-topbar">
      <div className="tb-title">
        <div className="breadcrumb">
          <span>Workshop</span>
          <svg className="ico" style={{ width: '11px', height: '11px', opacity: 0.55 }}><use href="#i-arrow-right" /></svg>
          <span>{pageTitle}</span>
        </div>
        <h2>{pageTitle}</h2>
      </div>

      <div className="tb-actions">
        <button
          className="tb-compute"
          type="button"
          onClick={() => host.openModal('compute-request')}
          title="Request a compute allocation for your workspace"
        >
          <svg className="ico"><use href="#i-server" /></svg>
          Request compute
        </button>

        {lab.kind === 'running' && lab.url ? (
          <a className="tb-jupyter" href={lab.url} target="_blank" rel="noreferrer"
             title="Your JupyterLab pod is running — open it">
            <svg className="ico"><use href="#i-external" /></svg>
            Open JupyterLab
          </a>
        ) : lab.kind === 'unavailable' ? (
          <span
            className="tb-jupyter"
            title={lab.reason}
            style={{ opacity: 0.45, cursor: 'not-allowed' }}
            aria-disabled="true"
          >
            <svg className="ico"><use href="#i-arrow-right" /></svg>
            Open JupyterLab
          </span>
        ) : lab.kind === 'checking' || lab.kind === 'spawning' ? (
          <span
            className="tb-jupyter"
            title={lab.kind === 'checking' ? 'Checking workspace status…' : 'Spawning your lab pod…'}
            style={{ opacity: 0.6, cursor: 'progress' }}
            aria-disabled="true"
          >
            <svg className="ico"><use href="#i-refresh" /></svg>
            {lab.kind === 'checking' ? 'Checking lab…' : 'Starting lab…'}
          </span>
        ) : (
          <a href="#" className="tb-jupyter"
             onClick={(e) => { e.preventDefault(); void spawnLab(); }}
             title={lab.kind === 'stopped' && lab.reason
               ? `Lab not running (${lab.reason}) — click to spawn`
               : 'Spawn your JupyterLab pod'}>
            <svg className="ico"><use href="#i-play" /></svg>
            Open JupyterLab
          </a>
        )}

        <button className="tb-user" type="button" title={user?.kc_sub ? `kc_sub: ${user.kc_sub} · auth: ${user.auth_mode}` : undefined}>
          <span className="avatar">{initials(displayName)}</span>
          <span className="meta">
            <span className="nm">{displayName}</span>
            {' '}
            <span className="rl">{displayRole}</span>
          </span>
        </button>
        <a href="#" onClick={(e) => { e.preventDefault(); logout(); }} className="tb-signout" title="Sign out">
          <svg className="ico ico-sm"><use href="#i-power" /></svg>
        </a>
      </div>
    </header>
  );
}
