/**
 * PCT · Zambia supply map (PCT — Supply Chain Control Tower, Zambia eLMIS).
 * Source: fetcher pct-map — one row per facility from bi_supply.mart_pct_facility_geo
 * (GPS, masked by trust level at the gateway) with its next-month position summary
 * (mart_pct_position) and its province's S8 availability (mart_pct_kpi).
 *
 * The page's data is Zambian whatever profile the deployment shows, so the
 * geometry and the code → polygon join come from the installed zm-v1 profile by
 * name (never the active profile, never a name match).
 */
import * as echarts from 'echarts';
import type { WidgetDef, WidgetCtx, Theme } from '../../runtime/types';
import { loadProfileContextGeo } from '../_shared/geo';
import { loadProfileRegions } from '../_shared/reference';

const PROFILE = 'zm-v1';
type Metric = 's8' | 'short' | 'fc';
const METRICS: { id: Metric; label: string }[] = [
  { id: 's8', label: 'Availability (S8)' },
  { id: 'short', label: 'Facilities with a shortage risk' },
  { id: 'fc', label: 'Forecast vs AMC' },
];
const STATUS = ['likely_short', 'critical_at_risk', 'covered', 'no_demand_expected', 'not_assessed', 'no_report'] as const;
type Status = typeof STATUS[number];
const STATUS_LABEL: Record<Status, string> = {
  likely_short: 'A tracer product likely short next month',
  critical_at_risk: 'A critical tracer at risk next month',
  covered: 'Covered next month',
  no_demand_expected: 'No stock, no demand expected',
  not_assessed: 'Not assessed (no forecast)',
  no_report: 'No report in the latest month',
};

const num = (v: any): number => (v == null || v === '' ? NaN : Number(v));
const pctFmt = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : '—');
const unitsFmt = (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString() : '—');
const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function statusColor(s: Status, theme: Theme): string {
  switch (s) {
    case 'likely_short': return theme.status.alert;
    case 'critical_at_risk': return theme.status.watch;
    case 'covered': return theme.status.good;
    case 'no_demand_expected': return theme.ink[2];
    default: return theme.ink[3];
  }
}

interface Province { code: string; name: string; geo: string; s8: number; short: number; fc: number;
                     facilities: number; assessed: number; nShort: number; nCritical: number; planned: number; }

function provinces(rows: any[], regions: { code: string; name: string; geo_name: string }[]): Record<string, Province> {
  const out: Record<string, Province> = {};
  const acc: Record<string, { fr: number; fa: number; s8n: number; s8d: number }> = {};
  for (const reg of regions) {
    out[reg.code] = { code: reg.code, name: reg.name, geo: reg.geo_name, s8: NaN, short: NaN, fc: NaN,
                      facilities: 0, assessed: 0, nShort: 0, nCritical: 0, planned: 0 };
    acc[reg.code] = { fr: 0, fa: 0, s8n: NaN, s8d: NaN };
  }
  for (const r of rows) {
    const p = out[String(r.region_id)]; const a = acc[String(r.region_id)];
    if (!p) continue;
    p.facilities += 1;
    const st = r.h1_status as Status;
    if (st !== 'no_report' && st !== 'not_assessed') p.assessed += 1;
    if (st === 'likely_short') p.nShort += 1;
    if (st === 'critical_at_risk') p.nCritical += 1;
    if (Number.isFinite(num(r.planned_units))) p.planned += num(r.planned_units);
    if (Number.isFinite(num(r.forecast_rate))) a.fr += num(r.forecast_rate);
    if (Number.isFinite(num(r.forecast_amc))) a.fa += num(r.forecast_amc);
    if (Number.isFinite(num(r.s8_den))) { a.s8n = num(r.s8_num); a.s8d = num(r.s8_den); }
  }
  for (const code in out) {
    const p = out[code]; const a = acc[code];
    p.s8 = a.s8d > 0 ? (100 * a.s8n) / a.s8d : NaN;
    p.short = p.assessed > 0 ? (100 * (p.nShort + p.nCritical)) / p.assessed : NaN;
    p.fc = a.fa > 0 ? (100 * (a.fr - a.fa)) / a.fa : NaN;
  }
  return out;
}

