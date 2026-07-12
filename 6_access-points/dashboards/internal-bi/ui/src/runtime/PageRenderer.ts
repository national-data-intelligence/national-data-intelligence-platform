/**
 * PageRenderer — draws a page ENTIRELY from the catalog (gateway spec). The
 * shell no longer knows what sections or widgets exist; it renders whatever the
 * per-role spec hands it:
 *
 *   page.sections[]  → a titled band each (eyebrow/title/description from catalog)
 *   section.widgets[] → a CSS grid of `section.columns` tracks; each widget card
 *                       spans an EFFECTIVE span computed by runtime/reactivity's
 *                       packRows (declared col_span, rows grown to fill the grid);
 *                       grid-auto-flow: dense so survivors reflow to fill gaps.
 *
 * GLOBAL-FILTER REACTIVITY (owner design 2026-07-07, see runtime/reactivity.ts):
 * on the initial paint AND on every filter-bus change each section
 *   1. hides every widget whose spec `supports` declares it cannot honour an
 *      ACTIVE dim (card fully removed from the grid — display:none, widget
 *      redraws deferred while hidden; no supports key → never hidden);
 *   2. reflows the survivors: the freed tracks are redistributed proportionally
 *      to the declared spans (packRows) — cards toggle + grid recompute, no
 *      page re-mount;
 *   3. honours WidgetDef.reflow — 'ratio' cards get a min-height scaled by the
 *      same width-growth factor so map-like widgets grow proportionally (chart
 *      instances follow through their own ResizeObservers);
 *   4. shows a muted "N widgets hidden at this scope" note in the section
 *      header while anything is hidden.
 *
 * Each widget is mounted by looking its id up in the build-time registry and
 * calling its render(ctx). Data is REAL-or-EMPTY (dataHook) — never synthetic.
 */
import type { ResolvedPage, ResolvedSection, ResolvedWidget } from '../api/spec';
import type { WidgetCtx, WidgetDef, WidgetData } from './types';
import { getWidgetDef } from './registry';
import { resolveTheme } from './theme';
import { filterBus } from './filterBus';
import { fetchWidgetData, fetchEntity } from './dataHook';
import { GLOBAL_DIMS, isWidgetHiddenAtScope, packRows, filterParamsForWidget, effectiveReactsTo } from './reactivity';
import { host } from './host';

/** Section-id slug → sprite icon (docs/final-mockkups: section markers are icons, not ①②③). */
const SECTION_ICON: Record<string, string> = {
  // overview
  headline: 'i-globe', reliability: 'i-shield-check', 'act-now': 'i-megaphone', trust: 'i-shield',
  // disease
  'signal-header': 'i-pulse', 'geographic-risk': 'i-map', 'outbreak-operations': 'i-virus',
  'anomaly-trend': 'i-chart-line', 'climate-drivers': 'i-leaf',
  // resource
  'stockout-headline': 'i-package', 'supply-stress-geography': 'i-map', 'commodity-detail': 'i-pill',
  'stockout-impact-service': 'i-truck', procurement: 'i-cart',
  // service
  topline: 'i-chart-bar', 'flagship-attainment': 'i-shield-check', 'care-cascades': 'i-users',
  'reported-vs-recorded': 'i-handshake', 'operational-quality': 'i-check-circle',
};

/** Standard empty state — one visual language for "no real data" everywhere.
 *  Exported so the app-shell (detail views / modals) shows the same empty. */
export function emptyState(el: HTMLElement, message?: string): void {
  el.innerHTML = `
    <div class="widget-empty">
      <svg class="ico" aria-hidden="true"><use href="#i-database"/></svg>
      <span>${message || 'No data available for the current scope.'}</span>
    </div>`;
}

/** AI-C1 — read_widget data registry. Stash each widget's last-fetched tabular
 *  data (columns + row objects) keyed by widget id, so the AI assistant's
 *  read_widget (api/dashboardApi) returns the REAL rows the widget is showing —
 *  not the legacy `sv` store (always null for catalog-runtime widgets). A
 *  non-tabular or empty fetch records null; read_widget falls back to its
 *  text_preview then. Recording never alters the fetched result. */
function recordWidgetData(widgetId: string, data: WidgetData): void {
  if (typeof window === 'undefined') return;
  const reg = ((window as any).__nhdwWidgetData ??= {}) as
    Record<string, { columns: string[]; rows: Record<string, any>[] } | null>;
  reg[widgetId] = (Array.isArray(data) && data.length)
    ? { columns: Object.keys(data[0]), rows: data }
    : null;
}

/** A mounted widget the section can manage: dispose it, or tell it it just
 *  came back into view (scope reflow) so it redraws with the current filters. */
