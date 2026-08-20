/**
 * Widget · pub-hero — orbital dot-globe + masthead + CTAs (fullBleed).
 * Globe canvas is wired by hooks/heroGlobe on mount. A darkening gradient at the
 * hero's lower edge (`.hero::after`) settles it into the content surface; the old
 * magazine bottom strip was removed. Reads setPage from the host.
 */
import { useEffect, useRef } from 'react';
import type { PublicWidget, PublicHost } from '../../runtime/types';
import { heroGlobe } from '../../hooks/heroGlobe';

function Hero({ host }: { host: PublicHost }) {
  const { setPage } = host;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) heroGlobe(canvasRef.current);
  }, []);

  return (
    <section className="hero">
      {/* Background composition · ambient grid + orbiting dot-globe */}
      <div className="hero-bg" aria-hidden={true}>
        <div className="hero-grid"></div>
        <div className="hero-art">
          <div className="hero-rings">
            <div className="hr-ring r1"></div>
            <div className="hr-ring r2"></div>
            <div className="hr-ring r3"></div>
            <div className="hr-ring r4"></div>
            <div className="hr-ring r5"></div>
            <div className="hr-ring r6"></div>
            <div className="hr-ring r7"></div>
          </div>
          <canvas id="hero-globe" ref={canvasRef} className="hero-globe"></canvas>
        </div>
      </div>

      {/* Magazine-style top strip · masthead microcopy */}
      <div className="hero-strip hero-strip--top">
        <div className="hero-strip-inner">
          <span className="hs-lhs">
            <span className="hs-key">Vol. 01</span>
            <span className="hs-sep">/</span>
            <span className="hs-key">Public Series</span>
          </span>
          <span className="hs-rhs">
            <span>Federal Ministry of Health · የጤና ሚኒስቴር</span>
          </span>
        </div>
      </div>

      <div className="hero-inner">
        <p className="hero-eyebrow">
          <span className="hero-rule" aria-hidden={true}></span>
          <span>Public health information service</span>
        </p>

        <h1 className="hero-h1">
          <span>Ethiopia's health data,</span> <span className="h1-accent">in one place.</span>
        </h1>
        <p className="hero-h1-am" lang="am">የብሔራዊ የጤና መረጃ ማከማቻ</p>

        <p className="hero-lede">
          A single trusted entrance to dashboards, open data, and the analytic consoles
          that power public-health decisions, from a national bulletin down to a single
          woreda in any of the 14&nbsp;regions.
        </p>

        {/* Trust ribbon — the governance posture is the credibility, not fine print. */}
        <p className="hero-trust"
           title="Aggregate and privacy-protected, k-anonymity at least 5, sourced from national health systems">
          <svg className="ico ico-sm"><use href="#i-shield-check"/></svg>
          Privacy-protected national health data
        </p>

        <div className="hero-actions">
          <button className="btn-cta-primary" onClick={() => setPage('data')}>
            Open the data catalogue
            <svg className="ico ico-sm"><use href="#i-arrow-right"/></svg>
          </button>
          <button className="btn-cta-secondary" onClick={() => setPage('articles')}>
            Read the latest bulletins
            <svg className="ico ico-sm"><use href="#i-arrow-right"/></svg>
          </button>
        </div>
      </div>
    </section>
  );
}

const widget: PublicWidget = { id: 'pub-hero', fullBleed: true, Component: Hero };
export default widget;
