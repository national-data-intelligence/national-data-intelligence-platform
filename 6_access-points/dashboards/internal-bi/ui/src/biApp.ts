/**
 * Internal-BI shell state layer.
 *
 * Originally a ~2,600-line imperative port of the mockup's chart engine; the
 * per-page synthetic data builders + chart renderers were RETIRED 2026-07-04
 * once every page became catalog-driven (src/widgets/* via CatalogPage +
 * runtime/PageRenderer). What remains is the thin shell state the React app
 * still needs: page/filter/alert state, the resolved permission spec
 * (loadSpec + grants + data_url helpers), and the reactive subscribe() bridge.
 * renderActive() is now a no-op dispatch (biApp draws nothing itself).
 *
 * Alpine-specific adjustments kept: `this.$nextTick(fn)` → queueMicrotask;
 * Alpine auto-reactivity → a minimal subscribe() callback React consumes
 * (useBiApp.ts). Mutations to active/filters/openFilter/modal flags notify().
 *
 * @ts-nocheck — intentionally JavaScript-style state object.
 */
// @ts-nocheck
/* eslint-disable */

import { T } from './theme';
import { fetchDashboardSpec, SPEC_DENIED } from './api/spec';
import { authFetch } from './api/useAuth';

declare global {
  interface Window {
    __biApp?: any;
  }
}