function visualMap(metric: Metric, theme: Theme): any {
  const base = { seriesIndex: 0, left: 8, bottom: 8, itemWidth: 12, itemHeight: 12,
                 textStyle: { color: theme.ink[2], fontSize: 10 }, outOfRange: { color: theme.line } };
  if (metric === 's8') return { ...base, type: 'piecewise', pieces: [
    { lt: 80, label: 'below 80%', color: theme.status.alert },
    { gte: 80, lt: 90, label: '80–90%', color: theme.status.watch },
    { gte: 90, label: '≥ 90% (target)', color: theme.status.good }] };
  if (metric === 'short') return { ...base, type: 'continuous', min: 0, max: 100, calculable: false,
    text: ['100% short', '0%'], inRange: { color: [theme.amber(0.05), theme.amber(0.55), theme.amber(1)] } };
  return { ...base, type: 'piecewise', pieces: [
    { lt: -20, label: 'forecast 20%+ below AMC', color: theme.navy['700'] || '#1d3557' },
    { gte: -20, lt: -5, label: '5–20% below', color: theme.navy['400'] || '#6b7fa3' },
    { gte: -5, lt: 5, label: 'within ±5%', color: theme.line },
    { gte: 5, lt: 20, label: '5–20% above', color: theme.status.watch },
    { gte: 20, label: '20%+ above', color: theme.status.alert }] };
}

