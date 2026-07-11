/** Health workforce density per region — bi_facility.mart_health_workforce.
 *  (Pending Group C: MFR cadre staffing → mart. Empty until the mart lands.) */
import type { WidgetDef } from '../../runtime/types';
import { lollipop } from '../_shared/charts';
import { regionName } from '../_shared/reference';

const def: WidgetDef = {
  id: 'rm-workforce',
  reactsTo: ['geography'],
  async render(ctx) {
    const rows = await ctx.fetchData();
    if (!rows || !rows.length) { ctx.empty('No workforce data for the current scope.'); return; }
    const data = rows
      .map(r => ({ name: regionName(r.region_id), value: Number(r.density_per_10k ?? r.hcw_total ?? 0) }))
      .filter(d => d.value > 0);
    if (!data.length) { ctx.empty('No workforce data for the current scope.'); return; }
    return lollipop(ctx.el, data, ctx.theme, {});
  },
};
export default def;