// ═══ Reference data exposed to Alpine state ═══
// Region filter values are the CODES the marts key on (region_id); the name is
// the display label. The global-filter + AlertModal emit {code} as the value so a
// wildcard user's pick ('OR') matches the mart, exactly like a scoped user's cap.
const REGIONS = [
  { code: 'AA', name: 'Addis Ababa' },       { code: 'AF', name: 'Afar' },
  { code: 'AM', name: 'Amhara' },            { code: 'BG', name: 'Benishangul-Gumuz' },
  { code: 'CE', name: 'Central Ethiopia' },  { code: 'DD', name: 'Dire Dawa' },
  { code: 'GA', name: 'Gambella' },          { code: 'HA', name: 'Harari' },
  { code: 'OR', name: 'Oromia' },            { code: 'SE', name: 'South Ethiopia' },
  { code: 'SI', name: 'Sidama' },            { code: 'SO', name: 'Somali' },
  { code: 'SW', name: 'South West Ethiopia' },{ code: 'TI', name: 'Tigray' },
];
// 2-letter region codes used across the marts (mart region_id) → SPA region names.
// Same coding as the MFR/IDSR sources (WOR-<REG>-… org-unit codes).
const REGION_BY_ID = {
  AA: 'Addis Ababa', AF: 'Afar', AM: 'Amhara', BG: 'Benishangul Gumuz',
  CE: 'Central Ethiopia', DD: 'Dire Dawa', GA: 'Gambella', HA: 'Harari',
  OR: 'Oromia', SI: 'Sidama', SO: 'Somali', SE: 'South Ethiopia',
  SW: 'South West Ethiopia', TI: 'Tigray',
};
// Programme filter values are the mart programme_id CODES (uppercase); the name is
// the display label. Same code-as-value contract as REGIONS so a wildcard pick
// ('MALARIA') matches programme_id in the marts.
const PROGRAMMES = [
  { code: 'HIV', name: 'HIV' },        { code: 'TB', name: 'TB' },
  { code: 'EPI', name: 'Immunization (EPI)' }, { code: 'MNCH', name: 'MNCH' },
  { code: 'NCD', name: 'NCD' },        { code: 'MALARIA', name: 'Malaria' },
  { code: 'FP', name: 'Family Planning' }, { code: 'NUTRITION', name: 'Nutrition' },
];
const DISEASES = [
  {key:'cholera',     name:'Cholera',          tier:'high',  climate:true,  cfr_base:2.1,  seasonalPeak:32},
  {key:'measles',     name:'Measles',          tier:'high',  climate:false, cfr_base:0.8,  seasonalPeak:10},
  {key:'awd',         name:'AWD',              tier:'high',  climate:true,  cfr_base:1.4,  seasonalPeak:30},
  {key:'malaria',     name:'Malaria',          tier:'high',  climate:true,  cfr_base:0.3,  seasonalPeak:38},
  {key:'meningitis',  name:'Meningitis',       tier:'high',  climate:false, cfr_base:9.4,  seasonalPeak:8},
  {key:'dengue',      name:'Dengue',           tier:'med',   climate:true,  cfr_base:0.5,  seasonalPeak:42},
  {key:'yellowfever', name:'Yellow fever',     tier:'med',   climate:true,  cfr_base:6.0,  seasonalPeak:40},
  {key:'pertussis',   name:'Pertussis',        tier:'med',   climate:false, cfr_base:0.5,  seasonalPeak:14},
  {key:'typhoid',     name:'Typhoid fever',    tier:'med',   climate:true,  cfr_base:1.5,  seasonalPeak:28},
  {key:'plague',      name:'Plague',           tier:'med',   climate:false, cfr_base:12.0, seasonalPeak:18},
  {key:'rabies',      name:'Rabies',           tier:'med',   climate:false, cfr_base:98.0, seasonalPeak:22},
  {key:'tetanus',     name:'Neonatal tetanus', tier:'med',   climate:false, cfr_base:18.0, seasonalPeak:6 },
  {key:'anthrax',     name:'Anthrax',          tier:'low',   climate:false, cfr_base:20.0, seasonalPeak:20},
  {key:'hepa',        name:'Hepatitis A',      tier:'low',   climate:true,  cfr_base:0.3,  seasonalPeak:34},
  {key:'chikungunya', name:'Chikungunya',      tier:'low',   climate:true,  cfr_base:0.1,  seasonalPeak:44},
  {key:'mpox',        name:'Mpox',             tier:'med',   climate:false, cfr_base:1.2,  seasonalPeak:16},
  {key:'covid19',     name:'COVID-19',         tier:'med',   climate:false, cfr_base:1.8,  seasonalPeak:50},
  {key:'leishmaniasis',name:'Visceral leishmaniasis', tier:'low', climate:true, cfr_base:5.0, seasonalPeak:24},
  {key:'leptospirosis',name:'Leptospirosis',   tier:'low',   climate:true,  cfr_base:3.0,  seasonalPeak:34},
  {key:'guineaworm',  name:'Guinea worm',      tier:'low',   climate:true,  cfr_base:0.0,  seasonalPeak:28},
];
const DISEASE_NAME = Object.fromEntries(DISEASES.map(d => [d.key, d.name]));
const PERIOD_OPTS = { 'all':'All time','last_4wk':'Last 4 weeks','last_12wk':'Last 12 weeks','last_6mo':'Last 6 months','last_12mo':'Last 12 months','last_24mo':'Last 24 months','ytd':'Year to date','efy_ytd':'Ethiopian FY to date' };
// Commodity filter values are the EXACT mart commodity_name strings — the code IS
// the name because the supply marts (bi_supply.mart_supply_region_stock /
// mart_resource_allocation) key on commodity_name directly. Kept in sync with the
// filter catalog (bundle/seed-pack/app/security/filters.yaml, id: commodity) and the
// fetchers' commodity_col narrowing. A PLAIN narrowing filter (like period): no
// role scope, always the full list.
const COMMODITIES = [
  { code: 'Amlodipine 5mg', name: 'Amlodipine 5mg' },
  { code: 'Amoxicillin 250 DT', name: 'Amoxicillin 250 DT' },
  { code: 'Artemether-Lumefantrine', name: 'Artemether-Lumefantrine' },
  { code: 'BCG vaccine', name: 'BCG vaccine' },
  { code: 'COVID-19 vaccine', name: 'COVID-19 vaccine' },
  { code: 'Combined oral contracept.', name: 'Combined oral contracept.' },
  { code: 'Depo-Provera', name: 'Depo-Provera' },
  { code: 'Fortified blended food', name: 'Fortified blended food' },
  { code: 'GeneXpert cartridge', name: 'GeneXpert cartridge' },
  { code: 'HIV RDT kit', name: 'HIV RDT kit' },
  { code: 'HPV vaccine', name: 'HPV vaccine' },
  { code: 'IPV (inactivated polio)', name: 'IPV (inactivated polio)' },
  { code: 'Implanon NXT', name: 'Implanon NXT' },
  { code: 'Insulin · regular 100 IU', name: 'Insulin · regular 100 IU' },
  { code: 'Iron-folate', name: 'Iron-folate' },
  { code: 'Isoniazid 300mg', name: 'Isoniazid 300mg' },
  { code: 'LLIN bed net', name: 'LLIN bed net' },
  { code: 'Losartan 50mg', name: 'Losartan 50mg' },
  { code: 'Magnesium sulphate 50%', name: 'Magnesium sulphate 50%' },
  { code: 'Malaria RDT pf/pv', name: 'Malaria RDT pf/pv' },
  { code: 'Measles-Rubella', name: 'Measles-Rubella' },
  { code: 'Metformin 500mg', name: 'Metformin 500mg' },
  { code: 'OPV trivalent', name: 'OPV trivalent' },
  { code: 'ORS sachet', name: 'ORS sachet' },
  { code: 'Oxytocin 10 IU/ml', name: 'Oxytocin 10 IU/ml' },
  { code: 'PCV-13', name: 'PCV-13' },
  { code: 'Paracetamol 500mg', name: 'Paracetamol 500mg' },
  { code: 'Pediatric ART', name: 'Pediatric ART' },
  { code: 'Pentavalent DTwP-HepB-Hib', name: 'Pentavalent DTwP-HepB-Hib' },
  { code: 'RHZE fixed-dose combo', name: 'RHZE fixed-dose combo' },
  { code: 'RUTF (ready-to-use)', name: 'RUTF (ready-to-use)' },
  { code: 'Rotavirus vaccine', name: 'Rotavirus vaccine' },
  { code: 'TLD · adult ART', name: 'TLD · adult ART' },
  { code: 'Tetanus toxoid', name: 'Tetanus toxoid' },
];


