import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import { WAREHOUSES, NODES, MOVEMENTS, WH_BY_ID, NODE_BY_ID, RUN_BY_ID, type Movement } from '../data/runtime';
import { filterMovements, type Slicer } from '../lib/select';

// register the pmtiles:// protocol once
let _protoInstalled = false;
function ensureProtocol() {
  if (_protoInstalled) return;
  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  _protoInstalled = true;
}

const ET_BOUNDS: [number, number, number, number] = [32.9, 3.3, 48.0, 15.0];

// muted route/node colors (dampened per feedback)
// Routes and borders are separated by HUE, not weight. Borders are neutral grey;
// routes are gold, which is the only warm element on a cool green basemap.
const C = {
  route: '#e0a520',        // background routes (gold)
  routeSel: '#a86a08',     // selected route (deep amber)
  node: '#7d8ba0',         // delivery node
  urgent: '#a8483c',       // deep terracotta, kept clear of the gold routes
  soon: '#7f6ea8',         // muted violet (an amber here would read as a route)
  hub: '#3a475b',          // hub ring
  truck: '#403a86',
  borderCountry: '#8d9096',   // Zambia outline (neutral grey, no blue cast)
  borderNeighbour: '#b9bcc0', // neighbouring country borders
  borderProvince: '#c9cdcd',  // province lines (faintest)
};

// Muted light basemap over the offline Protomaps vector source.
const BASEMAP_LAYERS: any[] = [
  { id: 'bg', type: 'background', paint: { 'background-color': '#dbe8f0' } },
  { id: 'earth', type: 'fill', source: 'protomaps', 'source-layer': 'earth', paint: { 'fill-color': '#d3e8b8' } },
  { id: 'landcover', type: 'fill', source: 'protomaps', 'source-layer': 'landcover',
    paint: { 'fill-color': ['match', ['get', 'kind'], 'forest', '#b9d69a', 'wood', '#b9d69a', 'grassland', '#cbe4a3', 'scrub', '#d5e6ad', 'farmland', '#eef0c2', '#cfe4ab'], 'fill-opacity': 0.9 } },
  { id: 'landuse-park', type: 'fill', source: 'protomaps', 'source-layer': 'landuse',
    filter: ['match', ['get', 'kind'], ['park', 'protected_area', 'nature_reserve'], true, false],
    paint: { 'fill-color': '#cbe0bd', 'fill-opacity': 0.5 } },
  // hillshade relief from the offline DEM — gives the land real terrain, natural-map feel
  { id: 'hillshade', type: 'hillshade', source: 'dem',
    paint: { 'hillshade-exaggeration': 0.42, 'hillshade-shadow-color': '#6f7d64',
      'hillshade-highlight-color': '#fbfdf6', 'hillshade-accent-color': '#8f9a7c' } as any },
  { id: 'water', type: 'fill', source: 'protomaps', 'source-layer': 'water', paint: { 'fill-color': '#9cccec' } },
  { id: 'roads-minor', type: 'line', source: 'protomaps', 'source-layer': 'roads', minzoom: 7,
    filter: ['match', ['get', 'kind'], ['minor', 'other'], true, false],
    paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.4, 12, 1.4], 'line-opacity': 0.7 } },
  { id: 'roads-major', type: 'line', source: 'protomaps', 'source-layer': 'roads',
    filter: ['match', ['get', 'kind'], ['highway', 'major_road', 'medium_road'], true, false],
    paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 12, 2.6], 'line-opacity': 0.85 } },
  // Border hierarchy: province lines faintest (dashed), neighbour country borders
  // light neutral grey (recede so the blue routes read), Zambia's own border is a
  // separate bold layer added on top (see 'zm-outline' in map load).
  { id: 'boundaries', type: 'line', source: 'protomaps', 'source-layer': 'boundaries',
    filter: ['any', ['==', ['get', 'kind'], 'region'], ['>', ['coalesce', ['get', 'min_admin_level'], 4], 2]],
    paint: { 'line-color': C.borderProvince, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.4, 9, 0.9], 'line-dasharray': [2, 2.5], 'line-opacity': 0.7 } },
  { id: 'boundaries-country', type: 'line', source: 'protomaps', 'source-layer': 'boundaries',
    filter: ['any', ['==', ['get', 'kind'], 'country'], ['<=', ['coalesce', ['get', 'min_admin_level'], 4], 2]],
    paint: { 'line-color': C.borderNeighbour, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.7, 9, 1.3], 'line-opacity': 0.85 } },
  { id: 'places-locality', type: 'symbol', source: 'protomaps', 'source-layer': 'places',
    filter: ['match', ['get', 'kind'], ['locality', 'city', 'town'], true, false],
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 9, 12.5], 'symbol-sort-key': ['get', 'min_zoom'], 'text-max-width': 7 },
    paint: { 'text-color': '#6b7482', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 } },
  { id: 'places-region', type: 'symbol', source: 'protomaps', 'source-layer': 'places',
    filter: ['==', ['get', 'kind'], 'region'],
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-transform': 'uppercase',
      'text-size': 9.5, 'text-letter-spacing': 0.08, 'text-max-width': 8 },
    paint: { 'text-color': '#a6afbc', 'text-halo-color': '#ffffff', 'text-halo-width': 1 } },
  { id: 'places-country', type: 'symbol', source: 'protomaps', 'source-layer': 'places',
    filter: ['==', ['get', 'kind'], 'country'],
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-transform': 'uppercase',
      'text-size': ['interpolate', ['linear'], ['zoom'], 4, 12, 8, 16], 'text-letter-spacing': 0.16, 'text-max-width': 8 },
    paint: { 'text-color': '#525f70', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 } },
];

