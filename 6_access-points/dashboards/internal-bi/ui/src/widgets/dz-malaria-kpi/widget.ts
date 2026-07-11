/** Malaria KPIs — the HLR Table 7 MVP set as the specified multi-line monthly
 *  chart: confirmed cases (bars) with test-positivity rate + ITN + IRS
 *  coverage (right-axis lines). All from real seeded MAL-* HMIS elements. */
import type { WidgetDef } from '../../runtime/types';
import { dualAxisBarLine } from '../_shared/charts';

const def: WidgetDef = {
  id: 'dz-malaria-kpi',
  reactsTo: ['geography', 'period'],
  reflow: 'ratio',
  async render(ctx) {
    const rows = await ctx.fetchData();
    if (!rows || !rows.length) { ctx.empty('No malaria KPI data for the selected filters.'); return; }
    const t = ctx.theme;
    const months = rows.map(r => String(r.month_id));
    const spec = {
      weeks: months,
      cases: rows.map(r => Number(r.confirmed ?? 0)),
      lines: [
        { name: 'Test positivity %', data: rows.map(r => Number(r.test_positivity_pct ?? 0)), color: t.ramps.diseaseBurden[1] },
        { name: 'ITN coverage %', data: rows.map(r => Number(r.itn_coverage_pct ?? 0)), color: t.ramps.scoreReliability[2] },
        { name: 'IRS coverage %', data: rows.map(r => Number(r.irs_coverage_pct ?? 0)), color: t.ramps.scoreReliability[1], dashed: true },
      ],
    };
    const cleanup = dualAxisBarLine(ctx.el, spec, t, { fill: true });
    return cleanup;
  },
};
export default def;
