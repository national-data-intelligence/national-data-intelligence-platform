/**
 * Cross-Disease Anomalies — z-score grid (Disease §4).
 * answers.md Q3-dz-zscore-grid · insight-notes: KEEP (true warehouse view — cross-disease
 * anomaly detection no single-program system can do) + add a plain-language "what stands out"
 * caption from the top cell. z_score = (current_week_cases − historical_week_mean)/sd, clipped
 * ±3 for colour; thin-baseline cells flagged.
 * Source: bi_idsr.mart_idsr_disease_weekly (+ 5-year baseline).
 *
 * DATA CONTRACT (mock: dz-zscore-grid.json) — one row per disease × region:
 *   disease:str · region:str · z_score:num(−3..+3) · thin_baseline:bool
 * reactsTo: geography · period (cross-disease scan only in the all-programmes view).
 *
 * 2026-07-07 (final visual mandate): reference-golden monochrome heatmap (silver →
 * charcoal ramp via the shared `heatmap` helper) with "strongest"/"thin baseline"
 * footer pills — supersedes the earlier diverging heatGrid round (owner #11).
 * Region codes render as full names in the column headers.
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import { heatmap } from '../_shared/charts';
import { regionName } from '../_shared/reference';

const def: WidgetDef = {
  id: 'dz-zscore-grid',
  reactsTo: ['geography', 'period'],
  async render(ctx: WidgetCtx) {
    if (ctx.filters.programme !== 'all') {
      ctx.empty('Cross-disease anomaly scan applies to the all-programmes view.'); return;
    }
    const data = await ctx.fetchData();
    if (!data || !data.length) { ctx.empty('No cross-disease anomaly data for the selected filters.'); return; }
    const t = ctx.theme;

    const diseases: string[] = [], regions: string[] = [];
    const cell: Record<string, Record<string, number>> = {};
    let top = { disease: '', region: '', z: -Infinity };
    for (const r of data) {
      const d = String(r.disease ?? '-'), reg = String(r.region ?? '-'), z = Number(r.z_score ?? 0);
      if (!diseases.includes(d)) diseases.push(d);
      if (!regions.includes(reg)) regions.push(reg);
      (cell[d] ||= {})[reg] = z;
      if (z > top.z) top = { disease: d, region: reg, z };
    }
    const rows = diseases.map(d => ({ name: d, probs: regions.map(reg => (cell[d][reg] == null ? null : cell[d][reg])) }));
    const thin = data.filter(r => r.thin_baseline).map(r => `${r.disease}·${r.region}`);

    ctx.el.innerHTML = `
      <p style="font-size:.82rem;color:${t.ink[2]};margin:0 0 .5rem">Weekly z-score vs 5-year baseline</p>
      <div class="dz-zg-mount"></div>
      <div style="margin-top:.5rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
        <span style="font-size:.72rem;font-weight:600;color:${t.status.alert};background:var(--alert-50);border-radius:999px;padding:.15rem .55rem">${top.disease} · ${regionName(top.region)} strongest</span>
        ${thin.length ? `<span style="font-size:.72rem;color:${t.status.watch};background:var(--watch-50);border-radius:999px;padding:.15rem .55rem">Thin baseline: ${thin.length}</span>` : ''}
      </div>`;
    const mount = ctx.el.querySelector('.dz-zg-mount') as HTMLElement;
    // Cool sidebar/silver monochrome ramp (silver → charcoal) — gentler on the eye than the warm ramp.
    const cleanup = heatmap(mount, rows, regions.map(regionName), t, {
      min: -3, max: 3, ramp: ['#EEF2F7', '#CBD5E1', '#94A3B8', '#64748B', '#334155'],
      fmt: (v: number) => v.toFixed(1), label: 'z-score', cellH: 62, gridLeft: 128,
    });
    return cleanup;
  },
};
export default def;
