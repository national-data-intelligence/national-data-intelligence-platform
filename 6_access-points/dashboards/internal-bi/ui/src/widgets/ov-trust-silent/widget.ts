/**
 * System Trust · Active-but-Silent Facilities (Overview §3, card 3 of 4).
 * answers.md Q3-ov-trust-cards. Count of active MFR facilities with no recent DHIS2 report
 * and no supply/EMR signal in the window. Fewer is BETTER, so a downward delta is GOOD
 * (semantic trend colouring, not arrow-based — DECISIONS §G2 / answers Q4.7).
 * DATA CONTRACT (mock: ov-trust-silent.json) single row:
 *   value:int · suffix:str · note:str · delta_text:str · delta_good:bool · spark:int[]
 * reactsTo: geography · programme · period.
 */
import type { WidgetDef } from '../../runtime/types';
import { statCard } from '../_shared/charts';

const def: WidgetDef = {
  id: 'ov-trust-silent',
  reactsTo: ['geography', 'programme', 'period'],
  async render(ctx) {
    const r = (await ctx.fetchData())?.[0];
    if (!r) { ctx.empty('No active-but-silent facility data for the selected filters.'); return; }
    return statCard(ctx.el, {
      subtitle: 'Active in registry, no recent reporting or stock signal',
      value: Number(r.value ?? 0).toLocaleString(),
      note: r.note ?? '',
      delta: r.delta_text ?? '',
      deltaGood: r.delta_good !== false,
      spark: Array.isArray(r.spark) ? r.spark.map(Number) : undefined,
    }, ctx.theme);
  },
};
export default def;
