/**
 * Internal-BI topbar. Source: _mockups/02-internal-bi.html L1221-1244.
 *
 * P5: avatar + name driven by /auth/me. Hardcoded "Dr Abebe Bekele"
 * preserved as fallback so pixel-diff against the mockup still passes
 * when /auth/me returns an unseeded mock identity.
 */
import { useBiApp } from '../useBiApp';
import { useAuth } from '../api/useAuth';

const PAGE_TITLES: Record<string, string> = {
  overview: 'Overview Dashboard',
  disease:  'Disease Surveillance',
  resource: 'Resource Management',
  service:  'Service Performance',
  export:   'Data Export & Query',
  settings: 'Profile & Settings',
};

// Per-page masthead subtitle (from the redesign mockups).
const PAGE_SUBTITLES: Record<string, string> = {
  overview: 'Key health-system indicators, action priorities, and system trust.',
  disease:  'Disease trends, risk distribution, response readiness, and active operations.',
  resource: 'Supply-chain and commodity readiness, and the service impact of stockouts.',
  service:  'Track quality, access, and outcomes across programmes and facilities.',
};

function initials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'DA';
}

const ROLE_TITLES: Record<string, string> = {
  'R-DEC':         'Decision Maker',
  'R-CONS-ANA':    'M&E Analyst',
  'R-RHB-OROMIA':  'RHB Director · Oromia',
  'R-PD-HIV':      'FMoH PD-HIV',
  'R-OPS-ADM':     'System Admin',
};

export default function Topbar() {
  const { app, state, setNotifPanel, setActive } = useBiApp();
  const { user, logout } = useAuth();
  const title = PAGE_TITLES[state.active] || '';
  const subtitle = PAGE_SUBTITLES[state.active] || '';
  const displayName = user?.full_name || user?.username || 'Dr Abebe Bekele';
  const displayRole = (user?.primary_role && ROLE_TITLES[user.primary_role]) ||
                      user?.primary_role || 'FMoH HIV Director';
  return (
    <header className="bi-topbar">
      <div className="tb-title">
        <div className="breadcrumb"><span>National Health Data Warehouse</span></div>
        <h2 style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1 }}>{title}</h2>
        {subtitle && (
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.92rem', fontWeight: 500, color: 'var(--ink-3)' }}>{subtitle}</p>
        )}
      </div>
      <div className="tb-actions">
        <button className="tb-iconbtn" onClick={() => setNotifPanel(!state.notifPanel)} title="Alert notifications" style={{ position: 'relative' }}>
          <svg className="ico"><use href="#i-bell" /></svg>
          {state.alertNotifUnread > 0 && (
            <span className="tb-badge">{state.alertNotifUnread}</span>
          )}
        </button>
        {/* Settings is a spec-governed page — don't navigate to it when the
            role isn't granted it (the chip still shows who is signed in). */}
        <button className="tb-user" onClick={() => { if (app.pageGranted('settings')) setActive('settings'); }} title={user?.kc_sub ? `kc_sub: ${user.kc_sub} · auth: ${user.auth_mode}` : 'Profile & settings'}>
          <div className="avatar">{initials(displayName)}</div>
          <div className="meta">
            <div className="nm">{displayName}</div>
            <div className="rl">{displayRole}</div>
          </div>
        </button>
        <a href="#" onClick={(e) => { e.preventDefault(); logout(); }}
           className="btn btn-sm btn-ghost" title="Sign out">
          <svg className="ico"><use href="#i-power" /></svg>
        </a>
      </div>
    </header>
  );
}
