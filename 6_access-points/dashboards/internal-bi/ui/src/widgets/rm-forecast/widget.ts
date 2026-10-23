/**
 * Days to Stockout Timeline (Resource §4).
 * answers.md Q3-rm-forecast · insight-notes: KEEP — model-backed, decision-ready; add model
 * freshness. days_left = SOH / forecast ADC, with a 14-day floor and 30-day horizon. Guardrail G5:
 * stamp last successful model run; never show stale forecast as current.
 * Source: bi_supply + model (stockout_forecast).
 * DATA CONTRACT (mock: rm-forecast.json): commodity · days_left:int · floor_days:int · horizon_days:int
 * reactsTo: geography · commodity.
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import { lollipop } from '../_shared/charts';

const def: WidgetDef = {
  id: 'rm-forecast',
  reactsTo: ['geography', 'commodity'],
  async render(ctx: WidgetCtx) {
    const rows = await ctx.fetchData();
    if (!rows || !rows.length) { ctx.empty('No days-to-stockout forecast for the selected filters.'); return; }
    const t = ctx.theme;
    const data = rows.map(r => ({ name: String(r.commodity ?? '-'), value: Number(r.days_left ?? 0) }))
      .sort((a, b) => a.value - b.value).slice(0, 12);
    const horizon = Number(rows[0]?.horizon_days ?? 30);
    ctx.el.innerHTML = `
      <div class="rm-fc-mount"></div>`;
    const mount = ctx.el.querySelector('.rm-fc-mount') as HTMLElement;
    return lollipop(mount, data, t, { xMax: Math.max(5, Math.ceil(Math.max(...data.map(d => d.value)) * 1.15)) });
  },
};
export default def;
