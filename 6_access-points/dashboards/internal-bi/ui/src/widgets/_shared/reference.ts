/**
 * Internal-BI reference tables + tiny pure helpers, at DASHBOARD level.
 *
 * These are copied into this dashboard on purpose — NEVER share a widget helper
 * or reference table across dashboards (repetition over shared coupling — a project rule). Widgets import from
 * here instead of the legacy biApp engine, so each widget folder depends only on
 * dashboard-scoped, pure code (keeps them plugin-shaped: the only cross-shell
 * dependency a widget has is its WidgetCtx).
 *
 * PROFILE-DRIVEN SINCE 2026-09. The tables below are no longer the source of
 * truth — they are the FALLBACK. `loadReference()` fills them from
 * /gw/profile/reference, which the gateway compiles from the entity model the
 * warehouse itself was built from. Before that, this file, `biApp.ts` and the
 * Control Tower's `ct/data/plan.ts` each declared the region list separately,
 * three chances to drift from the data.
 *
 * They are populated IN PLACE (length = 0, then push) rather than reassigned,
 * because twenty-nine modules already hold a reference to these arrays and must
 * see the update without any of them changing. `main.tsx` awaits the load before
 * the first render, so a widget never sees a half-filled table.
 */

export const REGIONS: string[] = [
  'Addis Ababa', 'Afar', 'Amhara', 'Benishangul Gumuz', 'Central Ethiopia',
  'Dire Dawa', 'Gambella', 'Harari', 'Oromia', 'Sidama', 'Somali',
  'South Ethiopia', 'South West Ethiopia', 'Tigray',
];

/** Display name (and region code) → the name the boundary file uses, resolved
 *  at profile BUILD time by the one process that has both lists in front of it.
 *  Replaces the runtime normaliser in _shared/geo.ts, which carried a literal
 *  `.replace('gambella','gambela')` to paper over two sources spelling the same
 *  place differently. Keyed by BOTH the formal name and the code so a caller
 *  holding either can resolve. */
export const REGION_GEO_NAME: Record<string, string> = {};

/** The same regions as {code,name} — the shape the filter chrome wants, where the
 *  CODE is the value the marts key on (region_id) and the name is only a label.
 *  Kept here so `biApp.ts` can consume it instead of declaring the list a second
 *  time in a second shape. */
export const REGION_OPTIONS: Array<{ code: string; name: string }> = [
  { code: 'AA', name: 'Addis Ababa' },       { code: 'AF', name: 'Afar' },
  { code: 'AM', name: 'Amhara' },            { code: 'BG', name: 'Benishangul-Gumuz' },
  { code: 'CE', name: 'Central Ethiopia' },  { code: 'DD', name: 'Dire Dawa' },
  { code: 'GA', name: 'Gambella' },          { code: 'HA', name: 'Harari' },
  { code: 'OR', name: 'Oromia' },            { code: 'SE', name: 'South Ethiopia' },
  { code: 'SI', name: 'Sidama' },            { code: 'SO', name: 'Somali' },
  { code: 'SW', name: 'South West Ethiopia' },{ code: 'TI', name: 'Tigray' },
];

/** Commodities, for the supply filters. Refilled from the profile; this list is
 *  the fallback, so the filter still populates when the gateway is unreachable.
 *  Note the code IS the name here — the supply marts key on the display string
 *  rather than a short code, unlike regions and programmes. */
export const COMMODITIES: Array<{ code: string; name: string }> = [
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

/** What the geography filter's wildcard option is called. "All Ethiopia" was a
 *  country name sitting inside a UI string; it comes from the profile now. */
export const scopeLabels = { allGeography: 'All Ethiopia' };

/** 2-letter mart region_id → SPA region name (matches MFR/IDSR org-unit codes). */
export const REGION_BY_ID: Record<string, string> = {
  AA: 'Addis Ababa', AF: 'Afar', AM: 'Amhara', BG: 'Benishangul Gumuz',
  CE: 'Central Ethiopia', DD: 'Dire Dawa', GA: 'Gambella', HA: 'Harari',
  OR: 'Oromia', SI: 'Sidama', SO: 'Somali', SE: 'South Ethiopia',
  SW: 'South West Ethiopia', TI: 'Tigray',
};
export const regionName = (id: string): string => REGION_BY_ID[id] || id || '-';

// ── profile loading ─────────────────────────────────────────────────────────

/** Replace an array's CONTENTS, keeping its identity so existing imports see it. */
function refill<T>(target: T[], next: T[]): void {
  if (!next?.length) return;            // an empty profile table keeps the fallback
  target.length = 0;
  target.push(...next);
}

function rekey(target: Record<string, string>, next: Record<string, string>): void {
  if (!next || !Object.keys(next).length) return;
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, next);
}

let loaded = false;

/**
 * Fill the tables from the active country profile. Awaited by main.tsx before
 * the first render.
 *
 * Never throws and never blocks for long: on any failure the bundled Ethiopian
 * tables stay in place and the dashboard renders exactly as it did before
 * profiles existed. A dashboard whose region filter is one deploy stale is a
 * working dashboard; one that will not paint because a fetch hung is not.
 */
