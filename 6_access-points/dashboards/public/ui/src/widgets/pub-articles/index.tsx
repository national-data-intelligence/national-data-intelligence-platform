/**
 * Widget · pub-articles — Articles "newsroom" (page "articles").
 *
 * Design (2026-07-13 reimagining, ref 01_57_35): a featured LEAD hero (a small
 * carousel over the latest bulletins) → a filter row (search · category · topic
 * · date range · sort) → a three-column card GRID → numbered pagination. Real
 * data via useArticles (CMS); reads setPage/setArticle from the host. NHDW navy
 * palette; borderless soft cards, restrained semantic tints on category tags.
 */
import { useMemo, useState } from 'react';
import { ARTICLE_CATEGORIES, type Article } from '../../data/articles';
import { useArticles } from '../../hooks/useArticles';
import type { PublicWidget, PublicHost } from '../../runtime/types';

type Sort = 'newest' | 'oldest' | 'az';
type Range = 'all' | '30' | '90' | 'year';
const PAGE_SIZE = 6;
const FEATURED = 5;

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

/** Restrained semantic tint per category tag — navy by default; a warm tone for
 *  advisories/outbreaks, a teal for surveillance/PHEM. Class only; colours live in CSS. */
function catTone(category: string): string {
  const k = category.toLowerCase();
  if (/outbreak|alert|advis|warn/.test(k)) return 'warn';
  if (/phem|surveil|epidem/.test(k)) return 'teal';
  if (/research|study|program/.test(k)) return 'plum';
  return 'navy';
}

/** Days between an ISO date and today (approximate; used by the date-range filter). */
function ageDays(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 86_400_000;
}

/** Faint decorative illustration for the hero — an abstract administrative
 *  region-map (adjacent cells with one highlighted woreda), a small chart card
 *  and a health-cross tile. Pure navy/slate tints, no external asset. */
function HeroArt() {
  return (
    <svg className="nw-hero-art" viewBox="0 0 340 250" aria-hidden="true" fill="none">
      {/* region map — adjacent administrative cells sharing borders */}
      <g stroke="var(--navy-500)" strokeWidth="1.3" strokeLinejoin="round" opacity="0.42">
        <path d="M168 30 218 46 226 82 190 100 160 86Z" fill="var(--navy-50)" />
        <path d="M218 46 268 74 270 112 226 82Z" fill="var(--navy-50)" />
        <path d="M226 82 270 112 256 158 212 150 190 100Z" fill="rgba(100,116,139,0.14)" />
        <path d="M160 86 190 100 212 150 182 184 146 168Z" fill="var(--navy-50)" />
        <path d="M146 168 182 184 172 222 128 216 120 180Z" fill="var(--navy-50)" />
        <path d="M120 108 160 86 146 168 120 180 96 138Z" fill="var(--navy-50)" />
        <path d="M120 108 168 30 160 86Z" fill="var(--navy-50)" />
      </g>
      {/* highlighted woreda marker */}
      <circle cx="236" cy="118" r="14" fill="var(--navy-500)" opacity="0.15" />
      <circle cx="236" cy="118" r="6.5" fill="var(--navy-700)" opacity="0.9" />
      {/* small analytics card, floating over the map */}
      <g>
        <rect x="30" y="98" width="94" height="70" rx="12" fill="#fff" stroke="var(--border-2)" strokeWidth="1.1" />
        <rect x="44" y="108" width="46" height="6" rx="3" fill="var(--navy-500)" opacity="0.3" />
        <rect x="44" y="142" width="11" height="14" rx="2.5" fill="var(--navy-500)" opacity="0.5" />
        <rect x="61" y="132" width="11" height="24" rx="2.5" fill="var(--navy-500)" opacity="0.66" />
        <rect x="78" y="120" width="11" height="36" rx="2.5" fill="var(--navy-700)" opacity="0.85" />
        <rect x="95" y="136" width="11" height="20" rx="2.5" fill="var(--navy-500)" opacity="0.52" />
      </g>
      {/* health-cross tile, floating */}
      <g transform="translate(236 170)">
        <rect x="0" y="0" width="52" height="52" rx="14" fill="#fff" stroke="var(--border-2)" strokeWidth="1.1" />
        <path d="M21 12h10v9h9v10h-9v9H21v-9h-9V21h9z" fill="var(--navy-600)" opacity="0.9" />
      </g>
    </svg>
  );
}

