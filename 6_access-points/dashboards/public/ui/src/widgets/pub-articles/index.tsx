/**
 * Widget · pub-articles — Articles "newsroom" list page.
 *
 * Design (2026-07-08 reimagining): one editorial LEAD (the newest article)
 * over a quiet two-column index — no boxy cards, no per-item deks. Inline
 * filter bar replaces the facet sidebar. Real data via useArticles (CMS);
 * reads setPage/setArticle from the host.
 */
import { useMemo, useState } from 'react';
import { ARTICLE_CATEGORIES, type Article } from '../../data/articles';
import { useArticles } from '../../hooks/useArticles';
import type { PublicWidget, PublicHost } from '../../runtime/types';

type Sort = 'newest' | 'oldest' | 'az';
const PAGE_SIZE = 7;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Jun 2026" from an ISO date; falls back to the raw value. */
function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : iso;
}

/** Plain-text excerpt from an article body (strips HTML) — only the lead uses it. */
function excerpt(html: string, max = 200): string {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

/** A quiet, monochrome section glyph per article category — an editorial marker,
 *  not a colourful badge. Stroke paths on a 24×24 grid; unknown → generic doc. */
function CatGlyph({ category }: { category: string }) {
  const k = category.toLowerCase();
  const path =
    k.includes('phem') || k.includes('surveill')
      ? 'M3 12h4l2-6 4 12 2-6h6'                                   // pulse / surveillance
    : k.includes('press') || k.includes('news')
      ? 'M4 5h13v13a1 1 0 001 1 1 1 0 001-1V8h1 M4 5v13a1 1 0 001 1h13 M7 9h7 M7 13h7'  // newspaper
    : k.includes('advis') || k.includes('alert') || k.includes('warn')
      ? 'M12 3l9 16H3z M12 10v4 M12 16.5h.01'                       // advisory / warning
    : k.includes('research') || k.includes('study')
      ? 'M9 3h6 M10 3v6l-5 8.5A2 2 0 007 21h10a2 2 0 001.9-2.5L14 9V3'  // research / flask
    : k.includes('program')
      ? 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5'                          // programme / layers
      : 'M6 3h8l4 4v14H6z M14 3v4h4';                               // generic document
  return (
    <svg className="nw-cat-ico" viewBox="0 0 24 24" aria-hidden="true"
         fill="none" stroke="currentColor" strokeWidth={1.6}
         strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

function Articles({ host }: { host: PublicHost }) {
  const { setPage, setArticle } = host;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [sort, setSort] = useState<Sort>('newest');
  const [page, setPageNum] = useState(0);
  const ART = useArticles();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ART
      .filter(a => category === 'all' || a.category === category)
      .filter(a => !q
                || a.title.toLowerCase().includes(q)
                || a.summary.toLowerCase().includes(q)
                || a.body.toLowerCase().includes(q)
                || a.category.toLowerCase().includes(q)
                || a.tags.some(t => t.toLowerCase().includes(q)))
      .sort((a, b) => {
        if (sort === 'newest') return b.date.localeCompare(a.date);
        if (sort === 'oldest') return a.date.localeCompare(b.date);
        if (sort === 'az')     return a.title.localeCompare(b.title);
        return 0;
      });
  }, [ART, query, category, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // On the first page (with enough results) the newest item runs as an
  // editorial lead; the remainder fill the quiet two-column index.
  const showLead = page === 0 && filtered.length > 2;
  const lead = showLead ? paged[0] : null;
  const rest = showLead ? paged.slice(1) : paged;

  const open = (a: Article) => { setArticle(a); setPage('article'); };
  const clear = () => { setQuery(''); setCategory('all'); setPageNum(0); };

  return (
    <>
      <section className="page-banner">
        <div className="pgh">
          <p className="pgh-eyebrow">News &amp; Bulletins</p>
          <h1 className="pgh-title">Newsroom</h1>
          <p className="pgh-sub">Weekly surveillance reports, advisories and press from the Ministry.</p>
        </div>
      </section>

      <section className="page-section">
        <div className="nw">
          <div className="od-bar">
            <span className="od-search">
              <svg className="ico"><use href="#i-search" /></svg>
              <input
                type="text"
                placeholder="Search the newsroom"
                aria-label="Search the newsroom"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPageNum(0); }}
              />
            </span>

            <div className="od-seg" role="group" aria-label="Category">
              {(['all', ...ARTICLE_CATEGORIES] as const).map(c => (
                <button key={c} className={category === c ? 'is-on' : ''}
                        onClick={() => { setCategory(c); setPageNum(0); }}>
                  {c === 'all' ? 'All' : c}
                </button>
              ))}
            </div>

            <div className="od-controls">
              <span className="od-field">
                <label htmlFor="nw-sort">Sort</label>
                <select id="nw-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="az">Title A–Z</option>
                </select>
              </span>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="od-empty">
              <svg className="ico" style={{ width: 28, height: 28, color: 'var(--ink-4)' }}><use href="#i-search" /></svg>
              <p>No articles match the current filters.</p>
              <button className="od-foot-link" onClick={clear}>Clear filters</button>
            </div>
          ) : (
            <>
              {lead && (
                <button className="nw-lead" onClick={() => open(lead)}>
                  <span className="nw-kicker">
                    <CatGlyph category={lead.category} />
                    <span className="nw-flag">Featured</span>
                    <span className="sep">·</span><span className="nw-cat">{lead.category}</span>
                    <span className="sep">·</span><span className="nw-date">{fmtDate(lead.date)}</span>
                  </span>
                  <h2 className="nw-lead-title">{lead.title}</h2>
                  <p className="nw-lead-dek">{lead.summary || excerpt(lead.body)}</p>
                  <span className="nw-lead-read">Read the full bulletin <svg className="ico"><use href="#i-arrow-right" /></svg></span>
                </button>
              )}

              <ol className="nw-list">
                {rest.map(a => (
                  <li key={a.id} className="nw-item">
                    <button onClick={() => open(a)}>
                      <span className="nw-kicker">
                        <CatGlyph category={a.category} />
                        <span className="nw-cat">{a.category}</span>
                        <span className="sep">·</span><span className="nw-date">{fmtDate(a.date)}</span>
                      </span>
                      <h3 className="nw-item-title">{a.title}</h3>
                      <span className="nw-item-read">Read <svg className="ico"><use href="#i-arrow-right" /></svg></span>
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}

          {totalPages > 1 && (
            <div className="nw-pager">
              <button disabled={page === 0} onClick={() => setPageNum(p => p - 1)}>‹ Prev</button>
              <span>Page {page + 1} of {totalPages}</span>
              <button disabled={page >= totalPages - 1} onClick={() => setPageNum(p => p + 1)}>Next ›</button>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

const widget: PublicWidget = { id: 'pub-articles', Component: Articles };
export default widget;