export async function loadReference(timeoutMs = 4000): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch('/gw/profile/reference', { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return;
    const ref = await res.json();

    const regions: Array<{ code: string; name: string; geo_name?: string }> = ref.regions || [];
    if (regions.length) {
      // The SPA's region NAME is the short display form the boundary file uses
      // ("Oromia"), not the entity model's formal one ("Oromia Region") — the
      // formal name is correct on a report and too long for a filter chip.
      refill(REGIONS, regions.map(r => r.geo_name || r.name));
      refill(REGION_OPTIONS, regions.map(r => ({ code: r.code, name: r.geo_name || r.name })));
      rekey(REGION_BY_ID, Object.fromEntries(
        regions.map(r => [r.code, r.geo_name || r.name])));
      // key on every form a caller might hold: the formal name from the entity
      // model, the short display name, and the region code.
      const geoMap: Record<string, string> = {};
      for (const r of regions) {
        const target = r.geo_name || r.name;
        if (!target) continue;
        geoMap[r.name] = target;
        geoMap[target] = target;
        if (r.code) geoMap[r.code] = target;
      }
      rekey(REGION_GEO_NAME, geoMap);
    }

    refill(PROGRAMMES, (ref.programmes || [])
      .filter((p: any) => p?.code)
      .map((p: any) => ({ code: p.code, name: p.name || p.code })));

    refill(COMMODITIES, (ref.commodities || [])
      .filter((c: any) => c?.code)
      .map((c: any) => ({ code: c.code, name: c.name || c.code })));

    refill(DISEASES, (ref.diseases || [])
      .filter((d: any) => d?.key)
      .map((d: any) => ({ key: d.key, name: d.name || d.key, climate: !!d.climate })));
    rekey(DISEASE_NAME, Object.fromEntries(DISEASES.map(d => [d.key, d.name])));

    // "All Ethiopia" → "All Zambia". Served already-resolved by the gateway.
    try {
      const cres = await fetch('/gw/profile/copy/common');
      if (cres.ok) {
        const common = await cres.json();
        if (common?.scope?.all_geography) scopeLabels.allGeography = common.scope.all_geography;
      }
    } catch { /* label stays as bundled */ }
  } catch {
    /* bundled tables stand — see the doc comment */
  }
}

// {code,name}: value is the mart programme_id CODE (uppercase), name is the label.
// Mirrors biApp.ts PROGRAMMES so filter values ('MALARIA') match programme_id.
export const PROGRAMMES = [
  { code: 'HIV', name: 'HIV' },        { code: 'TB', name: 'TB' },
  { code: 'EPI', name: 'Immunization (EPI)' }, { code: 'MNCH', name: 'MNCH' },
  { code: 'NCD', name: 'NCD' },        { code: 'MALARIA', name: 'Malaria' },
  { code: 'FP', name: 'Family Planning' }, { code: 'NUTRITION', name: 'Nutrition' },
];

export interface Disease { key: string; name: string; climate: boolean; }
export const DISEASES: Disease[] = [
  { key: 'cholera', name: 'Cholera', climate: true }, { key: 'measles', name: 'Measles', climate: false },
  { key: 'awd', name: 'AWD', climate: true }, { key: 'malaria', name: 'Malaria', climate: true },
  { key: 'meningitis', name: 'Meningitis', climate: false }, { key: 'dengue', name: 'Dengue', climate: true },
  { key: 'yellowfever', name: 'Yellow fever', climate: true }, { key: 'pertussis', name: 'Pertussis', climate: false },
  { key: 'typhoid', name: 'Typhoid fever', climate: true }, { key: 'plague', name: 'Plague', climate: false },
  { key: 'rabies', name: 'Rabies', climate: false }, { key: 'tetanus', name: 'Neonatal tetanus', climate: false },
  { key: 'anthrax', name: 'Anthrax', climate: false }, { key: 'hepa', name: 'Hepatitis A', climate: true },
  { key: 'chikungunya', name: 'Chikungunya', climate: true }, { key: 'mpox', name: 'Mpox', climate: false },
  { key: 'covid19', name: 'COVID-19', climate: false }, { key: 'leishmaniasis', name: 'Visceral leishmaniasis', climate: true },
  { key: 'leptospirosis', name: 'Leptospirosis', climate: true }, { key: 'guineaworm', name: 'Guinea worm', climate: true },
];
export const DISEASE_NAME: Record<string, string> = Object.fromEntries(DISEASES.map(d => [d.key, d.name]));

export const PERIOD_OPTS: Record<string, string> = {
  last_4wk: 'Last 4 weeks', last_12wk: 'Last 12 weeks', last_6mo: 'Last 6 months',
  last_12mo: 'Last 12 months', last_24mo: 'Last 24 months', ytd: 'Year to date',
};
/** How many trailing weeks a period selects (client-side x-axis window). */
export const periodWeeks = (period: string): number =>
  ({ last_4wk: 4, last_12wk: 12, last_6mo: 26, last_12mo: 52, last_24mo: 52, ytd: 24, efy_ytd: 24 } as Record<string, number>)[period] || 52;

/** Is the current programme filter climate-sensitive (drives the climate band)? */
export function isClimateSensitive(programme: string): boolean {
  if (programme === 'all' || PROGRAMMES.some((p: { code: string }) => p.code === programme)) return true;
  const d = DISEASES.find(x => x.key === programme);
  return d ? d.climate : false;
}

/** Signal-chart UI model label → real ml run model id. */
export const signalModelId = (uiLabel: string): string =>
  ({ ears_c1: 'ears', farrington: 'outbreak', seasonal_naive: 'seasonal', ewars_csd: 'ewars_lite' } as Record<string, string>)[uiLabel] || 'ears';

/** '2026W9' / '2026-W09' → sortable ordinal (weekly periods aren't zero-padded). */
export function isoWeekOrd(w: string): number {
  const m = /^(\d{4})-?W(\d{1,2})$/.exec(String(w || ''));
  return m ? (+m[1]) * 100 + (+m[2]) : 0;
}
