/**
 * Widget · pub-footer — site footer. Re-homed verbatim from sections/Footer.tsx
 * (mockup L1355-1368). Persistent chrome (CHROME_BOTTOM); takes nothing from the
 * host.
 */
import type { PublicWidget } from '../../runtime/types';

function Footer() {
  return (
    <footer className="foot">
      <div className="foot-inner">
        <div className="foot-brand">
          <img className="foot-logo" src="/static/assets/logo-fmoh.png" alt="" aria-hidden={true} />
          <div>
            <strong>National Health Data Warehouse · NHDW</strong><br />
            Federal Ministry of Health · Federal Democratic Republic of Ethiopia<br />
            <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.72)' }}>
              Established 2026
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
          <div>
            <strong style={{ color: '#fff' }}>About</strong><br />
            <a href="#">Methodology</a><br />
            <a href="#">Governance</a><br />
            <a href="#">Contact</a>
          </div>
          <div>
            <strong style={{ color: '#fff' }}>Open</strong><br />
            <a href="#">API docs</a><br />
            <a href="#">dbt docs</a><br />
            <a href="#">Code repository</a>
          </div>
          <div>
            <strong style={{ color: '#fff' }}>Legal</strong><br />
            <a href="#">Privacy notice</a><br />
            <a href="#">Terms of use</a><br />
            <a href="#">Data licence</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

const widget: PublicWidget = { id: 'pub-footer', Component: Footer };
export default widget;