function biApp() {
  return {
    active: 'overview',
    pages: [
      {id: 'overview', ico: 'i-grid',         title: 'Overview'},
      {id: 'disease',  ico: 'i-alert',        title: 'Disease Surveillance'},
      {id: 'resource', ico: 'i-package',      title: 'Resource Management'},
      {id: 'service',  ico: 'i-chart-line',   title: 'Service Performance'},
      {id: 'predictions', ico: 'i-brain',     title: 'Predictions'},
      {id: 'export',   ico: 'i-upload',       title: 'Data Export & Query'},
      // Hidden from sidebar — opened from the user chip in the top bar
      {id: 'settings', ico: 'i-settings',     title: 'Profile & Settings', hideInNav: true},
    ],

    // ── Alert subscriptions — REAL backend (/gw/alerts/subscriptions) ──
    // Self-subscription: "notify ME when <metric> on <disease × geo> crosses
    // <threshold>". alertSubs is a cache of the caller's real subscriptions
    // (drives the topbar bell badge); the AlertModal owns the CRUD via authFetch.
    compactDensity: false,                         // Settings · wired to body.density-compact
    alertModal: false,
    // Modal form state — openSubscribe() pre-fills disease+geo from the click site.
    alertDisease: 'all',
    alertGeo: 'all',
    alertThresh: 0.6,
    alertNotify: 'realtime',  // realtime | daily | weekly
    alertSubs: [],            // real cache — the caller's own subscriptions
    // ── Fired notifications — REAL backend (/gw/alerts/notifications) ──
    // The evaluator (gateway + alert_evaluation DAG) writes an alert_notification
    // whenever a forecast crosses a subscription threshold. The topbar bell badge
    // shows the UNREAD count; the NotificationPanel lists them + marks read.
    alertNotifications: [],   // real cache — the caller's own fired alerts
    alertNotifUnread: 0,      // unread count → bell badge
    notifPanel: false,        // NotificationPanel open flag
    /** Fetch the caller's alert subscriptions → alertSubs, then notify React
     *  (the modal / st-alert-subs list). */
    async loadAlertSubs() {
      try {
        const r = await authFetch('/gw/alerts/subscriptions');
        this.alertSubs = r.ok ? await r.json() : [];
      } catch { this.alertSubs = []; }
      notify();
    },
    /** Fetch the caller's fired notifications + unread count → drives the bell
     *  badge and the NotificationPanel. */
    async loadAlertNotifications() {
      try {
        const r = await authFetch('/gw/alerts/notifications');
        const j = r.ok ? await r.json() : { notifications: [], unread_count: 0 };
        this.alertNotifications = j.notifications || [];
        this.alertNotifUnread = j.unread_count || 0;
      } catch { this.alertNotifications = []; this.alertNotifUnread = 0; }
      notify();
    },
    setNotifPanel(v) {
      this.notifPanel = !!v;
      if (v) this.loadAlertNotifications();   // refresh on open
      notify();
    },
    async markNotificationRead(id) {
      try { await authFetch(`/gw/alerts/notifications/${id}/read`, { method: 'POST' }); }
      catch { /* best-effort — reload reflects truth */ }
      await this.loadAlertNotifications();
    },
    async markAllNotificationsRead() {
      try { await authFetch('/gw/alerts/notifications/read-all', { method: 'POST' }); }
      catch { /* best-effort */ }
      await this.loadAlertNotifications();
    },
    /** Context-aware subscribe: pre-fill the modal with the caller's disease +
     *  geography (from the click site) so the intent reads "alert me about THIS". */
    openSubscribe(diseaseKey, geoKey) {
      this.alertDisease = diseaseKey || 'all';
      this.alertGeo     = geoKey     || 'all';
      this.alertModal = true;
      notify();
    },
    diseaseLabelForSub(key) {
      if (key === 'all' || !key) return 'All diseases';
      return DISEASE_NAME[key] || key;
    },
    notifyLabelForSub(key) {
      return { realtime: 'Real-time', daily: 'Daily digest', weekly: 'Weekly summary' }[key] || key;
    },

    // Global filter state is PAGE-SCOPED (owner 2026-07-13): each page keeps its
    // OWN slice, so a region set on one page never bleeds into another. `filters`
    // is a getter that returns the ACTIVE page's slice (lazily created).
    _filtersByPage: {} as Record<string, { geography: string; period: string; programme: string; [k: string]: string }>,
    get filters(): { geography: string; period: string; programme: string; [k: string]: string } {
      const p = (this.active as string) || 'overview';
      return (this._filtersByPage[p] ||
        (this._filtersByPage[p] = { geography: 'all', period: 'all', programme: 'all' }));
    },
    filtersExpanded: false,
    openFilter: null,
    prgSearch: '',
    PERIOD_OPTS, REGIONS, PROGRAMMES, DISEASES, DISEASE_NAME, COMMODITIES,

    currentPage() {
      return this.pages.find(p => p.id === this.active);
    },

    setFilter(k, v) {
      this.filters[k] = v;
      this.openFilter = null;
      this.$nextTick(() => this.renderActive());
    },
    filterLabel(key) {
      const v = this.filters[key];
      if (key === 'geography') return v === 'all' ? 'All Ethiopia' : (REGIONS.find(r => r.code === v)?.name || v);
      if (key === 'period')    return PERIOD_OPTS[v] || v;
      if (key === 'programme') {
        if (v === 'all') return 'All programmes';
        const pg = PROGRAMMES.find(p => p.code === v);
        if (pg) return pg.name;
        return DISEASE_NAME[v] || v;
      }
      return v;
    },

    init() {
      // Synthetic dz/rm/sv builders retired 2026-07-04 — pages are catalog-driven.
      // Load the resolved permission spec (carries per-widget data_urls) so
      // widgets can render REAL mart data with synthetic fallback.
      this.loadSpec();
      // Load the caller's real alert subscriptions (modal / st-alert-subs) and
      // fired notifications (topbar bell badge + NotificationPanel).
      this.loadAlertSubs();
      this.loadAlertNotifications();
      // Expose this Alpine instance globally so the AI panel can find it without DOM walking
      window.__biApp = this;
      this.$nextTick(()=>this.renderActive());
      window.addEventListener('resize', ()=>{ this.renderActive() });
    },

    // ── data_url-first render seam ─────────────────────────────────────
    // The resolved permission spec (gateway) carries a data_url per granted
    // widget. Catalog widgets (src/widgets/*) fetch that REAL mart data and
    // render an honest empty state when there is none — never synthetic.
    _spec: null,
    _specLoaded: false,  // true only when the gateway spec resolved — grants apply
    _specDataUrls: {},   // widget_id → gateway data_url (page-scoped wins)
    _grantedWidgets: null,  // Set<widget_id> present in the spec (grant ≠ data_url)
    _grantedPages: null,    // Set<'internal-bi/<page>'> present in the spec
    _widgetData: {},     // widget_id → Promise<rowObjects[] | null> (session cache)
    async loadSpec() {
      const spec = await fetchDashboardSpec('internal-bi');
      // DENIED ≠ degraded: the gateway answered and this role has NO access to
      // this dashboard. Take over the page honestly — never render the
      // synthetic dashboards to an unauthorized caller (they'd be
      // indistinguishable from real data).
      if (spec === SPEC_DENIED) {
        const publicUrl = window.location.protocol + '//' +
          window.location.host.replace(/^[^.]+/, 'public');
        document.body.innerHTML = `
          <div style="font-family:'Inter',system-ui,sans-serif;min-height:100vh;display:flex;
                      align-items:center;justify-content:center;background:var(--paper,#f7f5f1)">
            <div style="max-width:480px;background:#fff;border:1px solid #e3ddd2;border-radius:14px;
                        padding:38px;box-shadow:0 6px 30px rgba(0,0,0,.07)">
              <h1 style="margin:0 0 10px;font-size:21px">No access to Internal BI</h1>
              <p style="line-height:1.6;font-size:15px;color:#5a5248">Your role doesn't grant any
                 pages on this dashboard. If you believe you need access, request it through the
                 Public Dashboard's access-request form.</p>
              <a href="${publicUrl}" style="display:inline-block;margin-top:12px;padding:10px 18px;
                 border-radius:9px;background:#1d3557;color:#fff;text-decoration:none;font-size:14px">
                 Go to Public Dashboard</a>
            </div>
          </div>`;
        return;
      }
      // Spec fetch failed (gateway hiccup / 5xx / network blip at boot) →
      // _specLoaded stays false and EVERYTHING renders on the degraded
      // fallback. Crucially the global filter bar renders from the spec, so a
      // one-off boot failure used to leave the Period/Programme/Region chips
      // MISSING for the whole session (owner-reported). RETRY with backoff so
      // the app self-heals as soon as the gateway answers.
      if (!spec) {
        this._specRetryN = (this._specRetryN || 0) + 1;
        if (this._specRetryN <= 30) {
          clearTimeout(this._specRetryT);
          this._specRetryT = setTimeout(() => this.loadSpec(), Math.min(15000, 2000 * this._specRetryN));
        }
        return;
      }
      this._specRetryN = 0;
      this._spec = spec;
      const urls = {};
      // Grant = presence in the resolved spec, INDEPENDENT of data_url —
      // a granted-but-unbound widget still renders via its synthetic path.
      const grantedWidgets = new Set();
      const grantedPages = new Set();
      for (const w of (spec.widgets || [])) {
        grantedWidgets.add(w.id);
        if (w.data_url) urls[w.id] = w.data_url;
      }
      for (const p of (spec.pages || [])) {
        grantedPages.add(p.id);
        for (const w of (p.widgets || [])) {
          grantedWidgets.add(w.id);
          if (w.data_url) urls[w.id] = w.data_url;
        }
      }
      this._specDataUrls = urls;
      this._grantedWidgets = grantedWidgets;
      this._grantedPages = grantedPages;
      this._specLoaded = true;
      this._widgetData = {};   // invalidate pre-spec cache entries (all null)
      // Never leave the user on a non-granted page (default is 'disease',
      // which some roles don't have) — hop to their first granted nav page.
      if (!this.pageGranted(this.active)) {
        const first = this.pages.find(p => !p.hideInNav && this.pageGranted(p.id));
        if (first) this.active = first.id;
      }
      notify();   // React re-gates pages/nav on the loaded grants
      this.$nextTick(() => this.renderActive());
    },

    /** Is this widget granted by the resolved spec? A widget ABSENT from the
     *  spec is not granted and must not render at all — synthetic data must
     *  never stand in for content the role isn't allowed to see. Before a
     *  spec resolves everything is treated as granted (degraded fallback). */
    widgetGranted(widgetId) {
      return !this._specLoaded || this._grantedWidgets.has(widgetId);
    },
    /** Same grant check for pages · biApp nav ids are short ('service'),
     *  the spec/catalog namespaces them ('internal-bi/service'). */
    pageGranted(pageId) {
      return !this._specLoaded || this._grantedPages.has(`internal-bi/${pageId}`);
    },

    /** Fetch a widget's real data through the gateway (auth'd, via the /gw
     *  proxy). Resolves an array of row OBJECTS, or null when the widget has
     *  no data_url, the request fails, or the gateway returns a permitted-stub
     *  / empty result. Never rejects — null means "use the synthetic path". */
    widgetData(widgetId) {
      if (!(widgetId in this._widgetData)) {
        const url = this._specDataUrls[widgetId];
        this._widgetData[widgetId] = !url ? Promise.resolve(null) :
          authFetch(url.replace(/^\/api\//, '/gw/'))
            .then(r => (r.ok ? r.json() : null))
            .then(payload => {
              const d = payload?.data;
              if (!d || !Array.isArray(d.rows) || d.rows.length === 0) return null;
              return this.rowsToObjects(d.columns || [], d.rows);
            })
            .catch(() => null);
      }
      return this._widgetData[widgetId];
    },

    /** Same seam as widgetData(), but appends query params to the widget's
     *  data_url (e.g. the Alarm-Signal model selector re-fetching with
     *  ?model=ears|outbreak|seasonal). Cached per (widget_id + query) so each
     *  model keeps its own resolved rows. Null when unbound / failed / empty →
     *  the caller renders the synthetic fallback (seam contract unchanged). */
    widgetDataParam(widgetId, params) {
      const base = this._specDataUrls[widgetId];
      if (!base) return Promise.resolve(null);
      const qs = Object.entries(params || {})
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
        .join('&');
      const url = qs ? base + (base.includes('?') ? '&' : '?') + qs : base;
      const cacheKey = widgetId + '?' + qs;
      if (!(cacheKey in this._widgetData)) {
        this._widgetData[cacheKey] = authFetch(url.replace(/^\/api\//, '/gw/'))
          .then(r => (r.ok ? r.json() : null))
          .then(payload => {
            const d = payload?.data;
            if (!d || !Array.isArray(d.rows) || d.rows.length === 0) return null;
            return this.rowsToObjects(d.columns || [], d.rows);
          })
          .catch(() => null);
      }
      return this._widgetData[cacheKey];
    },

    /** {columns, rows} → array of row objects. The gateway already returns
     *  dict-shaped rows (trino_client zips column names in); tolerate
     *  positional-array rows too so the seam survives a fetcher change. */
    rowsToObjects(columns, rows) {
      const names = (columns || []).map(c => (typeof c === 'string' ? c : (c?.name ?? c?.id)));
      return (rows || []).map(r => Array.isArray(r)
        ? Object.fromEntries(names.map((n, i) => [n, r[i]]))
        : r);
    },

    // ── small shared helpers for the live adapters ──
    /** '2026W9' / '2026-W09' → sortable ordinal (DHIS2 weekly periods are NOT
     *  zero-padded, so lexical sort breaks across W9→W10). */
    _isoWeekOrd(w) {
      const m = /^(\d{4})-?W(\d{1,2})$/.exec(String(w || ''));
      return m ? (+m[1]) * 100 + (+m[2]) : 0;
    },
    /** Mart region_id (2-letter) → SPA region name; passes through unknowns. */
    _regionName(id) { return REGION_BY_ID[id] || id || '—'; },

    renderActive() {
      // Authorization gate — App.tsx skips the JSX shell of non-granted
      // pages with the same check; nothing may be drawn for them either.
      if (!this.pageGranted(this.active)) return;
      const fn = ({
        // overview + disease + resource are now catalog-driven (src/widgets/* via CatalogPage).
        overview: ()=>{},
        disease:  ()=>{},
        resource: ()=>{},
        // All catalog-driven now (src/sections/CatalogPage → runtime/PageRenderer
        // over src/widgets/*). biApp draws nothing for these pages; the old
        // static-manifest render path was retired 2026-07-04 (see _archive).
        service:  ()=>{},
        predictions: ()=>{},     // React-only page; biApp doesn't draw anything
        export:   ()=>{},
        settings: ()=>{},
      })[this.active];
      if (fn) fn.call(this);
    },


    sv: { _data: null, _widgetState: {} },
  };
}

// ── React subscription layer ───────────────────────────────────────────
// biApp() returns a plain object. We wrap it in a thin reactive proxy so
// React useSyncExternalStore() can subscribe to state changes triggered
// by any of biApp's setters. Triggered explicitly via `notify()` rather
// than via Proxy (which would over-fire on chart-rendering inner state).
const _subscribers = new Set<() => void>();
export function subscribe(fn: () => void): () => void {
  _subscribers.add(fn);
  return () => _subscribers.delete(fn);
}
export function notify(): void {
  for (const fn of _subscribers) fn();
}

let _instance: any = null;
export function getBiApp(): any {
  if (_instance) return _instance;
  _instance = biApp();
  // Patch in $nextTick (used heavily inside imperative methods to wait
  // for DOM render — we map to microtask since React's render is sync).
  _instance.$nextTick = (fn: () => void) => queueMicrotask(fn);
  // Patch every method that mutates display state to notify React.
  // Only top-level UI state needs to round-trip to React (active, openFilter,
  // alertModal, filters, etc.) — the catalog widget runtime owns its own DOM.
  return _instance;
}

export function initBiApp(): any {
  const app = getBiApp();
  if (!(window as any).__biApp) {
    app.init();
  }
  return app;
}

export { REGIONS, PROGRAMMES, DISEASES, DISEASE_NAME, PERIOD_OPTS, COMMODITIES };
