/**
 * Ethiopia geography helper — DASHBOARD level (internal-bi only). Loads the
 * regions geojson once and registers it with echarts under 'ethiopia', and
 * normalizes region names so mart region_id → SPA name → geojson feature match.
 */
import * as echarts from 'echarts';

let _geo: any = null;
let _loading: Promise<any> | null = null;

/** Fetch + register the Ethiopia regions map exactly once. Returns the geojson. */
export function loadEthGeo(): Promise<any> {
  if (_geo) return Promise.resolve(_geo);
  if (_loading) return _loading;
  _loading = fetch('/static/assets/eth-regions.geojson')
    .then(r => r.json())
    .then(geo => { _geo = geo; echarts.registerMap('ethiopia', geo); return geo; });
  return _loading;
}

/** Loose region-name key for matching SPA names ↔ geojson feature names. */
export const normRegion = (s: string): string =>
  (s || '').toLowerCase().replace(/[-\s]+/g, '').replace('gambella', 'gambela');

/** The geojson feature name echarts matches against, for a given SPA region. */
export function geoNameFor(geo: any, region: string): string {
  const target = normRegion(region);
  const f = (geo.features || []).find((x: any) => normRegion(x.properties.name) === target);
  return f ? f.properties.name : region;
}
