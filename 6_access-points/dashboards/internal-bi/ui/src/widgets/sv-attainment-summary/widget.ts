/**
 * Attainment Summary (Service §1) — distribution of flagship indicators vs HSTP-II targets.
 * answers.md Q3-sv-attainment-summary. Counts from the flagship rows; composite = average of
 * min(current/target*100, 100) for target-bearing indicators.
 * DATA CONTRACT (mock: sv-attainment-summary.json) — single row:
 *   on_track_count · watch_count · at_risk_count · total_count · composite_score:int
 * reactsTo: geography · programme · period.
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';

const def: WidgetDef = {
  id: 'sv-attainment-summary',
  reactsTo: ['geography', 'programme', 'period'],
  async render(ctx: WidgetCtx) {
    const r = (await ctx.fetchData())?.[0];
    if (!r) { ctx.empty('No attainment summary for the selected filters.'); return; }
    const t = ctx.theme;
    const total = Number(r.total_count ?? 0) || 1;
    const tint = (hex: string, a: number) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return hex;
      const n = parseInt(m[1], 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    };
    // Bars share the dark-navy palette; STATUS now reads from a coloured icon per row, not the bar.
    const rowsSpec = [
      { label: 'On Track', sub: '≥ 90% of target', n: Number(r.on_track_count ?? 0), icon: 'i-check-circle', ic: t.status.good, bar: t.navy['700'] },
      { label: 'Watch', sub: '75–90% of target', n: Number(r.watch_count ?? 0), icon: 'i-eye', ic: t.status.watch, bar: t.navy['600'] },
      { label: 'At Risk', sub: '< 75% of target', n: Number(r.at_risk_count ?? 0), icon: 'i-alert', ic: t.status.alert, bar: t.navy['500'] },
    ];
    const comp = Number(r.composite_score ?? 0);
    ctx.el.innerHTML = `
      <p style="font-size:.82rem;color:${t.ink[2]};margin:0 0 .4rem">Distribution against HSTP-II targets</p>
      <div style="display:flex;flex-direction:column;height:calc(100% - 1.4rem)">
        <div style="flex:1;display:flex;flex-direction:column">
        ${rowsSpec.map((s, i) => {
          const pct = Math.round((s.n / total) * 100);
          return `<div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:.5rem;${i < rowsSpec.length - 1 ? `border-bottom:1px solid ${t.line};` : ''}">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="display:flex;align-items:center;gap:.55rem;min-width:0">
                <span style="display:inline-grid;place-items:center;width:28px;height:28px;border-radius:8px;background:${tint(s.ic, 0.14)};color:${s.ic};flex-shrink:0"><svg class="ico" aria-hidden="true"><use href="#${s.icon}"/></svg></span>
                <span style="font-size:.86rem;font-weight:600;color:${t.ink[0]}">${s.label} <span style="font-weight:500;color:${t.ink[3]};font-size:.72rem">· ${s.sub}</span></span>
              </span>
              <span style="font-weight:800;font-variant-numeric:tabular-nums;color:${t.ink[0]}">${s.n}/${total}</span>
            </div>
            <span style="display:block;height:10px;border-radius:5px;background:${t.navy['50']};overflow:hidden"><span style="display:block;height:100%;width:${pct}%;background:${s.bar};border-radius:5px"></span></span>
          </div>`;
        }).join('')}
        </div>
        <div style="padding-top:.85rem;border-top:1px solid ${t.line};display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:.86rem;font-weight:600;color:${t.ink[0]}">Composite Score</span>
          <span style="font-size:1.7rem;font-weight:800;font-variant-numeric:tabular-nums;color:${comp >= 75 ? t.status.good : comp >= 60 ? t.status.watch : t.status.alert}">${comp}<span style="font-size:.9rem;color:${t.ink[3]}"> / 100</span></span>
        </div>
      </div>`;
    return () => { /* pure DOM */ };
  },
};
export default def;
