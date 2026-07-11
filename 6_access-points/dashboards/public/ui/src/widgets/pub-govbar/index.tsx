/**
 * Widget · pub-govbar — Government top bar (2-tier utility + brand+nav).
 * Re-homed verbatim from sections/GovBar.tsx (mockup L887-909); reads
 * active/setPage/openModal from the host. Persistent chrome (CHROME_TOP).
 */
import type { PublicWidget, PublicHost } from '../../runtime/types';

function GovBar({ host }: { host: PublicHost }) {
  const { active, setPage, openModal } = host;
  return (
    <>
      <a href="#main" className="gov-skip">Skip to content</a>
      <header className="gov">
        <div className="gov-row">
          <a
            href="#"
            className="gov-mark"
            onClick={(e) => { e.preventDefault(); setPage('home'); }}
          >
            <img className="gov-mark-logo" src="/static/assets/logo-fmoh.png" alt="" aria-hidden={true} />
            <span className="gov-mark-text">NHDW</span>
            <span className="gov-mark-tag">Federal Ministry of Health · Ethiopia</span>
          </a>

          <nav className="gov-nav" aria-label="Primary">
            <a
              href="#"
              className={active === 'home' ? 'active' : undefined}
              onClick={(e) => { e.preventDefault(); setPage('home'); }}
            >Home</a>
            <a
              href="#"
              className={active === 'data' ? 'active' : undefined}
              onClick={(e) => { e.preventDefault(); setPage('data'); }}
            >Open data</a>
            <a
              href="#"
              className={(active === 'articles' || active === 'article') ? 'active' : undefined}
              onClick={(e) => { e.preventDefault(); setPage('articles'); }}
            >Articles</a>
          </nav>

          <div className="gov-cta">
            <button className="gov-link" onClick={() => openModal('access')}>Request access</button>
            <button className="gov-signin" onClick={() => openModal('dashboards')}>Dashboards</button>
          </div>
        </div>
      </header>
    </>
  );
}

const widget: PublicWidget = { id: 'pub-govbar', Component: GovBar };
export default widget;
