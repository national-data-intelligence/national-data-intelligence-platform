/** Overview · disease digest KPIs — reuses the dz-kpi-strip fetcher/mart. */
import type { WidgetDef } from '../../runtime/types';
import { kpiStrip } from '../_shared/charts';

const def: WidgetDef = {
  id: 'ov-disease-pulse',
  frameless: true,   // KPI tiles ARE the cards — no wrapping card (owner 2026-07-07)
  reactsTo: ['geography', 'programme'],
  async render(ctx) {
    const r = (await ctx.fetchData({ model: 'ears' }))?.[0];
    if (!r) { ctx.empty('No surveillance data for the current scope.'); return; }
    const alarms = Number(r.alarms_now ?? 0);
    return kpiStrip(ctx.el, [
      { label: 'New cases (7d)', value: Number(r.cases_wk ?? 0).toLocaleString(), note: 'This week' },
      { label: 'Active alarms', value: String(alarms), status: alarms >= 4 ? 'alert' : alarms >= 1 ? 'watch' : 'good', note: 'By woreda and disease' },
      { label: 'Active diseases', value: String(r.active_diseases ?? 0), note: 'Reporting cases' },
    ], ctx.theme, 3);
  },
};
export default def;
