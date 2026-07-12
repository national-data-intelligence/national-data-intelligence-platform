/**
 * Burden & Readiness Map (Disease §2).
 * answers.md Q3-dz-region-map · insight-notes: KEEP AND EXTEND — a burden-only map is something
 * DHIS2/IDSR already draw; the warehouse edge is overlaying RESPONSE CAPACITY. Toggle Burden /
 * Readiness / Reliability so "hot and unready" areas pop. Guardrail: keep burden & readiness
 * visually separable — do NOT blend into one index that hides which factor drives the colour.
 * Rendered at admin-1 REGION level (no woreda GeoJSON — DECISIONS §M1).
 * Source: bi_idsr.mart_idsr_disease_weekly + Supply (readiness) + DQ (reliability) + MFR.
 *
 * DATA CONTRACT (mock: dz-region-map.json) — one row per region:
 *   region:str · burden_incidence_100k:num · readiness_pct:int · reliability_pct:int ·
 *   p_alarm:int(%) · cases_7d:int · cfr_pct:num
 * reactsTo: geography · programme.
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import { choropleth } from '../_shared/charts';
import { loadEthGeo } from '../_shared/geo';
import { regionName } from '../_shared/reference';

type Metric = 'burden' | 'readiness' | 'reliability';
const META: Record<Metric, { col: string; label: string; fmt: (v: number) => string }> = {
  burden: { col: 'burden_incidence_100k', label: 'Burden', fmt: v => `${Math.round(v)}` },
  readiness: { col: 'readiness_pct', label: 'Readiness', fmt: v => `${Math.round(v)}%` },
  reliability: { col: 'reliability_pct', label: 'Reliability', fmt: v => `${Math.round(v)}%` },
};

const def: WidgetDef = {
  id: 'dz-region-map',
  reactsTo: ['geography', 'programme'],
  // Map-like: when a scope reflow grows this card, preserve its aspect —
  // the renderer scales the card height with the width growth (owner rule 2).
  reflow: 'ratio',
  render(ctx: WidgetCtx) {
    if (ctx.filters.geography !== 'all') {
      ctx.empty('Region map hidden. A single region is selected in the global filter.'); return;
    }
    let metric: Metric = 'burden';
    let chartCleanup: (() => void) | undefined;
    let rowsByRegion: Record<string, any> = {};

    ctx.el.innerHTML = `
      <div class="local-controls">
        <span class="lc-label">View by</span>
        <div class="seg">
          <button data-metric="burden" class="active">Burden</button>
          <button data-metric="readiness">Readiness</button>
          <button data-metric="reliability">Reliability</button>
        </div>
      </div>
      <div class="dz-map-mount" style="min-height:340px"></div>
      <div class="region-info"><span class="ri-name"></span><span class="ri-stats">Click any region to inspect.</span></div>`;
    const mapMount = ctx.el.querySelector('.dz-map-mount') as HTMLElement;
    const infoName = ctx.el.querySelector('.ri-name') as HTMLElement;
    const infoStats = ctx.el.querySelector('.ri-stats') as HTMLElement;

    const updateInfo = (region: string) => {
      infoName.textContent = region;
      const r = rowsByRegion[region];
      if (!r) { infoStats.textContent = 'No mart rows for this region in your scope.'; return; }
      infoStats.innerHTML = [
        `P(alarm) <b>${Math.round(Number(r.p_alarm ?? 0))}%</b>`,
        `Cases 7d <b>${Number(r.cases_7d ?? 0).toLocaleString()}</b>`,
        `CFR <b>${Number(r.cfr_pct ?? 0).toFixed(1)}%</b>`,
      ].join('<span class="ri-divider">·</span>');
    };

    const draw = async () => {
      if (chartCleanup) { chartCleanup(); chartCleanup = undefined; }
      mapMount.innerHTML = '<p class="muted" style="padding:1rem">Loading…</p>';
      try {
        const rows = await ctx.fetchData();
        mapMount.innerHTML = '';
        if (!rows || !rows.length) { mapMount.innerHTML = '<div class="widget-empty">No geographic surveillance data for the selected filters.</div>'; return; }
        rowsByRegion = {}; const valuesByRegion: Record<string, number> = {};
        const m = META[metric];
        // Mart rows key regions by 2-letter region_id (AA/AF/…) — translate to the
        // SPA display name so the geojson feature join (normRegion) actually matches.
        // Without this every region reads "no data" and the map renders flat.
        for (const r of rows) { const name = regionName(String(r.region)); rowsByRegion[name] = r; valuesByRegion[name] = Number(r[m.col] ?? 0); }
        const geo = await loadEthGeo();
        // diseaseBurden is ordered high→low (+no-data); choropleth maps 0→first, so drop the
        // no-data grey and reverse → low burden = pale, high burden = deep red.
        const ramp = metric === 'burden' ? [...ctx.theme.ramps.diseaseBurden].slice(0, 5).reverse() : undefined;
        const tooltip = (name: string) => {
          const r = rowsByRegion[name];
          if (!r) return `<b>${name}</b><br/>No data`;
          return `<b>${name}</b><br/>Burden ${Math.round(Number(r.burden_incidence_100k ?? 0))}/100k · Readiness ${Number(r.readiness_pct ?? 0)}%<br/>P(alarm) ${Number(r.p_alarm ?? 0)}% · Cases 7d ${Number(r.cases_7d ?? 0).toLocaleString()}`;
        };
        chartCleanup = choropleth(mapMount, { valuesByRegion, fmt: m.fmt, onSelect: updateInfo, ramp, tooltip }, ctx.theme, geo);
      } catch {
        // Never leave the "Loading…" placeholder stuck if the map/geo render throws.
        mapMount.innerHTML = '<div class="widget-empty">Could not load the burden &amp; readiness map. Please try again.</div>';
      }
    };

    ctx.el.querySelectorAll<HTMLElement>('[data-metric]').forEach(b => {
      b.onclick = () => {
        metric = b.dataset.metric as Metric;
        ctx.el.querySelectorAll<HTMLElement>('[data-metric]').forEach(x => x.classList.toggle('active', x.dataset.metric === metric));
        draw();
      };
    });
    draw();
    return () => { if (chartCleanup) chartCleanup(); };
  },
};
export default def;
