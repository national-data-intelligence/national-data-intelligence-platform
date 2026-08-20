/**
 * Internal-BI sidebar. Source: _mockups/02-internal-bi.html L1188-1215.
 *
 * P5: nav items filtered by the resolved dashboard spec — pages the
 * role can't access are hidden from the nav. Falls back to showing all
 * 5 pages when the spec isn't loaded yet, preserving pixel-diff parity
 * for the default R-OPS-ADM dev user (who can see everything).
 */
import { useBiApp } from '../useBiApp';
import { useDashboardSpec } from '../api/spec';

const PAGES = [
  { id: 'overview', ico: 'i-grid',       title: 'Overview',           page_id: 'internal-bi/overview' },
  { id: 'disease',  ico: 'i-alert',      title: 'Disease Surveillance', page_id: 'internal-bi/disease' },
  { id: 'resource', ico: 'i-package',    title: 'Resource Management', page_id: 'internal-bi/resource' },
  { id: 'control-tower', ico: 'i-truck', title: 'Supply Control Tower', page_id: 'internal-bi/control-tower' },
  { id: 'service',  ico: 'i-chart-line', title: 'Service Performance', page_id: 'internal-bi/service' },
  { id: 'export',   ico: 'i-upload',     title: 'Data Export & Query', page_id: 'internal-bi/export' },
];

export default function Sidebar() {
  const { state, setActive } = useBiApp();
  const { spec, loaded } = useDashboardSpec('internal-bi');

  // Spec hasn't loaded yet → show all (legacy fallback). Once loaded,
  // hide pages the role doesn't appear in. The resolver now ELIDES any page
  // with zero visible content sections (#52 page-tab elision in
  // permissions.resolve_dashboard), so a page present in spec.pages is
  // guaranteed to have visible content — this presence filter is exact.
  const visiblePageIds = loaded && spec
    ? new Set(spec.pages.map(p => p.id))
    : null;

  const visible = visiblePageIds
    ? PAGES.filter(p => visiblePageIds.has(p.page_id))
    : PAGES;

  return (
    <aside className="bi-sidebar">
      <div className="bi-sidehead">
        <a href="/">
          <img src="/static/assets/logo-fmoh.png" alt="NHDW" className="sidehead-logo" />
          <div className="sidehead-text">
            <div className="title">NHDW</div>
            <div className="subtitle">Internal BI</div>
          </div>
        </a>
      </div>

      <nav className="bi-nav" style={{ marginTop: '1rem' }}>
        {visible.map(p => (
          <a key={p.id} className={state.active === p.id ? 'active' : undefined} onClick={() => setActive(p.id)}>
            <svg className="ico"><use href={'#' + p.ico} /></svg>
            <span>{p.title}</span>
          </a>
        ))}
      </nav>

      {/* Static product identity only — no fabricated liveness/build claims. */}
      <div className="bi-sidebar-foot">
        <strong>NHDW v1.0</strong> · PROD<br />
        <span>National Health Data Warehouse</span>
      </div>
    </aside>
  );
}
