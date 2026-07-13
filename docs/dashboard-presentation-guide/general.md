# General — shared design, terminology & interpretation rules

*Part of the NHDW Dashboard Presentation Guide — see [README.md](README.md).*

Read this once before presenting any page. Everything here is reused across the
Internal-BI pages (and mostly across the public/admin dashboards too), so the
page files do not repeat it — they link back here.

---

## 1. Page → section → widget hierarchy

Every Internal-BI page is assembled from a **catalog**, not hand-coded layout.
The truth lives in
`6_access-points/dashboards/internal-bi/catalog/`:

- **`pages/*.yaml`** — one page (e.g. `internal-bi/overview`), its title, the
  **global filters** it exposes, and the ordered list of sections.
- **`sections/*.yaml`** — one section (a titled band on the page), its `columns`
  (always a 12-column grid), and the ordered widgets with their `col_span` /
  `row_span`.
- **`ui/src/widgets/<id>/widget.yaml`** — one widget's id, display `title`, and
  `kind` (kpi / table / chart / map / funnel / heatmap / treemap / flow /
  custom). The `requires:` block is the OPA access contract (subject/verb/
  granularity/sensitivity).

So a page renders as: a **filter bar** at the top, then a vertical stack of
**sections**, each section a titled band containing one or more **widget cards**
laid out on a 12-column grid.

### Section anatomy
- **Title** (e.g. "Where to Act Now") and an optional **eyebrow** (a small
  kicker above the title, e.g. "EWARS · notifiable diseases").
- `dense: true` on every section — a compact grid with tight gutters.
- Widgets flow left-to-right, wrapping to a new row when their spans overflow 12
  columns. `col_span: 12` = full width; `col_span: 3` = a quarter-width tile
  (four tiles per row).

### Card equal-height / reflow
The grid runtime (`runtime/reactivity.ts::packRows`) packs widgets greedily by
their declared `col_span`, then **grows an underfilled row's widgets
proportionally** so the row always fills all 12 tracks. At rest the layout
matches the catalog exactly; when the filter bar hides a widget, the remaining
widgets in that row reflow to fill the gap. Cards in a row render at **equal
height**. **Talking point:** "the layout is declarative and self-healing — hide
a widget and its neighbours expand to fill the row, so the page never looks
broken."

---

## 2. The global filter bar

Each page declares which filters it shows (`filters:` in the page YAML):

| Page | Filters exposed |
|------|-----------------|
| Overview | region |
| Disease Surveillance | region, period, programme |
| Resource Management | region, period, programme, commodity |
| Service Performance | region, period, programme |

Filter **option lists** are fixed reference tables in
`ui/src/widgets/_shared/reference.ts` (and mirrored in `biApp.ts`):

- **Region** — the 14 Ethiopian regions: Addis Ababa, Afar, Amhara, Benishangul
  Gumuz, Central Ethiopia, Dire Dawa, Gambella, Harari, Oromia, Sidama, Somali,
  South Ethiopia, South West Ethiopia, Tigray. Each maps to a 2-letter mart
  `region_id` (AA, AF, AM, BG, CE, DD, GA, HA, OR, SI, SO, SE, SW, TI).
- **Programme** — HIV, TB, Immunization (EPI), MNCH, NCD, Malaria, Family
  Planning, Nutrition (filter value = the uppercase `programme_id` code).
- **Period** — see §4 below.
- **Commodity** — a supply-chain commodity list (Resource page only).

### Filter behaviour — "adapt or hide" (owner-approved contract)
This is a distinctive, defensible feature. The rules (from
`runtime/reactivity.ts` and gateway `fetchers.py`):

1. **A dim is "active" only when it holds a real value** (anything but `all`).
   The default filter state is `all` for every dim, so at rest **nothing is
   filtered** (`runtime/filterBus.ts` snapshot: `geography/programme/period` all
   default to `all`).
