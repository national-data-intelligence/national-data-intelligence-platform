/**
 * Ethiopia geography helper — DASHBOARD level (internal-bi only). Loads the
 * regions geojson once and registers it with echarts under 'ethiopia', and
 * normalizes region names so mart region_id → SPA name → geojson feature match.
 */
import * as echarts from 'echarts';

let _geo: any = null;
let _loading: Promise<any> | null = null;
let _ctxGeo: any = null;
let _ctxLoading: Promise<any> | null = null;

/** Fetch + register the Ethiopia regions map exactly once. Returns the geojson. */
export function loadEthGeo(): Promise<any> {
  if (_geo) return Promise.resolve(_geo);
  if (_loading) return _loading;
  _loading = fetch('/static/assets/eth-regions.geojson')
    .then(r => r.json())
    .then(geo => { _geo = geo; echarts.registerMap('ethiopia', geo); return geo; });
  return _loading;
}

/** Ethiopia regions PLUS a faint surrounding-land context layer, merged into ONE
 *  FeatureCollection and registered under 'eth-ctx' (cached once). The real
 *  low-res world-land geojson supplies the neighbouring landmass so a burden map
 *  sits on actual earth/sea instead of an abstract grid. World-land features come
 *  FIRST (drawn UNDER), tagged `properties.__ctx = true` and given a unique
 *  `properties.name` = `ctx-<i>` (echarts needs distinct names); the Ethiopia
 *  region features are appended UNCHANGED (drawn last = on top, still interactive).
 *  A single map = a single coordinate system → the region tiles and the context
 *  land are guaranteed aligned. */
export function loadEthContextGeo(): Promise<any> {
  if (_ctxGeo) return Promise.resolve(_ctxGeo);
  if (_ctxLoading) return _ctxLoading;
  _ctxLoading = Promise.all([
    loadEthGeo(),
    fetch('/static/assets/world-land-110m.geojson').then(r => r.json()),
  ]).then(([eth, world]) => {
    const ctxFeats = (world.features || []).map((f: any, i: number) => ({
      ...f,
      properties: { ...(f.properties || {}), __ctx: true, name: `ctx-${i}` },
    }));
    const merged: any = { type: 'FeatureCollection', features: [...ctxFeats, ...(eth.features || [])] };
    echarts.registerMap('eth-ctx', merged);
    _ctxGeo = merged;
    return merged;
  });
  return _ctxLoading;
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
