/**
 * Admin topbar. Source: _mockups/03-infra-admin.html L878-904.
 *
 * P3d: avatar + name now come from /auth/me (works in dev_auth, bearer,
 * and cookie modes). Sign-out kicks off Keycloak end-session when in
 * prod, just reloads in dev.
 */
import { useAdminApp } from '../useAdminApp';
import { useAuth } from '../api/useAuth';

function initials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '??';
}

export default function Topbar() {
  const { state } = useAdminApp();
  const { user, cfg, login, logout } = useAuth();
  const displayName = user?.full_name || user?.username || 'Anonymous';
  const displayRole = user?.primary_role || '—';
  const authMode = user?.auth_mode || 'dev';

  return (
    <header className="admin-topbar">
      <div className="tb-title">
        <div className="breadcrumb">
          <span>Admin</span>
          <svg className="ico" style={{ width: '11px', height: '11px', opacity: 0.55 }}><use href="#i-arrow-right" /></svg>
          <span>{state.navGroup}</span>
        </div>
        <h2>{state.pageTitle || 'Health & topology'}</h2>
      </div>

      <div className="tb-actions">
        <span className="tb-status" title={`Auth mode: ${authMode}${cfg && !cfg.dev_auth ? ` (realm ${cfg.realm})` : ''}`}>
          <span className="tb-status-dot"></span>
          {authMode === 'dev' ? 'DEV auth · cluster ok' : `Bearer · ${cfg?.realm || REALM_FALLBACK}`}
        </span>
        <button className="tb-user" type="button" title={user ? `kc_sub: ${user.kc_sub}` : undefined}>
          <span className="avatar">{initials(displayName)}</span>
          <span className="meta">
            <span className="nm">{displayName}</span>
            {' '}
            <span className="rl">{displayRole}</span>
          </span>
        </button>
        {cfg?.dev_auth === false && !user?.authenticated ? (
          <button className="btn btn-sm btn-primary" onClick={login} title="Sign in with Keycloak">
            Sign in
          </button>
        ) : (
          <a href="#" onClick={(e) => { e.preventDefault(); logout(); }} className="tb-signout" title="Sign out">
            <svg className="ico ico-sm"><use href="#i-power" /></svg>
          </a>
        )}
      </div>
    </header>
  );
}

const REALM_FALLBACK = 'privileged-ops';
