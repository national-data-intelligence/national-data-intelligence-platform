/**
 * Drop-off Composition by Region (Service §2).
 * answers.md Q3-sv-dropoff-region. Stacked share of each MNCH drop-off stage (ANC dropout /
 * delivery gap / PNC gap) per region — where the leakage concentrates geographically.
 * DATA CONTRACT (mock: sv-dropoff-region.json): region · anc_dropout_pct · delivery_gap_pct ·
 *   pnc_gap_pct · total_dropoff_pct. reactsTo: geography · programme · period.
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import { stackedBar } from '../_shared/charts';
import { regionName } from '../_shared/reference';

const def: WidgetDef = {
  id: 'sv-dropoff-region',
  reactsTo: ['geography', 'programme', 'period'],
  async render(ctx: WidgetCtx) {
    const rows = await ctx.fetchData();
    if (!rows || !rows.length) { ctx.empty('No regional drop-off data for the selected filters.'); return; }
    const t = ctx.theme;
    const cats = rows.map(r => regionName(String(r.region ?? '-')));
    ctx.el.innerHTML = `<p style="font-size:.82rem;color:${t.ink[2]};margin:0 0 .4rem">Share of each step's drop-off, by region</p><div class="sv-do-mount"></div>`;
    return stackedBar(ctx.el.querySelector('.sv-do-mount') as HTMLElement, {
      categories: cats,
      series: [
        { name: 'ANC dropout', data: rows.map(r => Number(r.anc_dropout_pct ?? 0)), color: t.navy['700'] },
        { name: 'Delivery gap', data: rows.map(r => Number(r.delivery_gap_pct ?? 0)), color: t.navy['500'] },
        { name: 'PNC gap', data: rows.map(r => Number(r.pnc_gap_pct ?? 0)), color: t.ink[3] },
      ],
    }, t);
  },
};
export default def;
