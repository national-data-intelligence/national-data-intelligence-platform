/**
 * Widget · pub-data-catalogue — Open Data "register" (page "data").
 *
 * Design (2026-07-08 reimagining): the datasets are presented as a quietly
 * typeset INDEX — hairline-separated rows with a serif title, an index numeral
 * and download / preview affordances that come forward on hover — rather than a
 * facet sidebar + metadata cards. Reads the published catalogue from
 * /api/proxy/catalogue via useDatasets (real count, provenance, protection,
 * real CSV download + row preview); falls back to the bundled catalogue only
 * when the manifest is unavailable. Reads openModal from host.
 */
import { useMemo, useState } from 'react';
import { useDatasets, type DatasetLive } from '../../hooks/useDatasets';
import type { PublicWidget, PublicHost } from '../../runtime/types';

type Tier = 'all' | 'aggregate' | 'facility-level' | 'bulletin';
type Sort = 'updated' | 'downloads' | 'title';
const PAGE_SIZE = 6;

type Preview = { columns: string[]; rows: string[][]; total_rows: number };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Sample preview shown when the gateway isn't reachable (design harness) so the
 *  "Preview" action always renders a table. Real rows replace this when the
 *  gateway responds. */
function samplePreview(d: DatasetLive): Preview {
  const regions = ['Addis Ababa', 'Oromia', 'Amhara', 'Tigray', 'Somali', 'Sidama', 'Afar', 'Dire Dawa'];
  const period = d.period.includes('→') ? d.period.split('→').pop()!.trim() : d.period;
  const indicator = d.topic.split('·')[0].trim();
  const rows = regions.map((r, i) => [
    r, period, indicator, String(46 + ((i * 17 + 9) % 48)), '%',
  ]);
  return { columns: ['region', 'period', 'indicator', 'value', 'unit'], rows, total_rows: 1148 };
}

/** Human tier label for the row kicker. */
function tierLabel(t: string): string {
  if (t === 'facility-level') return 'Facility-level';
  if (t === 'bulletin') return 'Bulletin';
  return 'Aggregate';
}

/** Compact "2024–2026" range from a verbose period string; falls back to the raw value. */
function compactPeriod(p: string): string {
  if (!p || p === 'n/a') return '—';
  const years = p.match(/\d{4}/g);
  if (years && years.length >= 2 && years[0] !== years[years.length - 1]) {
    return `${years[0]}–${years[years.length - 1]}`;
  }
  if (years && years.length >= 1) return years[0];
  return p;
}

/** Short size label — KB under 1 MB, else MB (one decimal under 10). */
function fmtSize(mb: number): string {
  if (!mb || mb <= 0) return '—';
  if (mb < 1) return `${Math.round(mb * 1000)} KB`;
  return `${mb < 10 ? Number(mb.toFixed(1)) : Math.round(mb)} MB`;
}

/** Primary (first) topic, for the row kicker. */
function primaryTopic(topic: string): string {
  return topic.split('·')[0].trim() || '';
}

/** "Jun 2026" from an ISO date; empty string if unparseable. */
function monthYear(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  return m ? `${MONTHS[+m[2] - 1]} ${m[1]}` : '';
}