export interface MountedWidget {
  dispose(): void;
  /** Called on a hidden→visible transition. Always redraws: the filters that
   *  hid the widget have changed, and any redraws that fired while it was
   *  hidden were skipped (isHidden gate), so its DOM may be stale or empty. */
  notifyShown(): void;
}

/** Mount a single widget into its card body. `isHidden` is the scope gate —
 *  while it returns true, filter-driven redraws are skipped (the card is
 *  display:none; fetching for an invisible widget is waste). It computes from
 *  the bus directly, so listener ordering can never race it. */
export function mountWidgetManaged(
  widget: ResolvedWidget,
  section: ResolvedSection | undefined,
  page: ResolvedPage,
  body: HTMLElement,
  isHidden?: () => boolean,
): MountedWidget {
  let cleanup: void | (() => void);
  let disposed = false;
  let gen = 0;   // draw generation — guards overlapping async re-renders
  let unsub: () => void = () => {};
  let started: WidgetDef | null = null;

  const draw = (d: WidgetDef) => {
    const myGen = ++gen;
    // dispose previous render (chart instances, listeners) before re-render
    try { if (typeof cleanup === 'function') cleanup(); } catch { /* noop */ }
    cleanup = undefined;
    // Each draw renders into its OWN slot; clearing `body` detaches any prior
    // slot, so a stale async render (fetchData still in flight when a filter
    // change fires a new draw) appends into a detached slot — never the page.
    body.innerHTML = '';
    const slot = document.createElement('div');
    slot.style.height = '100%';
    body.appendChild(slot);

    const ctx: WidgetCtx = {
      el: slot,
      widget,
      section,
      page,
      theme: resolveTheme(),
      filters: filterBus.get(),
      bus: filterBus,
      host,
      fetchData: (params) => {
        // Inject the active global-filter values so the widget re-queries NARROWED
        // data (gated by reactsTo ∩ supports; national/opted-out widgets inject
        // nothing). Server caps every value against role_scope ∩ user_scope, so
        // this can only intersect a role's scope. Widget-supplied params win.
        const reacts = effectiveReactsTo(d.reactsTo, widget.reacts_to, widget.supports);
        const p = fetchWidgetData(widget.data_url,
          { ...filterParamsForWidget(widget, reacts, filterBus.get()), ...params });
        // AI-C1: record the fetched rows for read_widget (does NOT alter the result).
        p.then(rows => recordWidgetData(widget.id, rows)).catch(() => { /* noop */ });
        return p;
      },
      fetchEntity: (path, params) => fetchEntity(path, params),
      empty: (m) => emptyState(slot, m),
    };
    const result = d.render(ctx);
    if (result instanceof Promise) {
      result.then(c => {
        if (myGen !== gen) { if (typeof c === 'function') { try { c(); } catch { /* noop */ } } return; }
        if (!disposed) cleanup = c; else if (typeof c === 'function') c();
      });
    } else {
      cleanup = result;
    }
  };

  // Start rendering with a resolved WidgetDef + wire the reacts_to re-render.
  // A widget that is scope-hidden at mount time defers its FIRST draw too —
  // notifyShown() paints it when the scope lets it back in.
  const start = (d: WidgetDef) => {
    if (disposed) return;
    started = d;
    if (!isHidden?.()) draw(d);
    const reacts = effectiveReactsTo(d.reactsTo, widget.reacts_to, widget.supports);
    unsub = reacts.length
      ? filterBus.subscribe(reacts, () => {
          if (disposed || isHidden?.()) return;   // hidden → defer; notifyShown redraws
          draw(d);
        })
      : () => {};
  };

  const def = getWidgetDef(widget.id);
  if (def) {
    // In-tree widget (build-time registry) — the common path.
    start(def);
  } else {
    body.innerHTML =
      `<div class="widget-empty">No renderer registered for <code>${widget.id}</code></div>`;
  }

  return {
    dispose() {
      disposed = true;
      unsub();
      try { if (typeof cleanup === 'function') cleanup(); } catch { /* noop */ }
    },
    notifyShown() {
      if (disposed || !started) return;
      draw(started);
    },
  };
}

/** Back-compat teardown-only mount (chrome slots — ChromeWidget.tsx). Chrome
 *  widgets are never scope-hidden, so they take no gate. */
export function mountWidget(
  widget: ResolvedWidget,
  section: ResolvedSection | undefined,
  page: ResolvedPage,
  body: HTMLElement,
): () => void {
  const m = mountWidgetManaged(widget, section, page, body);
  return () => m.dispose();
}

