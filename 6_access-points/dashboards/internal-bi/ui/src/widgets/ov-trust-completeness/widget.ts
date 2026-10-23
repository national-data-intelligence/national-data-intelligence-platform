/**
 * System Trust · Reporting Completeness (Overview §3, card 1 of 4).
 * answers.md Q3-ov-trust-cards. reporting_completeness = reports_received/reports_expected*100.
 * DATA CONTRACT (mock: ov-trust-completeness.json) single row:
 *   value:int(%) · suffix:str · note:str(target) · delta_text:str · delta_good:bool · spark:int[]
 * reactsTo: geography · programme · period.
 */
import type { WidgetDef } from '../../runtime/types';
import { statCard } from '../_shared/charts';

const def: WidgetDef = {
  id: 'ov-trust-completeness',
  reactsTo: ['geography'],
  async render(ctx) {
    const r = (await ctx.fetchData())?.[0];
    if (!r) { ctx.empty('No reporting completeness for the selected filters.'); return; }
    return statCard(ctx.el, {
      value: `${Number(r.value ?? 0)}${r.suffix ?? ''}`,
      delta: r.delta_text ?? '',
      deltaGood: r.delta_good !== false,
    }, ctx.theme);
  },
};
export default def;
