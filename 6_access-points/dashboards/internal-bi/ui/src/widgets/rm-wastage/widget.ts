/**
 * Wastage & Consistency (Resource §3).
 * answers.md Q3-rm-wastage · insight-notes: KEEP AND EXTEND — a treemap alone is a shape; pair it
 * with commodity-use vs service-output consistency (consumption observed vs expected from service
 * volume) so wastage reads as an audit signal. Guardrail: frame mismatches as audit signals, not
 * accusations. Source: bi_supply + DHIS2 (+ EMR where available).
 *
 * DATA CONTRACT (mock: rm-wastage.json): commodity · wastage_score:num · use_band:'adequate'|'high'|'low'
 * (the use-vs-service mix is derived from the use_band distribution). reactsTo: geography · period · commodity.
 */
import * as echarts from 'echarts';
import type { WidgetDef, WidgetCtx } from '../../runtime/types';

const def: WidgetDef = {
  id: 'rm-wastage',
  reactsTo: ['geography', 'period', 'commodity'],
  async render(ctx: WidgetCtx) {
    const rows = await ctx.fetchData();
    if (!rows || !rows.length) { ctx.empty('No wastage and consistency data for the selected filters.'); return; }
    const t = ctx.theme;
    const ramp = t.ramps.wastageTreemap;              // high→low wastage
    const scores = rows.map(r => Number(r.wastage_score ?? 0));
    const max = Math.max(...scores), min = Math.min(...scores), span = (max - min) || 1;
    // Shade across the scores actually shown, so close scores still read as different tiles.
    const colorFor = (v: number) => ramp[Math.min(ramp.length - 1, Math.round((1 - (v - min) / span) * (ramp.length - 1)))];

    // Wastage bands from the fetcher (share of received units wasted): High ≥10%,
    // Moderate 3–10%, Low <3%. Counted over the commodities shown in the treemap.
    const band = (b: string) => rows.filter(r => String(r.use_band).toLowerCase() === b).length;
    const mix = [
      { label: 'High wastage', sub: '10% or more wasted', v: band('high'), col: t.status.alert },
      { label: 'Moderate', sub: '3 to 10% wasted', v: band('moderate'), col: t.status.watch },
      { label: 'Low wastage', sub: 'under 3% wasted', v: band('low'), col: t.status.good },
    ];

    ctx.el.innerHTML = `
      <div style="display:flex;gap:1rem">
        <div class="rm-wt-tree" style="flex:1;min-width:0;height:300px"></div>
        <div style="width:170px;flex-shrink:0;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;gap:.8rem">
          <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:${t.ink[3]}">Wastage bands</div>
          ${mix.map(m => `<div>
            <div style="font-size:1.6rem;font-weight:800;color:${m.col};font-variant-numeric:tabular-nums;line-height:1">${m.v}<span style="font-size:.8rem;font-weight:600;color:${t.ink[3]}"> of ${rows.length}</span></div>
            <div style="font-size:.76rem;font-weight:600;color:${t.ink[1]}">${m.label}</div></div>`).join('')}
        </div>
      </div>`;

    const chart = echarts.init(ctx.el.querySelector('.rm-wt-tree') as HTMLElement);
    chart.setOption({
      textStyle: { fontFamily: t.fontSans },
      tooltip: { formatter: (p: any) => `${p.name}<br/>wastage <b>${p.value}</b>` },
      series: [{
        type: 'treemap', roam: false, nodeClick: false, breadcrumb: { show: false },
        width: '100%', height: '100%', top: 0, left: 0, right: 0, bottom: 0,
        itemStyle: { borderColor: t.paper, borderWidth: 1, gapWidth: 1 },
        label: { show: true, formatter: '{b}\n{c}', fontSize: 11, color: '#fff', fontWeight: 600, overflow: 'truncate' },
        data: rows.map(r => ({ name: String(r.commodity ?? '-'), value: Number(r.wastage_score ?? 0), itemStyle: { color: colorFor(Number(r.wastage_score ?? 0)) } })),
      }],
    });
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    // Follow the CARD's size too — a scope reflow (global-filter reactivity)
    // resizes the grid without a window resize; same treatment as the shared
    // bindResize in _shared/charts.ts.
    let ro: ResizeObserver | undefined;
    try { ro = new ResizeObserver(() => chart.resize()); ro.observe(chart.getDom()); } catch { /* window resize covers it */ }
    return () => { window.removeEventListener('resize', onResize); ro?.disconnect(); chart.dispose(); };
  },
};
export default def;
