/**
 * useProfile — the country profile and this surface's copy deck.
 *
 * Everything that makes this page be about one country — masthead, headline,
 * the name of an administrative level, the map it draws — is data served by the
 * gateway at /api/profile, proxied same-origin. Swapping country is a different
 * profile directory on the host, not a rebuild.
 *
 * Two deliberate choices:
 *
 *   The fetch starts at MODULE LOAD, not on mount, so it is already in flight
 *   while React boots. The masthead is above the fold; a visible swap from
 *   fallback text to real text is the thing worth avoiding.
 *
 *   FALLBACK, always. If the gateway is unreachable or the profile is missing,
 *   `BUNDLED` renders — the same English that shipped before profiles existed.
 *   A public dashboard with a generic masthead is a working page; one that
 *   waits for a network call is not. This mirrors useArticles.
 */
import { useEffect, useState } from 'react';

export type Level = { code: string; singular: string; plural: string };

export type Profile = {
  active: string;
  label: string;
  country: { name: string; official_name: string; adjective: string; iso2: string; iso3: string;
             native?: { lang?: string; country_name?: string } };
  ministry: { abbr: string; name: string; native_name: string; logo?: string };
  platform: { name: string; abbr: string; native_name: string };
  geography: { levels: Level[]; admin1?: string; world?: string };
  brand: { accent: string };
  geo_facts?: {
    bbox?: [number, number, number, number];
    centroid?: [number, number];
    globe_rotation_deg?: number;
    admin1_names?: string[];
    admin1_count?: number;
  };
};

/** What shipped before profiles existed. Also the shape contract. */
export const BUNDLED: Profile = {
  active: 'bundled',
  label: 'Ethiopia',
  country: {
    name: 'Ethiopia', official_name: 'Federal Democratic Republic of Ethiopia',
    adjective: 'Ethiopian', iso2: 'ET', iso3: 'ETH',
    native: { lang: 'am', country_name: 'ኢትዮጵያ' },
  },
  ministry: { abbr: 'FMoH', name: 'Federal Ministry of Health', native_name: 'የጤና ሚኒስቴር',
              logo: 'logo-fmoh.png' },
  platform: { name: 'National Health Data Warehouse', abbr: 'NHDW',
              native_name: 'የብሔራዊ የጤና መረጃ ማከማቻ' },
  geography: {
    levels: [
      { code: 'admin1', singular: 'Region', plural: 'Regions' },
      { code: 'admin2', singular: 'Zone', plural: 'Zones' },
      { code: 'admin3', singular: 'Woreda', plural: 'Woredas' },
      { code: 'admin4', singular: 'Kebele', plural: 'Kebeles' },
    ],
  },
  brand: { accent: '#0374b8' },
};

export type Copy = Record<string, any>;

/** The public deck as it shipped, used whenever the served one is unavailable
 *  or is missing a key. Keys mirror copy/public.json. */
export const BUNDLED_COPY: Copy = {
  govbar: {
    skip: 'Skip to content', mark_text: 'NHDW',
    mark_tag: 'Federal Ministry of Health · Ethiopia',
    nav: { home: 'Home', data: 'Open data', articles: 'Articles' },
    request_access: 'Request access', dashboards: 'Dashboards',
  },
  hero: {
    strip_volume: 'Vol. 01', strip_series: 'Public Series',
    strip_owner: 'Federal Ministry of Health · የጤና ሚኒስቴር',
    eyebrow: 'Public health information service',
    headline_lead: "Ethiopia's health data,", headline_accent: 'in one place.',
    headline_native: 'የብሔራዊ የጤና መረጃ ማከማቻ',
    lede: 'A single trusted entrance to dashboards, open data, and the analytic consoles '
        + 'that power public-health decisions, from a national bulletin down to a single '
        + 'woreda in any of the 14 regions.',
    trust: 'Privacy-protected national health data',
    trust_title: 'Aggregate and privacy-protected, k-anonymity at least 5, '
               + 'sourced from national health systems',
    cta_primary: 'Open the data catalogue', cta_secondary: 'Read the latest bulletins',
  },
  footer: {
    brand_line: 'National Health Data Warehouse · NHDW',
    owner_line: 'Federal Ministry of Health · Federal Democratic Republic of Ethiopia',
    columns: [
      { title: 'About', links: ['Methodology', 'Governance', 'Contact'] },
      { title: 'Open', links: ['API docs', 'dbt docs', 'Code repository'] },
      { title: 'Legal', links: ['Privacy notice', 'Terms of use', 'Data licence'] },
    ],
  },
};

type Loaded = { profile: Profile; copy: Copy };
let cache: Loaded | null = null;
const waiters = new Set<(v: Loaded) => void>();

/** Deep-merge served copy OVER the bundled deck, so a profile that omits a key
 *  inherits the English rather than rendering a blank. A partial deck is a
 *  legitimate thing to ship — most countries only need the masthead changed. */
function merge(base: any, over: any): any {
  if (over === undefined || over === null) return base;
  if (Array.isArray(base) || Array.isArray(over)) return over ?? base;
  if (typeof base !== 'object' || typeof over !== 'object') return over;
  const out: Record<string, any> = { ...base };
  for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
  return out;
}

const ok = (o: any) => o && typeof o === 'object' && !o._unavailable && Object.keys(o).length > 0;

async function load(): Promise<Loaded> {
  let profile = BUNDLED;
  let copy = BUNDLED_COPY;
  try {
    const [p, c] = await Promise.all([
      fetch('/api/proxy/profile').then(r => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/proxy/profile/copy/public').then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (ok(p) && p.country?.name) profile = merge(BUNDLED, p);
    if (ok(c)) copy = merge(BUNDLED_COPY, c);
  } catch {
    /* keep the bundled pair */
  }
  // The brand accent is a profile fact, and several things downstream read it
  // from CSS rather than from props — the hero globe picks up --accent to colour
  // its particles. Setting the variable here means one value in the profile
  // drives the whole surface, instead of the globe and the chrome drifting.
  try {
    if (profile.brand?.accent) {
      document.documentElement.style.setProperty('--accent', profile.brand.accent);
    }
  } catch { /* non-browser context (tests) */ }

  const loaded = { profile, copy };
  cache = loaded;
  waiters.forEach(w => w(loaded));
  waiters.clear();
  return loaded;
}

// in flight before React mounts
const inflight = load();

export function useProfile(): Loaded {
  const [state, setState] = useState<Loaded>(cache ?? { profile: BUNDLED, copy: BUNDLED_COPY });
  useEffect(() => {
    if (cache) { setState(cache); return; }
    let live = true;
    const onDone = (v: Loaded) => { if (live) setState(v); };
    waiters.add(onDone);
    inflight.then(onDone).catch(() => { /* fallback already showing */ });
    return () => { live = false; waiters.delete(onDone); };
  }, []);
  return state;
}

/** Name of an administrative level, for copy that has to say it inline —
 *  "region" in Ethiopia, "province" elsewhere. */
export function levelName(p: Profile, code: string, plural = false): string {
  const l = p.geography?.levels?.find(x => x.code === code);
  if (!l) return plural ? 'areas' : 'area';
  return plural ? l.plural : l.singular;
}
