/**
 * Risk Escalations — woreda band-movement donut (Disease §2).
 * answers.md Q3-dz-risk-bands · insight-notes: TRANSFORM (a static risk *distribution* names no
 * woreda and drives no action → re-cut as the actionable MOVEMENT metric: woredas that changed
 * band this week). Guardrail: band thresholds stated; gaps distinguishable from real changes →
 * the coverage footnote shows observed/expected woreda-weeks.
 * Source: bi_idsr.mart_idsr_disease_weekly (week-over-week band deltas) + MFR (naming).
 *
 * DATA CONTRACT (mock: dz-risk-bands.json) — single row:
 *   total_woredas:int · expected_woreda_weeks:int · observed_woreda_weeks:int ·
 *   escalated:int · stable_watch:int · de_escalated:int · very_low:int · net_escalations:int
 * reactsTo: geography · programme.
 */
import * as echarts from 'echarts';
import type { WidgetDef, WidgetCtx } from '../../runtime/types';

const def: WidgetDef = {
  id: 'dz-risk-bands',
  reactsTo: ['geography', 'programme'],
  async render(ctx: WidgetCtx) {
    const r = (await ctx.fetchData())?.[0];
    if (!r) { ctx.empty('No risk-band movement data for the selected filters.'); return; }
    const t = ctx.theme;
    const total = Number(r.total_woredas ?? 0);
    const segs = [
      { name: 'Escalated', value: Number(r.escalated ?? 0), color: t.status.alert },
      { name: 'Stable Watch', value: Number(r.stable_watch ?? 0), color: t.status.watch },
      { name: 'De-escalated', value: Number(r.de_escalated ?? 0), color: t.status.good },
      { name: 'Very Low', value: Number(r.very_low ?? 0), color: t.navy['500'] },
    ];
    const sum = segs.reduce((a, s) => a + s.value, 0) || 1;
    const net = Number(r.net_escalations ?? 0);
    const obs = Number(r.observed_woreda_weeks ?? 0), exp = Number(r.expected_woreda_weeks ?? 0);
    const cov = exp ? Math.round((obs / exp) * 100) : 0;
    ctx.el.style.cssText = 'display:flex;flex-direction:column;justify-content:center;height:100%';

    ctx.el.innerHTML = `
      <p style="font-size:.82rem;color:${t.ink[2]};margin:0 0 .2rem">Woreda band changes this week</p>
      <div class="rb-ring" style="width:100%;height:330px"></div>
      <div class="rb-legend" style="display:flex;flex-wrap:wrap;justify-content:center;gap:.4rem 1.4rem;margin-top:.1rem"></div>
      <div style="text-align:center;margin-top:.6rem">
        <span style="display:inline-block;font-size:.74rem;font-weight:600;color:${t.status.alert};
          background:var(--alert-50);border-radius:999px;padding:.2rem .6rem">Net ${net >= 0 ? '+' : ''}${net} escalations vs prior week</span>
      </div>
      <div style="margin-top:.4rem;font-size:.72rem;color:${t.ink[3]};text-align:center">Based on ${obs.toLocaleString()} of ${exp.toLocaleString()} expected woreda-weeks (${cov}%)</div>`;

    const legend = ctx.el.querySelector('.rb-legend') as HTMLElement;
    legend.innerHTML = segs.map(s => `<span style="display:inline-flex;align-items:center;gap:.4rem;font-size:.78rem;color:${t.ink[1]}">
        <span style="width:9px;height:9px;border-radius:2px;background:${s.color}"></span>${s.name}</span>`).join('');

    const chart = echarts.init(ctx.el.querySelector('.rb-ring') as HTMLElement);
    chart.setOption({
      textStyle: { fontFamily: t.fontSans },
      title: {
        text: total.toLocaleString(), subtext: 'Total woredas', left: 'center', top: '40%',
        textStyle: { fontSize: 30, fontWeight: 800, color: t.ink[0] },
        subtextStyle: { fontSize: 11, color: t.ink[3] },
      },
      tooltip: { trigger: 'item', formatter: '{b}<br/><b>{c}</b> ({d}%)' },
      series: [{
        type: 'pie', radius: ['48%', '70%'], center: ['50%', '47%'], avoidLabelOverlap: true,
        label: { show: true, position: 'outside', formatter: '{c} ({d}%)', fontSize: 11, color: t.ink[1] },
        labelLine: { show: true, length: 10, length2: 10, lineStyle: { color: t.line } },
        data: segs.map(s => ({ value: s.value, name: s.name, itemStyle: { color: s.color, borderColor: t.paper, borderWidth: 2 } })),
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
