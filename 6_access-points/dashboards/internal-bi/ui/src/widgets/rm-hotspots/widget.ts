/**
 * Supply Hotspots — worst regions weighted by service volume (Resource §2).
 * answers.md Q3-rm-hotspots · insight-notes: KEEP AND EXTEND — add service volume so a stockout at
 * a high-throughput region ranks above one at a quiet region (stock list → impact list).
 * Source: bi_supply + DHIS2 (service volume) + MFR.
 * DATA CONTRACT (mock: rm-hotspots.json): rank · region · composite:num · exposed_services:int ·
 *   service_volume_month:int. reactsTo: geography.
 *
 * 2026-07-12 (X5 · RM-C4): migrated onto the shared paginatedTable. Rows arrive ranked
 * worst-first; the top-3 rows' composite score is drawn in ALERT-RED via TableColumn.cellClass
 * (index < 3). The permanently-empty 'Trend' column was REMOVED — no data source feeds it, so a
 * flat placeholder is not shown. Only columns with data remain (rank/region/composite/exposed/volume).
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import type { TableColumn } from '../_shared/charts';
import { paginatedTable } from '../_shared/charts';
import { regionName } from '../_shared/reference';

const kfmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));

const def: WidgetDef = {
  id: 'rm-hotspots',
  reactsTo: ['geography'],
  async render(ctx: WidgetCtx) {
    const rows = await ctx.fetchData();
    if (!rows || !rows.length) { ctx.empty('No supply hotspot rows for the selected filters.'); return; }
    const t = ctx.theme;

    const shaped = rows.map(r => ({
      rank: r.rank ?? '',
      region: regionName(String(r.region ?? '')),
      composite: Number(r.composite ?? 0).toFixed(1),
      exposed: Number(r.exposed_services ?? 0).toLocaleString(),
      volume: kfmt(Number(r.service_volume_month ?? 0)),
    }));
    const columns: TableColumn[] = [
      { id: 'rank', label: '#' },
      { id: 'region', label: 'Region' },
      // Top-3 hotspots (rows arrive ranked worst-first) get the composite in alert-red.
      { id: 'composite', label: 'Composite', cellClass: (_v, _row, i) => (i < 3 ? `color:${t.status.alert};font-weight:700` : '') },
      { id: 'exposed', label: 'Exposed services' },
      { id: 'volume', label: 'Service volume /mo' },
    ];

    // A one-line executive lead sits above the table (no nested card): paginatedTable
    // clears its own container, so the table mounts into a child while the lead stays.
    ctx.el.innerHTML = `<div class="rmh-table" style="flex:1;min-height:0"></div>`;
    const mount = ctx.el.querySelector('.rmh-table') as HTMLElement;
    // No search/sort: the incoming worst-first ranking is load-bearing (top-3 highlight = the 3 worst).
    return paginatedTable(mount, shaped, columns, ctx.theme, {});
  },
};
export default def;