// runs referenced by the current (filtered) movements
function runsFor(movs: Movement[]) {
  const ids = new Set<string>();
  for (const m of movs) if (m.vehicleRunId) ids.add(m.vehicleRunId);
  return [...ids].map(id => RUN_BY_ID[id]).filter(Boolean);
}

function routesGeo(movs: Movement[]) {
  return {
    type: 'FeatureCollection' as const,
    features: runsFor(movs).map(r => ({
      type: 'Feature' as const, properties: { runId: r.id },
      geometry: { type: 'LineString' as const, coordinates: r.path },
    })),
  };
}

/** Quadratic curve between two points, bowed perpendicular to the chord, so
 *  overlapping hub-to-facility lanes stay separable. Kept nearly straight: these
 *  are allocation lanes, NOT driven roads (the legend says so). */
function arc(a: [number, number], b: [number, number], bend = 0.045, steps = 18): [number, number][] {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const cx = mx - dy * bend, cy = my + dx * bend;
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    pts.push([u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cy + t * t * b[1]]);
  }
  return pts;
}

/** Distribution network: which store is responsible for supplying which facility. */
function arcsGeo(movs: Movement[]) {
  return {
    type: 'FeatureCollection' as const,
    features: movs.map(m => {
      const w = WH_BY_ID[m.fromId], n = NODE_BY_ID[m.toId];
      return {
        type: 'Feature' as const,
        properties: { mid: m.id, units: m.units, overflow: m.reason === 'capacity-overflow' },
        geometry: { type: 'LineString' as const, coordinates: arc([w.lng, w.lat], [n.lng, n.lat]) },
      };
    }),
  };
}

function nodesGeo(movs: Movement[]) {
  const worst = new Map<string, number>();
  for (const m of movs) worst.set(m.toId, Math.min(worst.get(m.toId) ?? 9999, m.daysToStockout));
  return {
    type: 'FeatureCollection' as const,
    features: NODES.filter(n => worst.has(n.id)).map(n => ({
      type: 'Feature' as const,
      properties: { nid: n.id, dts: worst.get(n.id), name: n.name },
      geometry: { type: 'Point' as const, coordinates: [n.lng, n.lat] },
    })),
  };
}

function graticuleGeo(step = 2) {
  const [w, s, e, nn] = ET_BOUNDS;
  const features: any[] = [];
  for (let lng = Math.ceil(w); lng <= e; lng += step)
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[lng, s], [lng, nn]] } });
  for (let lat = Math.ceil(s); lat <= nn; lat += step)
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[w, lat], [e, lat]] } });
  return { type: 'FeatureCollection' as const, features };
}

