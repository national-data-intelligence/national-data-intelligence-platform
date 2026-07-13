/**
 * Widget · pub-newsroom — "What's happening" 3-card grid on the home page.
 *
 * Design (2026-07-13 elegance/symmetry pass): the home news cards now speak the
 * SAME card language as the Articles page grid (widgets/pub-articles) — borderless
 * soft cards, a muted category tag, a Cormorant serif headline, a "Read more →"
 * affordance — so a bulletin looks identical wherever it appears. The formatting
 * helpers are COPIED (repetition over shared coupling, per the house rule), not
 * imported. Real data via useArticles (CMS); reads setPage/setArticle from the host.
 */
import { type Article } from '../../data/articles';
import { useArticles } from '../../hooks/useArticles';
import type { PublicWidget, PublicHost } from '../../runtime/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Jun 2026" from an ISO date; falls back to the raw value. */
function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : iso;
}

/** Plain-text excerpt from an article body (strips HTML). */
function excerpt(html: string, max = 150): string {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

/** Restrained category tint (class only; colours live in CSS) — mirrors pub-articles. */
function catTone(category: string): string {
  const k = category.toLowerCase();
  if (/outbreak|alert|advis|warn/.test(k)) return 'warn';
  if (/phem|surveil|epidem/.test(k)) return 'teal';
  if (/research|study|program/.test(k)) return 'plum';
  return 'navy';
}

function Newsroom({ host }: { host: PublicHost }) {
  const { setPage, setArticle } = host;
  const open = (a: Article) => { setArticle(a); setPage('article'); };
  const top3 = useArticles().slice(0, 3);

  return (
    <section id="news" className="page-section page-section--news">
      <div className="ins-hdr ins-hdr--news">
        <p className="ins-eyebrow"><span className="ins-rule"></span> Latest · news &amp; bulletins</p>
        <div className="ins-titlebar">
          <h2 className="ins-h2">What's happening</h2>
          <button className="btn-seeall" onClick={() => setPage('articles')}>
            See all articles <svg className="ico ico-sm"><use href="#i-arrow-right" /></svg>
          </button>
        </div>
        <p className="ins-sub">Weekly bulletins from PHEM, official press releases from FMoH, and public-health advisories, most recent first.</p>
      </div>
      <div className="nw-grid">
        {top3.map((a) => (
          <article key={a.id} className="nw-card">
            <button className="nw-card-btn" onClick={() => open(a)}>
              <span className="nw-card-top">
                <span className={`nw-tag nw-tag--${catTone(a.category)}`}>{a.category}</span>
                <span className="nw-date">{fmtDate(a.date)}</span>
              </span>
              <h3 className="nw-card-title">{a.title}</h3>
              <p className="nw-card-dek">{a.summary || excerpt(a.body)}</p>
              <span className="nw-card-read">Read more <svg className="ico"><use href="#i-arrow-right" /></svg></span>
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

const widget: PublicWidget = { id: 'pub-newsroom', Component: Newsroom };
export default widget;
