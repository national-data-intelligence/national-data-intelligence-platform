/**
 * Widget · pub-newsroom — "What's happening" 3-card grid on the home page.
 * Re-homed verbatim from sections/Newsroom.tsx (mockup L1000-1025). Class names
 * match the mockup VERBATIM (pixel-diff). Real data via useArticles (CMS); reads
 * setPage/setArticle from the host.
 */
import { type Article } from '../../data/articles';
import { useArticles } from '../../hooks/useArticles';
import type { PublicWidget, PublicHost } from '../../runtime/types';

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
      <div className="news-grid">
        {top3.map((a, i) => (
          <button key={a.id} className="news-item" onClick={() => open(a)}>
            <span className="news-num">{String(i + 1).padStart(2, '0')}</span>
            <div className="news-meta">
              <span className="news-ico"><svg className="ico ico-sm"><use href="#i-mail" /></svg></span>
              <span className="news-cat">{a.category}</span>
              <span className="news-date">{a.date}</span>
            </div>
            <h3 className="news-title">{a.title}</h3>
            <p className="news-excerpt">{a.summary}</p>
            <span className="news-read">Read article <svg className="ico ico-sm"><use href="#i-arrow-right" /></svg></span>
          </button>
        ))}
      </div>
    </section>
  );
}

const widget: PublicWidget = { id: 'pub-newsroom', Component: Newsroom };
export default widget;