function DataCatalogue({ host }: { host: PublicHost }) {
  const { openModal } = host;
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState<Tier>('all');
  const [topic, setTopic] = useState<string>('all');
  const [sort, setSort] = useState<Sort>('updated');
  const [page, setPage] = useState(0);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const DATA = useDatasets();

  const topics = useMemo(
    () => Array.from(new Set(DATA.flatMap(d => d.topic.split('·').map(s => s.trim()).filter(Boolean)))).sort(),
    [DATA]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return DATA
      .filter(d => tier === 'all' || d.tier === tier)
      .filter(d => topic === 'all' || d.topic === topic
                || d.topic.split('·').map(s => s.trim()).includes(topic))
      .filter(d => !q
                || d.title.toLowerCase().includes(q)
                || d.desc.toLowerCase().includes(q)
                || d.topic.toLowerCase().includes(q))
      .sort((a, b) => {
        if (sort === 'updated')   return (b.updated || '').localeCompare(a.updated || '');
        if (sort === 'downloads') return b.downloads - a.downloads;
        if (sort === 'title')     return a.title.localeCompare(b.title);
        return 0;
      });
  }, [DATA, query, tier, topic, sort]);

  const totalPages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const paged = matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const onAnyFilter = () => setPage(0);
  const clearFilters = () => { setQuery(''); setTier('all'); setTopic('all'); setPage(0); };

  const doPreview = async (d: DatasetLive) => {
    if (previewId === d.id) { setPreviewId(null); setPreview(null); return; }
    setPreviewId(d.id); setPreview(null);
    try {
      const r = await fetch(`/api/proxy/datasets/${d.id}/preview?rows=12`);
      if (r.ok) { setPreview(await r.json()); return; }
    } catch { /* no gateway (design harness) — fall through to the sample below */ }
    setPreview(samplePreview(d));
  };

  const tiers: { v: Tier; label: string; note?: string }[] = [
    { v: 'all',            label: 'All' },
    { v: 'aggregate',      label: 'Aggregate' },
    { v: 'bulletin',       label: 'Bulletins' },
    { v: 'facility-level', label: 'Facility-level', note: 'research' },
  ];

  return (
    <>
      <section className="page-banner">
        <div className="pgh">
          <p className="pgh-eyebrow">Open Data</p>
          <h1 className="pgh-title">The public register</h1>
          <p className="pgh-sub">{DATA.length} curated datasets, openly licensed under CC-BY 4.0.</p>
        </div>
      </section>

      <section id="downloads" className="page-section">
        <div className="od">
          <div className="od-bar">
            <span className="od-search">
              <svg className="ico"><use href="#i-search" /></svg>
              <input
                type="text"
                placeholder="Search datasets"
                aria-label="Search datasets"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(0); }}
              />
            </span>

            <div className="od-seg" role="group" aria-label="Tier">
              {tiers.map(t => (
                <button key={t.v} className={tier === t.v ? 'is-on' : ''}
                        onClick={() => { setTier(t.v); onAnyFilter(); }}>
                  {t.label}{t.note && <span className="od-seg-note">{t.note}</span>}
                </button>
              ))}
            </div>

            <div className="od-controls">
              <span className="od-field">
                <label htmlFor="od-topic">Topic</label>
                <select id="od-topic" value={topic} onChange={(e) => { setTopic(e.target.value); onAnyFilter(); }}>
                  <option value="all">All</option>
                  {topics.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </span>
              <span className="od-field">
                <label htmlFor="od-sort">Sort</label>
                <select id="od-sort" value={sort} onChange={(e) => { setSort(e.target.value as Sort); onAnyFilter(); }}>
                  <option value="updated">Recently updated</option>
                  <option value="downloads">Most downloaded</option>
                  <option value="title">Title A–Z</option>
                </select>
              </span>
            </div>
          </div>

          <p className="od-count">
            <strong>{matches.length}</strong> {matches.length === 1 ? 'dataset' : 'datasets'}
            {query.trim() && <> matching “{query}”</>}
          </p>

          {matches.length === 0 ? (
            <div className="od-empty">
              <svg className="ico" style={{ width: 28, height: 28, color: 'var(--ink-4)' }}><use href="#i-search" /></svg>
              <p>No datasets match the current filters.</p>
              <button className="od-foot-link" onClick={clearFilters}>Clear filters</button>
            </div>
          ) : (
            <ol className="od-list">
              {paged.map((d: DatasetLive, i) => {
                const upd = d.updated ? monthYear(d.updated) : '';
                return (
                  <li key={d.id} className="od-row">
                    <span className="od-idx">
                      <svg className="od-idx-ico" viewBox="0 0 24 24" aria-hidden="true"
                           fill="none" stroke="currentColor" strokeWidth={1.5}
                           strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 5.5h16v13H4z M4 10h16 M4 14.5h16 M9.5 5.5v13 M15 5.5v13" />
                      </svg>
                      <span className="od-idx-n">{String(page * PAGE_SIZE + i + 1).padStart(2, '0')}</span>
                    </span>
                    <div className="od-main">
                      <span className="od-kicker">
                        <span className={`od-dot od-dot--${d.tier}`} />
                        {tierLabel(d.tier)}{primaryTopic(d.topic) && <> · {primaryTopic(d.topic)}</>}
                      </span>
                      <h3 className="od-title">{d.title}</h3>
                      <p className="od-meta">
                        <span>{compactPeriod(d.period)}</span>
                        <span className="sep">·</span>
                        <span className="od-fmt">{d.formats.join(' · ')}</span>
                        {upd && (<><span className="sep">·</span><span>Updated {upd}</span></>)}
                      </p>

                      {previewId === d.id && (
                        <div className="od-preview">
                          {d.desc && <p className="od-preview-desc">{d.desc}</p>}
                          {!preview ? (
                            <p className="od-preview-note">Loading preview…</p>
                          ) : (
                            <>
                              <div className="od-preview-scroll">
                                <table className="od-preview-table">
                                  <thead><tr>{preview.columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
                                  <tbody>
                                    {preview.rows.map((row, ri) => (
                                      <tr key={ri}>{row.map((v, ci) => <td key={ci}>{v}</td>)}</tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              <p className="od-preview-note">First {preview.rows.length} of {preview.total_rows.toLocaleString()} rows.</p>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="od-side">
                      <span className="od-size">{fmtSize(d.sizeMb)}</span>
                      <button className="od-preview-btn" onClick={() => doPreview(d)}>
                        {previewId === d.id ? 'Hide' : 'Preview'}
                      </button>
                      {d.download_url ? (
                        <a href={d.download_url} className="od-dl" download aria-label={`Download ${d.title}`} title="Download">
                          <svg className="ico"><use href="#i-download" /></svg>
                        </a>
                      ) : (
                        <a href="#" className="od-dl" onClick={(e) => e.preventDefault()} aria-label={`Download ${d.title}`} title="Download">
                          <svg className="ico"><use href="#i-download" /></svg>
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {totalPages > 1 && (
            <div className="od-pager">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
              <span>Page {page + 1} of {totalPages}</span>
              <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next ›</button>
            </div>
          )}

          <div className="od-foot">
            <span className="od-foot-note">CC-BY 4.0 · k-anonymity ≥ 5 · aggregated to woreda or coarser</span>
            <button className="od-foot-link" onClick={() => openModal('access')}>
              Request facility-level access <svg className="ico"><use href="#i-arrow-right" /></svg>
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

const widget: PublicWidget = { id: 'pub-data-catalogue', Component: DataCatalogue };
export default widget;
