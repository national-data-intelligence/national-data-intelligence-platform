/**
 * Workshop footer. Source: _mockups/04-workshop.html L1982-1995.
 *
 * The community Code of Conduct — formerly a prominent full-width strip above
 * the footer (ConductStrip, archived 2026-07-05) — now lives here as a compact,
 * low-key row so the guidance stays visible without dominating every page.
 */
export default function Footer() {
  return (
    <footer className="foot">
      <div className="foot-inner">
        <div>
          <strong>Community Workshop Portal · NHDW</strong><br />
          Federal Ministry of Health · Federal Democratic Republic of Ethiopia<br />
          <span className="foot-byline">For researchers, developers, partners, and the open public</span>
        </div>
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
          <div><strong>Learn</strong><br /><a href="#tutorials">Tutorials</a><br /><a href="#workshops">Workshops</a><br /><a href="#openfn">OpenFn</a></div>
          <div><strong>Build</strong><br /><a href="#datasets">Datasets</a><br /><a href="#">API docs</a><br /><a href="#">Code repo</a></div>
          <div><strong>Connect</strong><br /><a href="#community">Discussions</a><br /><a href="#mentorship">Mentorship</a><br /><a href="/">← Public site</a></div>
        </div>
      </div>
      <div className="foot-coc">
        <svg className="ico"><use href="#i-policy" /></svg>
        <span>
          Contribute responsibly. Personal data — even when k-anonymised — must be handled with care and never combined with other sources to re-identify individuals.
        </span>
        <a href="#coc"><svg className="ico"><use href="#i-policy" /></svg> Code of conduct</a>
        <a href="#data-use"><svg className="ico"><use href="#i-list" /></svg> Data use agreement</a>
      </div>
    </footer>
  );
}
