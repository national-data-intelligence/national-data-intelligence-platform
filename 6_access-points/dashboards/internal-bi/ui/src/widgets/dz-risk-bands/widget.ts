/**
 * Risk Escalations — woreda band-movement donut (Disease §2).
 * answers.md Q3-dz-risk-bands · insight-notes: TRANSFORM (a static risk *distribution* names no
 * woreda and drives no action → re-cut as the actionable MOVEMENT metric: woredas that changed
 * band this week). Guardrail: band thresholds stated; gaps distinguishable from real changes →
 * the coverage footnote shows observed/expected woreda-weeks.
 * Source: bi_idsr.mart_idsr_disease_weekly (week-over-week band deltas) + MFR (naming).
 *
 * COMPOSITION (DS-D2 redesign): a balanced vertical card that fills the tall
 * slot beside the Burden & Readiness Map — a clean ring (total woredas in the
 * hub) over a per-band distribution list (swatch · proportion bar · count · %),
 * then a semantic net-movement chip + coverage footnote. Both the ring and the
 * band list flex-grow so the card fills its height instead of stranding white
 * space, and the ring follows the card via a ResizeObserver.
 * Colours speak the MAP's risk language and stay theme-aware: bands resolve from
 * ctx.theme status/navy tokens (CSS-var-backed → adapt in light + dark), and the
 * chip/track tints are derived from those same tokens — no hardcoded hex.
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
    // Translucent tint of a theme token (hex → rgba) — for chip/track fills that
    // must follow the palette in light + dark. Local copy (no shared coupling).
    const tint = (hex: string, a: number) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex);
      if (!m) return hex;
      const n = parseInt(m[1], 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    };
    const total = Number(r.total_woredas ?? 0);
    // Band colours = the same risk semantics as the neighbouring choropleth
    // (escalating = alert red · watch = amber · improving = good green · quiet =
    // neutral navy). All are ctx.theme tokens, so they re-theme automatically.
    const segs = [
      { name: 'Escalated', value: Number(r.escalated ?? 0), color: t.status.alert },
      { name: 'Stable Watch', value: Number(r.stable_watch ?? 0), color: t.status.watch },
      { name: 'De-escalated', value: Number(r.de_escalated ?? 0), color: t.status.good },
      { name: 'Very Low', value: Number(r.very_low ?? 0), color: t.status.info },
    ];
    const sum = segs.reduce((a, s) => a + s.value, 0) || 1;
    const net = Number(r.net_escalations ?? 0);
    const obs = Number(r.observed_woreda_weeks ?? 0), exp = Number(r.expected_woreda_weeks ?? 0);
    const cov = exp ? Math.round((obs / exp) * 100) : 0;
    // Net movement reads semantically: more escalations than de-escalations = bad
    // (alert), a net improvement = good, flat = neutral.
    const netTone = net > 0 ? t.status.alert : net < 0 ? t.status.good : t.status.info;
    const netArrow = net > 0 ? '▲' : net < 0 ? '▼' : '•';

    ctx.el.style.cssText = 'display:flex;flex-direction:column;height:100%;gap:.3rem';

    // Per-band distribution rows — the compact legend + counts that fills the
    // lower half symmetrically (swatch · name · proportion bar · count · share).
    const bandRows = segs.map(s => {
      const pct = Math.round((s.value / sum) * 100);
      return `<div style="display:grid;grid-template-columns:11px 92px 1fr 34px 40px;align-items:center;gap:.5rem;font-size:.78rem">
        <span style="width:11px;height:11px;border-radius:3px;background:${s.color}"></span>
        <span style="color:${t.ink[1]};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.name}</span>
        <span style="height:8px;border-radius:4px;background:${t.navy['50']};overflow:hidden">
          <span style="display:block;height:100%;width:${pct}%;background:${s.color};border-radius:4px"></span></span>
        <span style="text-align:right;font-weight:700;color:${t.ink[0]};font-variant-numeric:tabular-nums">${s.value.toLocaleString()}</span>
        <span style="text-align:right;color:${t.ink[3]};font-variant-numeric:tabular-nums">${pct}%</span>
      </div>`;
    }).join('');

    ctx.el.innerHTML = `
      <p style="font-size:.82rem;color:${t.ink[2]};margin:0">Woreda band changes this week</p>
      <div class="rb-ring" style="flex:1.25 1 0;min-height:190px"></div>
      <div style="flex:1 1 0;display:flex;flex-direction:column;justify-content:center;gap:.55rem;
        border-top:1px solid ${t.line};padding-top:.6rem">${bandRows}</div>
      <div style="text-align:center;margin-top:.1rem">
        <span style="display:inline-flex;align-items:center;gap:.35rem;font-size:.74rem;font-weight:600;color:${netTone};
          background:${tint(netTone, 0.12)};border-radius:999px;padding:.22rem .7rem">${netArrow} Net ${net >= 0 ? '+' : ''}${net} escalations vs prior week</span>
      </div>
      <div style="font-size:.72rem;color:${t.ink[3]};text-align:center">Based on ${obs.toLocaleString()} of ${exp.toLocaleString()} expected woreda-weeks (${cov}%)</div>`;

    const chart = echarts.init(ctx.el.querySelector('.rb-ring') as HTMLElement);
    chart.setOption({
      textStyle: { fontFamily: t.fontSans },
      // Hub label carries the headline count; per-band numbers live in the list
      // below, so the ring stays clean (no outside labels / label lines).
      title: {
        text: total.toLocaleString(), subtext: 'woredas tracked', left: 'center', top: '42%',
        textStyle: { fontSize: 30, fontWeight: 800, color: t.ink[0] },
        subtextStyle: { fontSize: 11, color: t.ink[3] },
      },
      tooltip: { trigger: 'item', formatter: '{b}<br/><b>{c}</b> woredas ({d}%)' },
      series: [{
        type: 'pie', radius: ['58%', '80%'], center: ['50%', '50%'], avoidLabelOverlap: true,
        label: { show: false }, labelLine: { show: false },
        data: segs.map(s => ({ value: s.value, name: s.name, itemStyle: { color: s.color, borderColor: t.paper, borderWidth: 2, borderRadius: 3 } })),
      }],
    });
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    // Follow the CARD's size too — a scope reflow (global-filter reactivity)
    // resizes the grid without a window resize, and the ring flex-grows with the
    // card height; same treatment as the shared bindResize in _shared/charts.ts.
    let ro: ResizeObserver | undefined;
    try { ro = new ResizeObserver(() => chart.resize()); ro.observe(chart.getDom()); } catch { /* window resize covers it */ }
    return () => { window.removeEventListener('resize', onResize); ro?.disconnect(); chart.dispose(); };
  },
};
export default def;
