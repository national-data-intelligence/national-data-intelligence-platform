/** Region × commodity months-on-hand heatmap — bi_supply.mart_supply_region_stock
 *  (HCMIS EPSS hub → region_id). Low stock = red, healthy = green. */
import type { WidgetDef } from '../../runtime/types';
import { heatmap, STOCK_RAMP } from '../_shared/charts';
import { regionName } from '../_shared/reference';

const def: WidgetDef = {
  id: 'rm-stock-heatmap',
  reactsTo: ['geography'],
  async render(ctx) {
    const rows = await ctx.fetchData();
    if (!rows || !rows.length) { ctx.empty('No regional stock data for the current scope.'); return; }
    const regions = [...new Set(rows.map(r => String(r.region_id)))].sort();
    const byCommodity: Record<string, Record<string, number>> = {};
    for (const r of rows) (byCommodity[String(r.commodity_name)] ||= {})[String(r.region_id)] = Number(r.mos ?? 0);
    const commodities = Object.keys(byCommodity).sort().slice(0, 18);
    const heatRows = commodities.map(c => ({ name: c, probs: regions.map(reg => (byCommodity[c][reg] ?? null)) }));
    return heatmap(ctx.el, heatRows, regions.map(regionName), ctx.theme, {
      max: 6, ramp: STOCK_RAMP, fmt: (v: number) => `${v.toFixed(1)}mo`, label: 'Stock',
    });
  },
};
export default def;
