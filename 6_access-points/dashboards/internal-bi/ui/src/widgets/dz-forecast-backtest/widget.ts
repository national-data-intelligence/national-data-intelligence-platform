/** Forecast backtest — per-region hits / false alarms / misses of the EWARS
 *  alarm model against what surveillance actually observed (federated
 *  ML-registry × marts join). Precision/recall a programme officer can hold
 *  the model to — trust is EARNED, not asserted. */
import type { WidgetDef } from '../../runtime/types';
import { paginatedTable } from '../_shared/charts';
import { regionName } from '../_shared/reference';

const def: WidgetDef = {
  id: 'dz-forecast-backtest',
  reactsTo: ['geography'],
  async render(ctx) {
    const rows = await ctx.fetchData();
    if (!rows || !rows.length) { ctx.empty('No alarm history to backtest in the current scope.'); return; }
    const shaped = rows.map(r => ({
      region: regionName(r.region_id),
      hits: Number(r.hits ?? 0),
      false_alarms: Number(r.false_alarms ?? 0),
      misses: Number(r.misses ?? 0),
      precision: r.precision_pct == null ? '—' : `${Number(r.precision_pct).toFixed(1)}%`,
      recall: r.recall_pct == null ? '—' : `${Number(r.recall_pct).toFixed(1)}%`,
      verdict: r.precision_pct == null || r.recall_pct == null ? 'no signal'
        : Number(r.precision_pct) >= 60 && Number(r.recall_pct) >= 60 ? 'reliable'
        : Number(r.recall_pct) < 40 ? 'misses outbreaks'
        : Number(r.precision_pct) < 40 ? 'cries wolf' : 'mixed',
    }));
    return paginatedTable(ctx.el, shaped, [
      { id: 'region', label: 'Region' },
      { id: 'hits', label: 'Alarms confirmed' },
      { id: 'false_alarms', label: 'False alarms' },
      { id: 'misses', label: 'Missed exceedances' },
      { id: 'precision', label: 'Precision' },
      { id: 'recall', label: 'Recall' },
      { id: 'verdict', label: 'Verdict', format: 'pill' },
    ], ctx.theme, { search: false, sort: true, pageSize: 14 });
  },
};
export default def;
