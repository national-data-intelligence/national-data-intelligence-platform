/**
 * Surveillance Signal Header — 6 headline tiles (Disease §1).
 * answers.md Q3-dz-kpi-strip · insight-notes: KEEP AND EXTEND (add a reporting-completeness
 * footnote per tile so a low count reads as "genuinely low" vs "under-reported" — guardrail G3:
 * completeness is a trust cue, NOT a case rate).
 * Source: bi_idsr.mart_idsr_disease_weekly (+ml) + DQ (expected woreda-weeks).
 *
 * DATA CONTRACT (mock: dz-kpi-strip.json) — one row per tile:
 *   tile:str · value:num · unit:'count'|'percent' · subtitle:str · delta_text:str ·
 *   delta_direction:'good'|'watch'|'alert' · footnote_label:str · footnote_value:str · icon:str
 * reactsTo: geography · programme · period.
 */
import type { WidgetDef } from '../../runtime/types';
import { kpiStrip, type KpiCell } from '../_shared/charts';

const def: WidgetDef = {
  id: 'dz-kpi-strip',
  frameless: true,   // KPI tiles ARE the cards — no wrapping card (owner 2026-07-07)
  reactsTo: ['geography', 'programme', 'period'],
  async render(ctx) {
    const rows = await ctx.fetchData();
    if (!rows || !rows.length) { ctx.empty('No surveillance headline data for the selected filters.'); return; }
    const fmt = (v: number, unit: string) =>
      unit === 'percent' ? `${(+v).toFixed(Number.isInteger(+v) ? 0 : 1)}%` : (+v).toLocaleString();
    const cells: KpiCell[] = rows.map(r => {
      const dir = String(r.delta_direction ?? '');
      return {
        label: String(r.tile ?? ''),
        value: String(r.unit) === 'text' ? String(r.value ?? '-') : fmt(Number(r.value ?? 0), String(r.unit ?? 'count')),
        status: dir === 'alert' ? 'alert' : dir === 'watch' ? 'watch' : dir === 'good' ? 'good' : 'info',
      };
    });
    return kpiStrip(ctx.el, cells, ctx.theme, 6);
  },
};
export default def;