const selectedRun = (id: string) => {
  const m = MOVEMENTS.find(x => x.id === id);
  return m?.vehicleRunId ? RUN_BY_ID[m.vehicleRunId] : null;
};

export type MapLayer = 'routes' | 'network';
const ROUTE_LAYERS = ['routes', 'sel-route', 'sel-stops'];
const NET_LAYERS = ['net-arcs', 'net-arc-sel'];

interface Props {
  layer: MapLayer;
  slicer: Slicer;
  selectedId: string;
  onSelect: (movementId: string) => void;
  focusNonce: number;
}

export default function MapView({ layer, slicer, selectedId, onSelect, focusNonce }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const truckRef = useRef<maplibregl.Marker | null>(null);
  const whMarkersRef = useRef<maplibregl.Marker[]>([]);
  const rafRef = useRef<number>(0);
  const truckGenRef = useRef(0);
  const readyRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const slicerRef = useRef(slicer);
  slicerRef.current = slicer;

  useEffect(() => {
    if (!containerRef.current) return;
    ensureProtocol();
    const map = new maplibregl.Map({
      container: containerRef.current,
      center: [40.0, 9.0], zoom: 5.0, attributionControl: false,
      style: {
        version: 8,
        glyphs: '/static/ct/fonts/{fontstack}/{range}.pbf',
        sources: {
          protomaps: { type: 'vector', url: `pmtiles://${window.location.origin}/static/ct/ethiopia.pmtiles` },
          // offline elevation (terrarium terrain-RGB tiles) for hillshade relief
          dem: { type: 'raster-dem', tiles: ['/static/ct/terrain/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 8 },
        },
        layers: BASEMAP_LAYERS,
      } as any,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    map.on('load', () => {
      map.addSource('graticule', { type: 'geojson', data: graticuleGeo() as any });
      map.addLayer({ id: 'graticule', type: 'line', source: 'graticule',
        paint: { 'line-color': '#9aa6b4', 'line-width': 0.5, 'line-opacity': 0.12, 'line-dasharray': [2, 3] } });

      // Zambia's own border — bold, so the working country reads distinctly from neighbours
      map.addSource('zm-outline', { type: 'geojson', data: '/static/ct/et-regions.geojson' });
      // Real terrain: elevation-graded hypsometric colour ("heatmap" style) from the
      // offline Ethiopia DEM — below-sea/water blue, lowland green, mid tan/yellow,
      // highland brown, peaks pale. The color-relief layer needs maplibre-gl v5.
      map.addLayer({
        id: 'et-relief', type: 'color-relief', source: 'dem',
        paint: {
          'color-relief-color': [
            'interpolate', ['linear'], ['elevation'],
            -160, '#8fc2e3', -1, '#a9d3c4',
            1, '#93c184', 500, '#b7d692', 1000, '#d4dd95',
            1500, '#e6da98', 2100, '#dcc187', 2800, '#caa678',
            3600, '#d8cbba', 4600, '#f6f1ea',
          ],
        },
      } as any);
      // Real elevation relief ON TOP of the green land (offline Ethiopia DEM tiles) —
      // gives mountains/rift valley true terrain shading.
      map.addLayer({ id: 'et-hillshade', type: 'hillshade', source: 'dem',
        paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': '#5f7a52',
          'hillshade-highlight-color': '#f6faec', 'hillshade-accent-color': '#7d9268' } as any });
      map.addLayer({ id: 'zm-outline', type: 'line', source: 'zm-outline',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': C.borderCountry, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.9, 9, 1.8], 'line-opacity': 0.75 } });

      // background routes (all runs in filter) — visible, not hidden (selected still stands out)
      map.addSource('routes', { type: 'geojson', data: routesGeo([]) as any });
      map.addLayer({ id: 'routes', type: 'line', source: 'routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': C.route, 'line-opacity': 0.8,
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.4, 9, 2.6] } });

      // selected route — prominent (muted)
      map.addSource('sel-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as any });
      map.addLayer({ id: 'sel-route', type: 'line', source: 'sel-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': C.routeSel, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2.4, 9, 4.4], 'line-opacity': 0.95 } });

      // ── Distribution network: store-to-facility responsibility lanes. Width
      // carries units shipped; overflow lanes are dashed (served by a store that
      // is not the nearest one). Hidden unless the network layer is active.
      map.addSource('net-arcs', { type: 'geojson', data: arcsGeo([]) as any });
      map.addLayer({ id: 'net-arcs', type: 'line', source: 'net-arcs',
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-color': C.route, 'line-opacity': 0.62,
          'line-width': ['interpolate', ['linear'], ['get', 'units'], 40, 1, 900, 3.4] } });
      map.addSource('net-arc-sel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as any });
      map.addLayer({ id: 'net-arc-sel', type: 'line', source: 'net-arc-sel',
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-color': C.routeSel, 'line-width': 3, 'line-opacity': 0.95 } });

      // delivery nodes (muted urgency)
      map.addSource('nodes', { type: 'geojson', data: nodesGeo([]) as any });
      map.addLayer({ id: 'nodes', type: 'circle', source: 'nodes',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2.4, 9, 5],
          'circle-color': ['step', ['get', 'dts'], C.urgent, 22, C.soon, 45, C.node],
          'circle-stroke-color': '#fff', 'circle-stroke-width': 0.6, 'circle-opacity': 0.9,
        } });

      // stops on the selected run
      map.addSource('sel-stops', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as any });
      map.addLayer({ id: 'sel-stops', type: 'circle', source: 'sel-stops',
        paint: { 'circle-radius': 4.5, 'circle-color': C.routeSel, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });

      readyRef.current = true;
      map.fitBounds(ET_BOUNDS, { padding: 26, duration: 0 });
      renderAll();

      map.on('click', 'nodes', (e) => {
        const nid = e.features?.[0]?.properties?.nid;
        const mv = filterMovements(slicerRef.current).find(m => m.toId === nid) || MOVEMENTS.find(m => m.toId === nid);
        if (mv) onSelectRef.current(mv.id);
      });
      map.on('click', 'routes', (e) => {
        const runId = e.features?.[0]?.properties?.runId;
        const mv = MOVEMENTS.find(m => m.vehicleRunId === runId);
        if (mv) onSelectRef.current(mv.id);
      });
      map.on('click', 'net-arcs', (e) => {
        const mid = e.features?.[0]?.properties?.mid;
        if (mid) onSelectRef.current(mid);
      });
      for (const lyr of ['nodes', 'routes', 'sel-stops', 'net-arcs']) {
        map.on('mouseenter', lyr, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', lyr, () => { map.getCanvas().style.cursor = ''; });
      }
    });

    return () => { ro.disconnect(); cancelAnimationFrame(rafRef.current); map.remove(); mapRef.current = null; readyRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderAll = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const movs = filterMovements(slicer);
    (map.getSource('routes') as maplibregl.GeoJSONSource)?.setData(routesGeo(movs) as any);
    (map.getSource('nodes') as maplibregl.GeoJSONSource)?.setData(nodesGeo(movs) as any);
    (map.getSource('net-arcs') as maplibregl.GeoJSONSource)?.setData(arcsGeo(movs) as any);

    // swap which lane geometry is on show (road routes vs allocation network)
    const isNet = layer === 'network';
    for (const id of ROUTE_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', isNet ? 'none' : 'visible');
    for (const id of NET_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', isNet ? 'visible' : 'none');

    whMarkersRef.current.forEach(m => m.remove());
    whMarkersRef.current = [];
    const activeHubs = new Set(movs.map(m => m.fromId));
    for (const w of WAREHOUSES) {
      const active = activeHubs.has(w.id);
      const el = document.createElement('div');
      el.className = 'ct-wh-marker' + (active ? '' : ' dim') + (w.hub ? ' hub' : '');
      el.innerHTML = `<span class="ring"></span><span class="pill">${w.short}</span>`;
      el.onclick = () => { const mv = movs.find(m => m.fromId === w.id) || filterMovements({ ...slicerRef.current, hub: w.id })[0]; if (mv) onSelectRef.current(mv.id); };
      const mk = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([w.lng, w.lat]).addTo(map);
      whMarkersRef.current.push(mk);
    }
    renderSelected();
  };

  const renderSelected = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    // highlight the selected allocation lane (network layer)
    const selMov = MOVEMENTS.find(x => x.id === selectedId);
    (map.getSource('net-arc-sel') as maplibregl.GeoJSONSource)?.setData(
      (selMov ? arcsGeo([selMov]) : { type: 'FeatureCollection', features: [] }) as any);

    // the truck belongs to a driven road route; it has no meaning on allocation lanes
    if (layer === 'network') {
      cancelAnimationFrame(rafRef.current);
      truckGenRef.current++;
      truckRef.current?.remove();
      truckRef.current = null;
      return;
    }

    const run = selectedRun(selectedId);
    if (!run) {
      (map.getSource('sel-route') as maplibregl.GeoJSONSource)?.setData({ type: 'FeatureCollection', features: [] } as any);
      (map.getSource('sel-stops') as maplibregl.GeoJSONSource)?.setData({ type: 'FeatureCollection', features: [] } as any);
      return;
    }
    const pts = run.path;
    (map.getSource('sel-route') as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } }],
    } as any);
    (map.getSource('sel-stops') as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: run.stops.map(s => { const n = NODE_BY_ID[s.nodeId]; return { type: 'Feature', properties: { seq: s.seq }, geometry: { type: 'Point', coordinates: [n.lng, n.lat] } }; }),
    } as any);

    if (!truckRef.current) {
      const el = document.createElement('div');
      el.className = 'ct-truck';
      el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1"/><path d="M14 9h4l3 3v5a1 1 0 0 1-1 1h-1"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>`;
      truckRef.current = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(pts[0] as any).addTo(map);
    }
    // Smooth truck along the road polyline — ONE time-based rAF loop, constant speed.
    // A generation token supersedes any prior loop so overlapping calls can't stack
    // (stacked loops were the "flicker"); no setTimeout nesting.
    cancelAnimationFrame(rafRef.current);
    const gen = ++truckGenRef.current;
    const seg: number[] = []; let total = 0;
    for (let k = 1; k < pts.length; k++) { const d = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); seg.push(d); total += d; }
    const SPEED = total > 0 ? total / 9000 : 0; // deg per ms → ~9s per full loop
    const posAt = (dd: number): [number, number] => {
      let acc = 0;
      for (let k = 0; k < seg.length; k++) {
        if (acc + seg[k] >= dd) { const t = seg[k] ? (dd - acc) / seg[k] : 0; return [pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t]; }
        acc += seg[k];
      }
      return pts[pts.length - 1] as [number, number];
    };
    let travelled = 0, last = 0;
    const step = (ts: number) => {
      if (gen !== truckGenRef.current) return;           // a newer selection took over
      if (!last) last = ts;
      travelled += (ts - last) * SPEED; last = ts;
      if (total > 0 && travelled >= total) travelled -= total;
      truckRef.current?.setLngLat(posAt(travelled));
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };

  useEffect(() => { renderAll(); /* eslint-disable-next-line */ }, [slicer, layer]);
  useEffect(() => { renderSelected(); /* eslint-disable-next-line */ }, [selectedId, layer]);

  useEffect(() => {
    if (!focusNonce) return;
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    // focus the geometry actually on screen: the road route, or the allocation lane
    const selMov = MOVEMENTS.find(x => x.id === selectedId);
    const path = layer === 'network'
      ? (selMov ? arc([WH_BY_ID[selMov.fromId].lng, WH_BY_ID[selMov.fromId].lat],
                      [NODE_BY_ID[selMov.toId].lng, NODE_BY_ID[selMov.toId].lat]) : null)
      : selectedRun(selectedId)?.path ?? null;
    if (!path || !path.length) return;
    const b = new maplibregl.LngLatBounds(path[0] as any, path[0] as any);
    for (const p of path) b.extend(p as any);
    map.fitBounds(b, { padding: 90, duration: 700, maxZoom: 9 });
    // eslint-disable-next-line
  }, [focusNonce]);

  return <div className="ct-map" ref={containerRef} />;
}