function Articles({ host }: { host: PublicHost }) {
  const { setPage, setArticle } = host;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [topic, setTopic] = useState<string>('all');
  const [range, setRange] = useState<Range>('all');
  const [sort, setSort] = useState<Sort>('newest');
  const [page, setPageNum] = useState(0);
  const [featIdx, setFeatIdx] = useState(0);
  const ART = useArticles();

  // Featured carousel = the newest few, independent of the browse filters below.
  const featured = useMemo(
    () => [...ART].sort((a, b) => b.date.localeCompare(a.date)).slice(0, FEATURED),
    [ART]);
  const feat = featured[featIdx % Math.max(1, featured.length)] || null;

  const topics = useMemo(
    () => Array.from(new Set(ART.flatMap(a => a.tags.map(t => t.trim()).filter(Boolean)))).sort(),
    [ART]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ART
      .filter(a => category === 'all' || a.category === category)
      .filter(a => topic === 'all' || a.tags.map(t => t.trim()).includes(topic))
      .filter(a => range === 'all'
                || (range === '30' && ageDays(a.date) <= 30)
                || (range === '90' && ageDays(a.date) <= 90)
                || (range === 'year' && (a.date || '').slice(0, 4) === String(new Date().getFullYear())))
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
  }, [ART, query, category, topic, range, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const open = (a: Article) => { setArticle(a); setPage('article'); };
  const clear = () => { setQuery(''); setCategory('all'); setTopic('all'); setRange('all'); setPageNum(0); };
  const onAnyFilter = () => setPageNum(0);

  // Numbered pager with an ellipsis when there are many pages (1 … n).
  const pageList: (number | '…')[] = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i);
    const out: (number | '…')[] = [0];
    const lo = Math.max(1, page - 1), hi = Math.min(totalPages - 2, page + 1);
    if (lo > 1) out.push('…');
    for (let i = lo; i <= hi; i++) out.push(i);
    if (hi < totalPages - 2) out.push('…');
    out.push(totalPages - 1);
    return out;
  }, [totalPages, page]);

  return (
    <section className="page-section nw-page">
      <div className="nw">
        {/* Featured lead hero */}
        {feat && (
          <div className="nw-hero-band">
            {featured.length > 1 && (
              <button className="nw-hero-nav nw-hero-nav--prev" aria-label="Previous"
                      onClick={() => setFeatIdx(i => (i - 1 + featured.length) % featured.length)}>‹</button>
            )}
            <article className="nw-hero">
              <div className="nw-hero-body">
                <p className="nw-hero-eyebrow">Latest News</p>
                <button className="nw-hero-title" onClick={() => open(feat)}>{feat.title}</button>
                <p className="nw-hero-dek">{feat.summary || excerpt(feat.body, 190)}</p>
                <p className="nw-hero-meta">
                  <span className={`nw-tag nw-tag--${catTone(feat.category)}`}>{feat.category}</span>
                  <span className="sep">·</span><span className="nw-date">{fmtDate(feat.date)}</span>
                </p>
                <button className="nw-hero-btn" onClick={() => open(feat)}>
                  Read article <svg className="ico"><use href="#i-arrow-right" /></svg>
                </button>
              </div>
              <div className="nw-hero-visual"><HeroArt /></div>
            </article>
            {featured.length > 1 && (
              <button className="nw-hero-nav nw-hero-nav--next" aria-label="Next"
                      onClick={() => setFeatIdx(i => (i + 1) % featured.length)}>›</button>
            )}
            {featured.length > 1 && (
              <div className="nw-hero-dots">
                {featured.map((_, i) => (
                  <button key={i} className={i === featIdx % featured.length ? 'is-on' : ''}
                          aria-label={`Featured ${i + 1}`} onClick={() => setFeatIdx(i)} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Filter row */}
        <div className="od-bar nw-bar">
          <span className="od-search">
            <svg className="ico"><use href="#i-search" /></svg>
            <input type="text" placeholder="Search articles by title or keywords…" aria-label="Search articles"
                   value={query} onChange={(e) => { setQuery(e.target.value); onAnyFilter(); }} />
          </span>
          <div className="od-controls">
            <span className="od-field">
              <svg className="ico"><use href="#i-flag" /></svg>
              <select aria-label="Category" value={category} onChange={(e) => { setCategory(e.target.value); onAnyFilter(); }}>
                <option value="all">Category</option>
                {ARTICLE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </span>
            <span className="od-field">
              <svg className="ico"><use href="#i-filter" /></svg>
              <select aria-label="Topic" value={topic} onChange={(e) => { setTopic(e.target.value); onAnyFilter(); }}>
                <option value="all">Topic</option>
                {topics.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </span>
            <span className="od-field">
              <svg className="ico"><use href="#i-calendar" /></svg>
              <select aria-label="Date range" value={range} onChange={(e) => { setRange(e.target.value as Range); onAnyFilter(); }}>
                <option value="all">Date range</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="year">This year</option>
              </select>
            </span>
            <span className="od-field">
              <svg className="ico"><use href="#i-arrow-down" /></svg>
              <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
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
          <div className="nw-grid">
            {paged.map((a, i) => (
              <article key={a.id} className={`nw-card${page === 0 && i === 0 ? ' is-lead' : ''}`}>
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
        )}

        {totalPages > 1 && (
          <div className="nw-pager">
            <button className="nw-pg-arrow" disabled={page === 0} onClick={() => setPageNum(p => p - 1)} aria-label="Previous page">‹</button>
            {pageList.map((p, i) => p === '…'
              ? <span key={`e${i}`} className="nw-pg-gap">…</span>
              : <button key={p} className={`nw-pg-num${p === page ? ' is-on' : ''}`} onClick={() => setPageNum(p)}>{p + 1}</button>)}
            <button className="nw-pg-arrow" disabled={page >= totalPages - 1} onClick={() => setPageNum(p => p + 1)} aria-label="Next page">›</button>
          </div>
        )}
      </div>
    </section>
  );
}

const widget: PublicWidget = { id: 'pub-articles', Component: Articles };
export default widget;
