/**
 * System Trust · Facility Mapping Coverage (Overview §3, card 2 of 4).
 * answers.md Q3-ov-trust-cards. facility_mapping = locations_resolved_to_mfr/total_source_locations*100.
 * DATA CONTRACT (mock: ov-trust-mapping.json) single row:
 *   value:int(%) · suffix:str · note:str(target) · delta_text:str · delta_good:bool · spark:int[]
 * reactsTo: geography · programme · period.
 */
import type { WidgetDef } from '../../runtime/types';
import { statCard } from '../_shared/charts';

const def: WidgetDef = {
  id: 'ov-trust-mapping',
  reactsTo: ['geography', 'programme', 'period'],
  async render(ctx) {
    const r = (await ctx.fetchData())?.[0];
    if (!r) { ctx.empty('No facility mapping coverage for the selected filters.'); return; }
    return statCard(ctx.el, {
      subtitle: 'Share of DHIS2, EMR and supply locations resolving to an MFR id',
      value: `${Number(r.value ?? 0)}${r.suffix ?? ''}`,
      note: r.note ?? '',
      delta: r.delta_text ?? '',
      deltaGood: r.delta_good !== false,
      spark: Array.isArray(r.spark) ? r.spark.map(Number) : undefined,
    }, ctx.theme);
  },
};
export default def;