/** Render one section band (header + reflowing widget grid). */
function renderSection(section: ResolvedSection, page: ResolvedPage, mount: HTMLElement, teardowns: Array<() => void>): void {
  const widgets = (section.widgets || []).filter(w => !String(w.placement || '').startsWith('chrome.'));
  if (!widgets.length) return;   // gateway already drops empty sections; belt-and-braces

  const band = document.createElement('section');
  band.className = 'page-section';
  band.dataset.sectionId = section.id;

  // Header — eyebrow + title + description straight from the catalog. Section
  // titles carry a small sprite icon keyed by the section-id slug (final owner
  // ruling 2026-07-07, matching the reference goldens — supersedes the earlier
  // plain-heading round). The Overview is a standalone summary (owner) —
  // sections carry NO "view full page" jump; the digest is the destination.
  // The right-hand slot holds the scope-reactivity hidden-count note.
  const noteEl = document.createElement('span');
  noteEl.className = 'ps-hidden-note';
  noteEl.style.display = 'none';
  if (section.title || section.eyebrow) {
    const hdr = document.createElement('div');
    hdr.className = 'ps-hdr';
    const title = (section.title || '').replace(/^[①-⑳]\s*/, '');
    // Appropriate section icon (sprite) keyed by the section-id slug — replaces
    // the ①②③ circled-digit markers (which also render as tofu in some fonts).
    const slug = (section.id.split('/').pop() || '');
    const icon = SECTION_ICON[slug] || 'i-list';
    hdr.innerHTML = `
      <div>
        ${section.eyebrow ? `<div class="ps-eyebrow">${section.eyebrow}</div>` : ''}
        ${title ? `<h3 class="ps-title"><svg class="ico" aria-hidden="true"><use href="#${icon}"/></svg>${title}</h3>` : ''}
        ${section.description ? `<p class="ps-sub">${section.description}</p>` : ''}
      </div>`;
    hdr.appendChild(noteEl);   // .ps-hdr is flex space-between → right-aligned
    band.appendChild(hdr);
  } else {
    // Headerless band: a thin right-aligned strip that only exists while the
    // note is showing (collapses to nothing otherwise).
    const strip = document.createElement('div');
    strip.className = 'ps-hidden-noterow';
    strip.appendChild(noteEl);
    band.appendChild(strip);
  }

  // Body — a grid of `columns` tracks; widgets span col_span; dense reflow.
  const cols = Math.max(1, section.columns || 12);
  const grid = document.createElement('div');
  grid.className = 'ps-grid';
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  grid.style.gridAutoFlow = section.dense === false ? 'row' : 'row dense';
  // Tight columns, but a roomier ROW gap so multi-row sections (e.g. Service · Care
  // Cascades) keep a section-like vertical cadence instead of cramming rows 16px apart.
  grid.style.columnGap = '1rem';
  grid.style.rowGap = '1.4rem';
  grid.style.alignItems = 'stretch';
  band.appendChild(grid);

  // ── Cards + managed mounts ────────────────────────────────────────────────
  // The DECLARED span is the catalog contract; the EFFECTIVE span comes from
  // packRows over the currently-VISIBLE widgets (permission gaps at render
  // time, scope gaps on every filter change) — one algorithm for both.
  const declared = widgets.map(w => Math.min(cols, Math.max(1, w.col_span || Math.round(cols / 2))));
  const cards: HTMLElement[] = [];
  const mounted: MountedWidget[] = [];
  const hiddenNow: boolean[] = widgets.map(() => false);   // as last applied
  const curSpan: number[] = declared.slice();
  // reflow='ratio' baseline — the card's natural box, measured while it sits
  // at its declared span (re-measured on every pass it is found there, so a
  // baseline taken during a loading state self-heals once content settles).
  const ratioBase: Array<{ w: number; h: number } | null> = widgets.map(() => null);

  widgets.forEach((w, i) => {
    const wdef = getWidgetDef(w.id);
    // frameless widgets (KPI strips / hero boards) draw their own tiles and sit
    // directly on the page background — no wrapping card, no stacked-cards look.
    const frameless = !!wdef?.frameless;
    const card = document.createElement('div');
    card.className = frameless ? 'widget-card widget-frameless' : 'card card-elev widget-card';
    card.dataset.widgetId = w.id;
    if (w.title) card.dataset.widgetTitle = w.title;   // read by the AI assistant (dashboardApi)
    card.style.gridColumn = `span ${declared[i]}`;
    if (w.row_span && w.row_span > 1) card.style.gridRow = `span ${w.row_span}`;
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.minWidth = '0';

    // Card chrome — catalog title (+ an honesty badge for filter-blind widgets).
    // Suppress a title that is just the widget's internal id (a spec placeholder):
    // the friend's design leaves these KPI-strip widgets untitled, so a raw id like
    // "ov-benchmarks" must never render as a user-facing heading. Frameless
    // widgets are self-labelling — never draw card chrome above them.
    const showTitle = !frameless && !!w.title && w.title.trim().toLowerCase() !== String(w.id).toLowerCase();
    if (showTitle) {
      const h = document.createElement('div');
      h.className = 'widget-hd';
      // A widget is "filtered" if its build-time def OR its catalog row (plugin
      // widgets have no in-tree def) declares reacts_to dimensions.
      const reacts = (wdef?.reactsTo && wdef.reactsTo.length) ||
                     (w.reacts_to && w.reacts_to.length);
      h.innerHTML = `<h4 class="widget-title" title="${String(w.title).replace(/"/g, '&quot;')}">${w.title}</h4>` +
        (reacts ? '' : '<span class="widget-badge" title="This widget is not affected by the current filters">unfiltered</span>');
      card.appendChild(h);
    }

    const bodyEl = document.createElement('div');
    bodyEl.className = 'widget-body';
    bodyEl.style.flex = '1';
    bodyEl.style.minHeight = '0';
    card.appendChild(bodyEl);

    grid.appendChild(card);
    cards.push(card);
    // The gate computes from the live bus (never cached section state), so the
    // widget's own reactsTo listener and the section's layout listener can run
    // in any order without racing.
    const m = mountWidgetManaged(w, section, page, bodyEl, () => isWidgetHiddenAtScope(w, filterBus.get()));
    mounted.push(m);
    teardowns.push(() => m.dispose());
  });

  // ── Scope layout — visibility + reflow, applied without re-mounting ──────
  const applyLayout = () => {
    const state = filterBus.get();
    const hidden = widgets.map(w => isWidgetHiddenAtScope(w, state));

    // 1 · refresh 'ratio' baselines BEFORE any size change: a visible ratio
    //     card sitting at its declared span is at its natural size.
    widgets.forEach((w, i) => {
      if (getWidgetDef(w.id)?.reflow !== 'ratio') return;
      if (hiddenNow[i] || curSpan[i] !== declared[i]) return;
      const r = cards[i].getBoundingClientRect();
      if (r.width >= 80 && r.height >= 80) ratioBase[i] = { w: r.width, h: r.height };
    });

    // 2 · effective spans over the visible subset (proportional row fill).
    const visIdx: number[] = [];
    widgets.forEach((_, i) => { if (!hidden[i]) visIdx.push(i); });
    const spans = packRows(visIdx.map(i => declared[i]), cols);

    // 3 · apply — cards toggle + grid recompute; no widget re-mount.
    let vp = 0;
    widgets.forEach((w, i) => {
      const card = cards[i];
      if (hidden[i]) {
        card.style.display = 'none';
        return;
      }
      const span = spans[vp++];
      card.style.display = 'flex';
      card.style.gridColumn = `span ${span}`;
      curSpan[i] = span;
      if (getWidgetDef(w.id)?.reflow === 'ratio') {
        // Preserve the card's aspect: height grows by the same factor as width
        // (min-height so content can still exceed it; charts inside follow the
        // card through their ResizeObservers / bindAspect sizers).
        if (span !== declared[i] && ratioBase[i]) {
          card.style.minHeight = `${Math.round(ratioBase[i]!.h * (span / declared[i]))}px`;
        } else {
          card.style.minHeight = '';
        }
      }
    });

    // 4 · hidden→visible transitions redraw AFTER the new geometry is in
    //     place (a chart mounted into the final card size needs no resize).
    widgets.forEach((_, i) => {
      const was = hiddenNow[i];
      hiddenNow[i] = hidden[i];
      if (was && !hidden[i]) mounted[i].notifyShown();
    });

    // 5 · the per-section honesty note.
    const n = hidden.filter(Boolean).length;
    noteEl.style.display = n ? '' : 'none';
    noteEl.textContent = n ? `${n} widget${n === 1 ? '' : 's'} hidden at this scope` : '';
  };

  mount.appendChild(band);            // in the document BEFORE measuring
  applyLayout();                      // filters may already be active on paint
  teardowns.push(filterBus.subscribe([...GLOBAL_DIMS], applyLayout));
}

/** Render a whole page from its resolved spec. Returns a teardown that disposes
 *  every mounted widget (call before re-rendering / leaving the page). */
export function renderPage(page: ResolvedPage, mount: HTMLElement): () => void {
  mount.innerHTML = '';
  const teardowns: Array<() => void> = [];
  const sections = [...(page.sections || [])].sort((a, b) => a.ordering - b.ordering);
  if (!sections.length) {
    mount.innerHTML = `<div class="widget-empty" style="padding:3rem">No sections granted on this page for your role.</div>`;
    return () => {};
  }
  for (const s of sections) renderSection(s, page, mount, teardowns);
  return () => { for (const t of teardowns) { try { t(); } catch { /* noop */ } } };
}
