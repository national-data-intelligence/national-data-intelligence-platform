/**
 * Internal-BI reference tables + tiny pure helpers, at DASHBOARD level.
 *
 * These are copied into this dashboard on purpose — NEVER share a widget helper
 * or reference table across dashboards (repetition over shared coupling — a project rule). Widgets import from
 * here instead of the legacy biApp engine, so each widget folder depends only on
 * dashboard-scoped, pure code (keeps them plugin-shaped: the only cross-shell
 * dependency a widget has is its WidgetCtx).
 */

export const REGIONS = [
  'Addis Ababa', 'Afar', 'Amhara', 'Benishangul Gumuz', 'Central Ethiopia',
  'Dire Dawa', 'Gambella', 'Harari', 'Oromia', 'Sidama', 'Somali',
  'South Ethiopia', 'South West Ethiopia', 'Tigray',
];

/** 2-letter mart region_id → SPA region name (matches MFR/IDSR org-unit codes). */
export const REGION_BY_ID: Record<string, string> = {
  AA: 'Addis Ababa', AF: 'Afar', AM: 'Amhara', BG: 'Benishangul Gumuz',
  CE: 'Central Ethiopia', DD: 'Dire Dawa', GA: 'Gambella', HA: 'Harari',
  OR: 'Oromia', SI: 'Sidama', SO: 'Somali', SE: 'South Ethiopia',
  SW: 'South West Ethiopia', TI: 'Tigray',
};
export const regionName = (id: string): string => REGION_BY_ID[id] || id || '-';

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
