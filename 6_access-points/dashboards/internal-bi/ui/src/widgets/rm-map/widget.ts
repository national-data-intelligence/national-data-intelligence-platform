/**
 * Supply Stress Map (Resource §2).
 * answers.md Q3-rm-map · insight-notes: KEEP — a composite stress map already beats a single
 * logistics feed; keep it transparent (components on toggle, not a black box). Supply stress index
 * = 0.45*drug_stress + 0.30*facility_gap + 0.25*readiness_gap. Guardrail: define components on-card.
 * Rendered at admin-1 region level (M1). Source: bi_supply + bi_facility (MFR).
 *
 * DATA CONTRACT (mock: rm-map.json) — one row per region:
 *   region:str · composite_score:num(0–3) · drug_stress:num · facility_gap:num · readiness_gap:num
 * reactsTo: geography.
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import { choropleth } from '../_shared/charts';
import { loadEthGeo } from '../_shared/geo';
import { regionName } from '../_shared/reference';

type Metric = 'composite_score' | 'drug_stress' | 'facility_gap' | 'readiness_gap';
const OPTS: { id: Metric; label: string }[] = [
  { id: 'composite_score', label: 'Composite' },
  { id: 'drug_stress', label: 'Drug stress' },
  { id: 'facility_gap', label: 'Facility gap' },
  { id: 'readiness_gap', label: 'Readiness gap' },
];

const def: WidgetDef = {
  id: 'rm-map',
  reactsTo: ['geography'],
  // Map-like: when a scope reflow grows this card, preserve its aspect —
  // the renderer scales the card height with the width growth (owner rule 2).
  reflow: 'ratio',
  render(ctx: WidgetCtx) {
    if (ctx.filters.geography !== 'all') { ctx.empty('Map hidden. A single region is selected in the global filter.'); return; }
    let metric: Metric = 'composite_score';
    let chartCleanup: (() => void) | undefined;
    let rowsByRegion: Record<string, any> = {};

    ctx.el.innerHTML = `
      <div class="local-controls"><span class="lc-label">View</span><div class="seg">
        ${OPTS.map((o, i) => `<button data-metric="${o.id}"${i === 0 ? ' class="active"' : ''}>${o.label}</button>`).join('')}
      </div></div>
      <div class="rm-map-mount" style="min-height:340px"></div>
      <div class="region-info"><span class="ri-name"></span><span class="ri-stats">Click a region to inspect.</span></div>`;
    const mount = ctx.el.querySelector('.rm-map-mount') as HTMLElement;
    const infoName = ctx.el.querySelector('.ri-name') as HTMLElement;
    const infoStats = ctx.el.querySelector('.ri-stats') as HTMLElement;
    const updateInfo = (region: string) => {
      infoName.textContent = region;
      const r = rowsByRegion[region];
      infoStats.innerHTML = r
        ? `Composite <b>${Number(r.composite_score ?? 0).toFixed(1)}</b><span class="ri-divider">·</span>Drug <b>${Number(r.drug_stress ?? 0).toFixed(1)}</b><span class="ri-divider">·</span>Facility <b>${Number(r.facility_gap ?? 0).toFixed(1)}</b><span class="ri-divider">·</span>Readiness <b>${Number(r.readiness_gap ?? 0).toFixed(1)}</b>`
        : 'No supply data for this region.';
    };

    const draw = async () => {
      if (chartCleanup) { chartCleanup(); chartCleanup = undefined; }
      mount.innerHTML = '<p class="muted" style="padding:1rem">Loading…</p>';
      const rows = await ctx.fetchData();
      mount.innerHTML = '';
      if (!rows || !rows.length) { mount.innerHTML = '<div class="widget-empty">No supply stress geography for the selected filters.</div>'; return; }
      rowsByRegion = {}; const valuesByRegion: Record<string, number> = {};
      // Mart rows key regions by 2-letter region_id (AA/AF/…) — translate to the
      // SPA display name so the geojson feature join (normRegion) actually matches.
      // Without this every region reads "no data" and the map renders flat.
      for (const r of rows) { const name = regionName(String(r.region)); rowsByRegion[name] = r; valuesByRegion[name] = Number(r[metric] ?? 0); }
      const geo = await loadEthGeo();
      // supplyStress is ordered high→low; choropleth maps 0→first, so reverse → high stress = dark slate.
      const ramp = [...ctx.theme.ramps.supplyStress].reverse();
      const tooltip = (name: string) => {
        const r = rowsByRegion[name];
        if (!r) return `<b>${name}</b><br/>No data`;
        return `<b>${name}</b><br/>Composite ${Number(r.composite_score ?? 0).toFixed(1)}<br/>Drug ${Number(r.drug_stress ?? 0).toFixed(1)} · Facility ${Number(r.facility_gap ?? 0).toFixed(1)} · Readiness ${Number(r.readiness_gap ?? 0).toFixed(1)}`;
      };
      chartCleanup = choropleth(mount, { valuesByRegion, fmt: (v: number) => v.toFixed(1), onSelect: updateInfo, ramp, tooltip }, ctx.theme, geo);
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