2. **Each widget declares `supports: {geography, programme, period, commodity}`**
   — computed by the gateway from whether the widget's underlying mart genuinely
   has a column for that dimension.
3. **Adapt:** if a widget supports an active dim, it **re-fetches narrowed** to
   that value.
4. **Hide:** if a dim is active and the widget declares `supports[dim] === false`,
   the widget **hides itself** (and its row reflows) rather than showing a number
   that ignores the filter. A little "N widgets hidden at this scope" note
   explains the gap honestly.
5. **Narrow-only / role-capped:** a UI filter value can only **intersect** what
   the user's role/scope already allows — it can never widen access. The gateway
   folds UI filters into the OPA row-filter with `merge_ui_filters` (a value
   inside scope replaces it; a value outside scope keeps the tighter scope).

> **Why some widgets "disappear" when you pick a period.** Snapshot widgets
> (e.g. the stockout-watch hero, the stock heatmap's current-month view) describe
> the **current state**. A rolling time window can't change "how much stock is on
> hand right now", so rather than pretend to react they **honestly hide** when a
> specific period is selected. This is deliberate anti-"harness-lie" design, not a
> bug. If asked, say: "that widget is a current-state snapshot; it hides under a
> period filter instead of returning identical data and pretending it reacted."

---

## 3. Geographic levels & the org hierarchy

The health-system geography, coarse → fine, as it appears in the data:

- **National** — whole-country aggregates (the Decision Brief, national KPIs).
- **Region** — 14 regions, keyed by 2-letter `region_id`. The primary map/table
  grain for most widgets.
- **Zone** — an administrative level between region and woreda; present in the
  DHIS2 org-unit path but rarely a widget grain on its own.
- **Woreda** (district) — the finest surveillance grain. Disease widgets rank
  and drill to woreda (`woreda_uid`, display `woreda_name`). Woreda codes look
  like `WOR-XX-…` where `XX` is the region.
- **Facility** — the finest registry grain (from the Master Facility Registry,
  MFR). Facility codes look like `FAC-<region>-…`. Facility tiers observed:
  HP/HC/PHC (primary care), PH/GH/SH (hospitals), MC/DS.

Region is decoded from woreda/facility codes and from the DHIS2 org-unit path
(`/root/region/zone/woreda/facility`). **Supply data is region-grain at best** —
HCMIS stock lives at EPSS *hubs* (warehouses), attributed to the regions each hub
serves via a catchment weighting; there is no honest facility-level supply cut.

---

## 4. Time periods

The period filter sends one canonical key. The window is **rolling and anchored
at the data's own latest date** (`max` of the widget's time column) — **not** at
today's clock — because the demo data ends mid-2026. Definitions from
`fetchers.py`:

