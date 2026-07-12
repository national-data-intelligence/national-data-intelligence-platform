/**
 * Attainment Summary (Service §1) — distribution of flagship indicators vs HSTP-II targets.
 * answers.md Q3-sv-attainment-summary. Counts from the flagship rows; composite = average of
 * min(current/target*100, 100) for target-bearing indicators.
 * DATA CONTRACT (mock: sv-attainment-summary.json) — single row:
 *   on_track_count · watch_count · at_risk_count · total_count · composite_score:int
 * reactsTo: geography · programme · period.
 *
 * 2026-07-12 (SP-D2 redesign): the three attainment bars no longer float in isolation. They now
 * form ONE coordinated ranked set sharing a single 0→total axis: fixed label / bar / count columns
 * align across rows, continuous vertical gridlines (0·25·50·75·100% of indicators) run behind all
 * three bars to tie them together, the share % rides on each bar, and the absolute count sits in an
 * aligned right column. Bars use a calm single-hue navy ramp (severity read from the coloured status
 * chip, NOT the bar colour). Composite becomes a slim 0–100 gauge with a dashed Target-80 reference.
 * Presentation-only change — fetchData / data shape / id / reactsTo / empty-state are untouched.
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';

const def: WidgetDef = {
  id: 'sv-attainment-summary',
  reactsTo: ['geography', 'programme', 'period'],
  async render(ctx: WidgetCtx) {
    const r = (await ctx.fetchData())?.[0];
    if (!r) { ctx.empty('No attainment summary for the selected filters.'); return; }
    const t = ctx.theme;
    const totalCount = Number(r.total_count ?? 0);
    const total = totalCount || 1;                 // divisor guard (axis is 0→total)
    const tint = (hex: string, a: number) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return hex;
      const n = parseInt(m[1], 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    };
    // Bars share a calm single-hue navy ramp (deep→light by severity); STATUS reads from the
    // coloured chip, never the bar. Sub-labels match the fetcher's real bands (≥80 / 60–80 / <60).
    const rowsSpec = [
      { label: 'On Track', sub: '≥ 80% of target', n: Number(r.on_track_count ?? 0), icon: 'i-check-circle', ic: t.status.good, bar: t.navy['700'] },
      { label: 'Watch',    sub: '60–80% of target', n: Number(r.watch_count ?? 0),    icon: 'i-eye',          ic: t.status.watch, bar: t.navy['600'] },
      { label: 'At Risk',  sub: '< 60% of target',  n: Number(r.at_risk_count ?? 0),  icon: 'i-alert',        ic: t.status.alert, bar: t.navy['500'] },
    ];
    const comp = Number(r.composite_score ?? 0);
    const compW = Math.max(0, Math.min(100, comp));
    const compColor = comp >= 80 ? t.status.good : comp >= 60 ? t.status.watch : t.status.alert;
    const TARGET = 80;                             // on-track threshold → composite target reference

    // ── ranked bar set: [icon+label 116px] [shared-axis bar 1fr] [count 34px] ──
    const rows = rowsSpec.map((s, i) => {
      const share = Math.round((s.n / total) * 100);
      const fillW = s.n > 0 ? Math.max(share, 3) : 0;   // keep a visible nub for non-zero bands
      const inside = fillW >= 26;                       // wide enough to hold the % on the bar
      const gr = i + 1;
      return `
        <div style="grid-column:1;grid-row:${gr};z-index:1;display:flex;align-items:center;gap:.5rem;min-width:0">
          <span style="display:inline-grid;place-items:center;width:24px;height:24px;border-radius:7px;background:${tint(s.ic, 0.14)};color:${s.ic};flex-shrink:0"><svg class="ico" aria-hidden="true"><use href="#${s.icon}"/></svg></span>
          <span style="min-width:0">
            <span style="display:block;font-size:.82rem;font-weight:600;color:${t.ink[0]};line-height:1.15">${s.label}</span>
            <span style="display:block;font-size:.67rem;color:${t.ink[3]};line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.sub}</span>
          </span>
        </div>
        <div style="grid-column:2;grid-row:${gr};z-index:1;display:flex;align-items:center">
          <span style="position:relative;display:block;width:100%;height:18px;border-radius:9px;background:${t.navy['50']};overflow:hidden">
            <span style="position:absolute;top:0;bottom:0;left:0;width:${fillW}%;background:${s.bar};border-radius:9px;display:flex;align-items:center;justify-content:flex-end">
              ${inside ? `<span style="font-size:.66rem;font-weight:700;color:#fff;padding-right:.45rem;font-variant-numeric:tabular-nums">${share}%</span>` : ''}
            </span>
            ${!inside && s.n > 0 ? `<span style="position:absolute;top:0;bottom:0;left:calc(${fillW}% + 5px);display:flex;align-items:center;font-size:.66rem;font-weight:700;color:${t.ink[3]};font-variant-numeric:tabular-nums">${share}%</span>` : ''}
          </span>
        </div>
        <div style="grid-column:3;grid-row:${gr};z-index:1;display:flex;align-items:center;justify-content:flex-end;font-size:.95rem;font-weight:800;color:${t.ink[0]};font-variant-numeric:tabular-nums">${s.n}</div>`;
    }).join('');

    ctx.el.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:.5rem;margin:0 0 .55rem">
          <p style="font-size:.82rem;color:${t.ink[2]};margin:0">Distribution against HSTP-II targets</p>
          <span style="font-size:.72rem;font-weight:600;color:${t.ink[3]};font-variant-numeric:tabular-nums;white-space:nowrap">${totalCount} indicators</span>
        </div>
        <div style="flex:1;min-height:0;display:grid;grid-template-columns:116px 1fr 34px;grid-template-rows:repeat(3,1fr) auto;column-gap:.6rem;position:relative">
          <div style="grid-column:2;grid-row:1 / span 3;z-index:0;background-image:repeating-linear-gradient(to right, ${t.line} 0, ${t.line} 1px, transparent 1px, transparent 25%)"></div>
          ${rows}
          <div style="grid-column:2;grid-row:4;display:flex;justify-content:space-between;padding-top:.3rem;font-size:.62rem;color:${t.ink[3]};font-variant-numeric:tabular-nums">
            <span>0</span><span>50%</span><span>100%</span>
          </div>
        </div>
        <div style="padding-top:.8rem;margin-top:.35rem;border-top:1px solid ${t.line}">
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:.5rem;margin-bottom:.45rem">
            <span style="font-size:.84rem;font-weight:600;color:${t.ink[0]}">Composite Score</span>
            <span style="font-size:1.5rem;font-weight:800;font-variant-numeric:tabular-nums;color:${compColor}">${comp}<span style="font-size:.82rem;font-weight:600;color:${t.ink[3]}"> / 100</span></span>
          </div>
          <div style="position:relative;height:10px;border-radius:5px;background:${t.navy['50']}">
            <span style="position:absolute;top:0;bottom:0;left:0;width:${compW}%;background:${compColor};border-radius:5px"></span>
            <span style="position:absolute;top:-3px;bottom:-3px;left:${TARGET}%;width:2px;background:${t.ink[2]};border-radius:1px"></span>
          </div>
          <div style="position:relative;height:.95rem;margin-top:.3rem;font-size:.62rem;color:${t.ink[3]};font-variant-numeric:tabular-nums">
            <span style="position:absolute;left:0">0</span>
            <span style="position:absolute;left:${TARGET}%;transform:translateX(-50%);white-space:nowrap">Target ${TARGET}</span>
            <span style="position:absolute;right:0">100</span>
          </div>
        </div>
      </div>`;
    return () => { /* pure DOM */ };
  },
};
export default def;