const def: WidgetDef = {
  id: 'pct-map',
  reactsTo: ['geography'],
  reflow: 'ratio',
  render(ctx: WidgetCtx) {
    let metric: Metric = 's8';
    let chart: echarts.ECharts | null = null;
    let ro: ResizeObserver | null = null;
    ctx.el.innerHTML = `
      <p class="widget-lead" style="margin:0 0 .6rem;font-size:.8rem;line-height:1.35;color:var(--ink-3)">
        Provinces are shaded by the selected measure. Each dot is a health facility, coloured by its most urgent
        next-month stockout risk across its tracer products and sized by its planned order. Hollow dots are placed at their district's centre because the
        facility has no usable GPS.</p>
      <div class="local-controls"><span class="lc-label">Shade provinces by</span><div class="seg">
        ${METRICS.map((m, i) => `<button data-metric="${m.id}"${i === 0 ? ' class="active"' : ''}>${m.label}</button>`).join('')}
      </div></div>
      <div style="display:flex;gap:1rem;align-items:stretch;flex-wrap:wrap">
        <div class="pct-map-mount" style="flex:1 1 560px;min-width:320px;height:520px;position:relative"></div>
        <div class="pct-map-rank" style="flex:0 1 300px;min-width:260px;font-size:.8rem"></div>
      </div>
      <div class="pct-map-legend" style="display:flex;flex-wrap:wrap;gap:.35rem 1rem;margin-top:.5rem;font-size:.75rem;color:var(--ink-2)"></div>
      <p class="pct-map-note" style="margin:.35rem 0 0;font-size:.72rem;color:var(--ink-3)"></p>
      <div class="region-info"><span class="ri-name"></span><span class="ri-stats">Click a province or a facility to inspect it.</span></div>`;
    const mount = ctx.el.querySelector('.pct-map-mount') as HTMLElement;
    const legend = ctx.el.querySelector('.pct-map-legend') as HTMLElement;
    const note = ctx.el.querySelector('.pct-map-note') as HTMLElement;
    const rank = ctx.el.querySelector('.pct-map-rank') as HTMLElement;
    const infoName = ctx.el.querySelector('.ri-name') as HTMLElement;
    const infoStats = ctx.el.querySelector('.ri-stats') as HTMLElement;
    let state: { rows: any[]; prov: Record<string, Province>; mapName: string; geo: any; byGeo: Record<string, Province> } | null = null;

    const provinceInfo = (p: Province) => {
      infoName.textContent = p.name;
      infoStats.innerHTML = `Availability (S8) <b>${pctFmt(p.s8)}</b><span class="sep"></span>`
        + `Facilities with a tracer product short or at risk <b>${p.nShort + p.nCritical}</b> of ${p.assessed} assessed<span class="sep"></span>`
        + `Planned order <b>${unitsFmt(p.planned)}</b> units<span class="sep"></span>`
        + `Forecast vs AMC <b>${Number.isFinite(p.fc) ? `${p.fc >= 0 ? '+' : ''}${p.fc.toFixed(1)}%` : '—'}</b>`;
    };
    const facilityInfo = (r: any) => {
      infoName.textContent = `${r.facility_name} (${r.district_name})`;
      infoStats.innerHTML = `${esc(STATUS_LABEL[r.h1_status as Status] || r.h1_status)}<span class="sep"></span>`
        + `Products likely short <b>${num(r.n_likely_short) || 0}</b>, critical at risk <b>${num(r.n_critical_at_risk) || 0}</b> of ${num(r.n_products) || 0}<span class="sep"></span>`
        + `Planned order <b>${unitsFmt(num(r.planned_units))}</b> units`
        + (r.coord_basis === 'district_facility_mean' ? '<span class="sep"></span>Location inferred from the district' : '');
    };

    const draw = () => {
      if (!state) return;
      const { rows, prov, mapName, geo } = state;
      const theme = ctx.theme;
      if (!chart) {
        chart = echarts.init(mount);
        ro = new ResizeObserver(() => chart && chart.resize());
        ro.observe(mount);
        chart.on('click', (e: any) => {
          if (e.seriesType === 'map' && state!.byGeo[e.name]) provinceInfo(state!.byGeo[e.name]);
          if (e.seriesType === 'scatter' && e.data && e.data.row) facilityInfo(e.data.row);
        });
      }
      // frame on Zambia's provinces, not the world backdrop
      let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
      const walk = (c: any) => { if (typeof c[0] === 'number') { x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]); } else c.forEach(walk); };
      geo.features.filter((f: any) => !f.properties.__ctx).forEach((f: any) => walk(f.geometry.coordinates));
      const mx = (x1 - x0) * 0.06, my = (y1 - y0) * 0.06;
      const maxU = Math.max(1, ...rows.map(r => num(r.planned_units)).filter(Number.isFinite));
      const points = rows.filter(r => Number.isFinite(num(r.lat)) && Number.isFinite(num(r.lng))).map(r => {
        const st = (r.h1_status || 'no_report') as Status;
        const col = statusColor(st, theme);
        const u = num(r.planned_units);
        const inferred = r.coord_basis === 'district_facility_mean';
        return {
          value: [num(r.lng), num(r.lat)], row: r,
          symbolSize: 3 + 11 * Math.sqrt(Number.isFinite(u) ? u / maxU : 0),
          itemStyle: inferred ? { color: 'rgba(0,0,0,0)', borderColor: col, borderWidth: 1.2 }
                              : { color: col, borderColor: '#fff', borderWidth: 0.4, opacity: st === 'no_report' || st === 'not_assessed' ? 0.45 : 0.9 },
        };
      });
      const val = (p: Province) => (metric === 's8' ? p.s8 : metric === 'short' ? p.short : p.fc);
      chart.setOption({
        textStyle: { fontFamily: theme.fontSans },
        tooltip: {
          trigger: 'item', confine: true,
          formatter: (e: any) => {
            if (e.seriesType === 'scatter') {
              const r = e.data.row;
              return `<b>${esc(r.facility_name)}</b><br/>${esc(r.district_name)}, ${esc(r.region_name)}<br/>`
                + `${esc(STATUS_LABEL[r.h1_status as Status] || r.h1_status)}<br/>Planned order ${unitsFmt(num(r.planned_units))} units`
                + (r.coord_basis === 'district_facility_mean' ? '<br/><i>Location inferred from the district</i>' : '');
            }
            const p = state!.byGeo[e.name];
            if (!p) return '';
            return `<b>${esc(p.name)}</b><br/>Availability (S8) ${pctFmt(p.s8)}<br/>Facilities with a shortage risk ${p.nShort + p.nCritical} / ${p.assessed}<br/>`
              + `Forecast vs AMC ${Number.isFinite(p.fc) ? `${p.fc >= 0 ? '+' : ''}${p.fc.toFixed(1)}%` : '—'}`;
          },
        },
        visualMap: visualMap(metric, theme),
        geo: {
          map: mapName, roam: true, boundingCoords: [[x0 - mx, y1 + my], [x1 + mx, y0 - my]],
          itemStyle: { areaColor: theme.paper, borderColor: theme.line, borderWidth: 0.6 },
          emphasis: { disabled: true }, silent: false,
          regions: geo.features.filter((f: any) => f.properties.__ctx).map((f: any) => ({
            name: f.properties.name, silent: true, itemStyle: { areaColor: theme.line, opacity: 0.35, borderWidth: 0 } })),
        },
        series: [
          { type: 'map', geoIndex: 0, name: 'province',
            data: Object.values(prov).map(p => ({ name: p.geo, value: Number.isFinite(val(p)) ? +val(p).toFixed(1) : null })) },
          { type: 'scatter', coordinateSystem: 'geo', geoIndex: 0, name: 'facility', z: 5, data: points,
            emphasis: { scale: 1.6 } },
        ],
      }, true);
      const fmtVal = (p: Province) => metric === 'fc'
        ? (Number.isFinite(p.fc) ? `${p.fc >= 0 ? '+' : ''}${p.fc.toFixed(1)}%` : '—') : pctFmt(val(p));
      const ranked = Object.values(prov).sort((a, b) => {
        const va = val(a), vb = val(b);
        if (!Number.isFinite(va)) return 1; if (!Number.isFinite(vb)) return -1;
        if (metric === 'fc') return Math.abs(vb) - Math.abs(va);   // largest gap first
        return metric === 's8' ? va - vb : vb - va;                 // worst first
      });
      const span = Math.max(1, ...ranked.map(p => Math.abs(val(p))).filter(Number.isFinite));
      rank.innerHTML = `<div style="font-weight:600;color:var(--ink-2);margin:.1rem 0 .4rem">${esc(METRICS.find(m => m.id === metric)!.label)} · ${metric === 'fc' ? 'largest gap first' : 'worst first'}</div>`
        + ranked.map(p => `<button data-prov="${esc(p.code)}" style="display:grid;grid-template-columns:1fr auto;gap:.1rem .5rem;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--line, #e3e6ea);padding:.35rem .1rem;cursor:pointer;color:inherit">
             <span>${esc(p.name)}</span><b>${fmtVal(p)}</b>
             <span style="grid-column:1 / span 2;height:4px;background:var(--line, #e3e6ea);border-radius:2px;overflow:hidden">
               <span style="display:block;height:100%;width:${Number.isFinite(val(p)) ? Math.min(100, (100 * Math.abs(val(p))) / (metric === 's8' ? 100 : span)) : 0}%;background:${theme.navy['700'] || '#1d3557'}"></span></span>
             <span style="grid-column:1 / span 2;color:var(--ink-3);font-size:.72rem">${p.nShort + p.nCritical} of ${p.assessed} assessed facilities with a tracer product short or at risk</span>
           </button>`).join('');
      rank.querySelectorAll<HTMLElement>('[data-prov]').forEach(b => {
        b.onclick = () => {
          const p = prov[b.dataset.prov!];
          provinceInfo(p);
          chart?.dispatchAction({ type: 'showTip', seriesIndex: 0, name: p.geo });
        };
      });
      const counts: Record<string, number> = {};
      rows.forEach(r => { counts[r.h1_status] = (counts[r.h1_status] || 0) + 1; });
      legend.innerHTML = STATUS.map(s => `<span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${statusColor(s, theme)};margin-right:4px;vertical-align:middle${s === 'no_report' || s === 'not_assessed' ? ';opacity:.45' : ''}"></span>${STATUS_LABEL[s]} <b>${(counts[s] || 0).toLocaleString()}</b></span>`).join('')
        + `<span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;border:1.2px solid var(--ink-2);margin-right:4px;vertical-align:middle"></span>Location inferred <b>${rows.filter(r => r.coord_basis === 'district_facility_mean').length.toLocaleString()}</b></span>`;
      const located = rows.filter(r => Number.isFinite(num(r.lat)));
      const generalized = located.length > 0 && located.every(r => Math.abs(num(r.lat) * 10 - Math.round(num(r.lat) * 10)) < 1e-6);
      note.textContent = (generalized ? 'Facility locations are generalized to about 10 km for your access level. ' : '')
        + 'Dot size = planned order for next month (forecast P50, eLMIS AMC where the forecast does not apply). '
        + `Latest month in the data: ${monthOf(rows)}.`;
    };

    const monthOf = (rows: any[]) => {
      const m = String(rows.find(r => r.as_of_month)?.as_of_month || '');
      const [y, mo] = m.split('-').map(Number);
      return y && mo ? new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'unknown';
    };

    ctx.el.querySelectorAll<HTMLElement>('[data-metric]').forEach(b => {
      b.onclick = () => {
        metric = b.dataset.metric as Metric;
        ctx.el.querySelectorAll<HTMLElement>('[data-metric]').forEach(x => x.classList.toggle('active', x.dataset.metric === metric));
        draw();
      };
    });

    (async () => {
      try {
        const [data, regions, g] = await Promise.all([ctx.fetchData(), loadProfileRegions(PROFILE), loadProfileContextGeo(PROFILE)]);
        const rows = (data || []) as any[];
        if (!rows.length) { mount.innerHTML = '<div class="widget-empty">No facility data for the selected scope.</div>'; return; }
        const prov = provinces(rows, regions);
        const byGeo: Record<string, Province> = {};
        Object.values(prov).forEach(p => { byGeo[p.geo] = p; });
        state = { rows, prov, mapName: g.mapName, geo: g.geo, byGeo };
        draw();
      } catch {
        mount.innerHTML = '<div class="widget-empty">Could not load the Zambia supply map. Please try again.</div>';
      }
    })();
    return () => { ro?.disconnect(); chart?.dispose(); };
  },
};
export default def;