| Key | Label | Meaning (relative to the scoped data's max date) |
|-----|-------|--------------------------------------------------|
| `all` | All time | No period filter (default) |
| `last_4wk` | Last 4 weeks | 28 days back from the latest date |
| `last_12wk` | Last 12 weeks | 84 days back |
| `last_6mo` | Last 6 months | 6 months back |
| `last_12mo` | Last 12 months | 12 months back |
| `last_24mo` | Last 24 months | 24 months back |
| `ytd` | Year to date | From Jan 1 of the anchor year |
| `efy_ytd` | Ethiopian FY to date | From the Ethiopian fiscal-year start (≈ July / Hamle) of the year containing the anchor date |

**Grain caveats you should know:**
- Weekly marts use ISO-week `week_start` dates (`date` grain).
- Monthly marts (HMIS coverage, supply) use `YYYY-MM` `month_id` (`month` grain);
  a window counts months **back inclusive of the anchor month**.
- The **cascade funnels are year-grain** (`year_id` = `'2023'`…`'2026'`), the
  coarsest cut: sub-year windows and `ytd` collapse to the anchor year;
  `last_24mo` spans the anchor year plus the previous one. This keeps the funnels
  visible under the period filter instead of hiding the whole band.

The Ethiopian fiscal / HMIS reporting year (EFY) runs roughly **Hamle → Sene
(≈ July → June)**, which is why `efy_ytd` exists as a distinct option.

---

## 5. Denominators & the "honest NULL" rule

Two ideas the audience must not confuse:

- **Denominator choices are explicit.** Coverage is *facilities reporting ÷
  facilities expected*; supply availability is *consumption-volume-weighted*, not
  a flat commodity average; incidence is *cases per 100,000 population*. Each
  metric's exact denominator is in [metric-glossary.md](metric-glossary.md).
- **A missing signal is shown as `NULL`, never faked.** Many widgets carry
  columns that are deliberately `NULL` because the underlying feed does not exist
  in the demo yet — e.g. outbreak response-team (RRT) status, monetary
  value-at-risk (no pricing feed), facilities-affected counts (supply is
  region-grain). The code comments call these "HONEST NULL". **Talking point:**
  "empty cells here are a feature: the warehouse refuses to invent numbers it
  can't source."

Zero-denominator handling is uniform: every ratio uses `NULLIF(denominator, 0)`
so a divide-by-zero yields `NULL` (an empty cell), not an error or a fake 0/100.

---

## 6. Colour & trend semantics

Colour is **semantic and muted** (overhaul: "executive-suitable … subtle
direction cues, not aggressive signals"). CSS status tokens
(`styles/base.css`):

| Token | Colour | Meaning |
|-------|--------|---------|
| `--good` | soft green `#3f9d70` | on-track / healthy / positive direction |
| `--watch` | amber `#C6893F` | caution / borderline |
| `--alert` | muted red `#CB5B62` | escalation / negative — **red is reserved for genuine alerts only** |
| `--info` | blue `#3B82F6` | neutral informational |

Chart palette (`theme.ts`) is a **warm brown/tan** design language: a
charcoal→tan sequential ramp for intensity, a sand→brown 7-stop **choropleth**
for maps, a cool blue-gray ramp for facility tiers, and a burnt-orange **burden**
ramp (deliberately orange, not red, so a disease map reads as "burden intensity"
not "alarm").

**Status band thresholds** recur across widgets (all from the fetcher SQL):
- Attainment / coverage: `≥ 80` on-track, `60–80` watch, `< 60` at-risk.
- Reporting completeness confidence: `≥ 90` High, `70–90` Medium, `< 70` Low.
- Source-trust pulse: `≥ 90` ok, `80–90` watch, `< 80` poor (graded against the
  HLR's own §3.2.4 reporting norms, not invented thresholds).
- Agreement (reported-vs-recorded): `≥ 80` OK, `60–80` Watch, `< 60` Alert.

Trend arrows (▲/▼) with a "vs prior week/month" delta appear on KPI tiles; the
arrow direction is coloured good/watch by whether the movement is favourable —
but many tiles carry **no delta at all** (shown as blank) when there is no honest
prior-period figure to compare against.

---

## 7. Data refresh & freshness

- **How a widget gets data (at runtime):** the SPA calls the gateway
  `/api/permissions/widget/<id>/data` endpoint (proxied as `/gw/…`). The gateway
  runs the widget's bound SQL through **Trino** against the Postgres marts,
  **after** an OPA allow decision. Results are **cached per (url + params) for the
  browser session** (`runtime/dataHook.ts`); changing a filter invalidates the
  cache and re-fetches.
- **Freshness signal in the UI:** several widgets surface a "data through …" /
  "latest week/month" value taken from the `max` date of the data actually in
  scope, so the user can see how current the underlying feed is.
- **How often the marts themselves rebuild:** the marts are produced by the dbt
  pipeline during seeding/refresh runs — the demo is seeded once and the data
  **ends mid-2026** (a fixed snapshot). There is **no scheduled auto-refresh
  visible in the dashboard code**; a production refresh cadence is an operations
  decision. **_Requires confirmation_** — the exact production refresh schedule
  is not defined in the dashboard/gateway code.

---

## 8. Empty & error states

One code path governs all of them (`runtime/dataHook.ts`): a permitted-stub, an
empty result set, a `403` denied-at-the-mart, or any network error **all resolve
to `null`**, and the widget host draws its **empty state** (a short message like
"No brief available."). There is **no synthetic fallback** — an empty widget
means "no real data to show here", which for a scoped user can also mean "you
don't have access to this slice". **Talking point:** "an empty widget is honest;
it's either no data or no permission — never a placeholder number."

---

## 9. Access control (why a user may see less than you do)

Every widget read passes through the gateway's **Policy Enforcement Point → OPA →
Trino**. The widget declares OPA resource attributes (subject like `PRG`/`PRD`,
`data_class` like `DC.PRO`/`DC.STK`/`DC.PRF`/`DC.CAT`, granularity, sensitivity).
OPA returns an allow/deny **and a row-filter obligation** (e.g. "only region OR").
The gateway AND-applies that row-filter to the SQL, and the UI filter can only
narrow it further. So a **regional-bureau user sees only their region's rows**,
and a widget they may not read at all simply renders empty. When you demo
role-scoping, this is the mechanism to point at.

---

## 10. Shared terminology (quick glossary)

| Term | Meaning in this system |
|------|------------------------|
| **IDSR** | Integrated Disease Surveillance & Response — Ethiopia's notifiable-disease reporting, carried through DHIS2 as weekly aggregates. |
| **EWARS / EARS** | Early-Warning Alert & Response System / Early Aberration Reporting System — the anomaly-detection approach behind the disease signal + alarm widgets. |
| **HMIS** | Health Management Information System — routine monthly service data (DHIS2). |
| **DHIS2** | The district health information platform; source of HMIS + IDSR + population data. |
| **HCMIS / EPSS** | Health Commodity Management Information System / Ethiopian Pharmaceuticals Supply Service — the drug supply-chain source (stock, consumption). |
| **MFR** | Master Facility Registry — the authoritative list of facilities (and equipment/workforce). |
| **mBrana** | A USSD-based facility stock-log feed (last-mile / cold-chain availability). |
| **EthioEMR** | The demo electronic medical record feed (patient-level observations, consent-gated). |
| **MOS** | Months of Stock = stock on hand ÷ average monthly consumption. |
| **AMC** | Average Monthly Consumption (12-month moving). |
| **CFR** | Case Fatality Rate = deaths ÷ cases. |
| **P(alarm) / alarm_prob** | Model-estimated probability a woreda×disease is in aberration this week (from the ML forecast run). |
| **Completeness** | Reports/records received ÷ expected. |
| **Cascade / continuum** | A care funnel (e.g. tested → positive → on treatment → suppressed); each step as a % of the entry step. |
| **HSDIP** | Health Sector Development / Investment Plan — the public dashboard's target reference (see [public-portal.md](public-portal.md)). |
| **EFY** | Ethiopian Fiscal Year (≈ July–June). |
| **k-anonymity (k≥5)** | Public aggregates suppress any cell backed by fewer than 5 facilities. |

---

## 11. Universal interpretation guidelines (say these often)

1. **"This is real pipeline data, governed and access-controlled"** — not a mock.
2. **"Empty/NULL means no data or no permission, never a fake number."**
3. **"Windows anchor at the data's latest date, not today"** — the demo ends
   mid-2026, so "last 4 weeks" means the last 4 weeks *of the data*.
4. **"Supply is region-grain; surveillance goes to woreda"** — don't over-claim
   facility-level supply precision.
5. **"Colours are muted on purpose; red means act."**
6. **"A scoped user sees only their slice"** — the same page tells a smaller,
   truthful story for a regional user.
