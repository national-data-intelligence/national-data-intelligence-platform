/**
 * National Service Reliability — ranked-region reliability headline (Overview §1).
 *
 * Redesign target: docs/final-mockkups/gpt-response/01-overview-dashboard-redesign.png.
 * Fuses coverage, coverage-confidence and commodity-readiness into a single composite
 * score (0–100) per region, worst-first. Composite banding read off the mockup legend
 * (Low <60 · Moderate 60–70 · Strong >70) → status tokens alert/watch/good (DECISIONS §G1).
 *
 * DATA CONTRACT (mock: mock-gateway/data/ov-reliability-table.json) — answers.md Q3.
 *   grain: one row per region × current period × programme scope. columns:
 *     rank:int · region:str · composite_score:int(0–100) · coverage_pct:int ·
 *     coverage_confidence_pct:int · commodity_readiness_pct:int · pop_weight_status:str
 *   composite_score = 0.40*coverage + 0.35*coverage_confidence + 0.25*commodity_readiness
 *   (GPT-specified). The widget RENDERS the supplied score; the wiring team owns the
 *   SQL. Population weighting shown as "pending" until POP lands (pop_weight_status).
 * reactsTo: geography · programme · period (Overview global filters).
 *
 * 2026-07-07 (final visual mandate): rendered as the reference-golden simple ranked
 * table — banded rank chips, plain % cells, composite score + bar, "Pop-weighting
 * pending" pill, band legend footer. No local search/pagination (the dt-standard
 * round is superseded here; the goldens show the full ranked list).
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import { regionName } from '../_shared/reference';

/** Composite band → status colour (mockup legend: <60 low, 60–70 moderate, >70 strong). */
function bandColor(v: number, theme: WidgetCtx['theme']): string {
  if (v < 60) return theme.status.alert;
  if (v <= 70) return theme.status.watch;
  return theme.status.good;
}

/** A value + a thin proportional track, for the numeric columns. */
function barCell(value: number, pct: number, fill: string, theme: WidgetCtx['theme'], accent = false): string {
  const w = Math.max(0, Math.min(100, pct));
  const num = accent
    ? `<span style="font-weight:700;font-variant-numeric:tabular-nums;color:${fill}">${value}</span>`
    : `<span style="font-variant-numeric:tabular-nums;color:${theme.ink[1]}">${value}%</span>`;
  return `
    <div style="display:flex;align-items:center;gap:.55rem;min-width:120px">
      ${num}
      <span style="flex:1;height:6px;border-radius:3px;background:${theme.navy['50']};overflow:hidden">
        <span style="display:block;height:100%;width:${w}%;border-radius:3px;background:${fill}"></span>
      </span>
    </div>`;
}

const def: WidgetDef = {
  id: 'ov-reliability-table',
  reactsTo: ['geography', 'programme', 'period'],
  async render(ctx: WidgetCtx) {
    const fetched = await ctx.fetchData();
    if (!fetched || !fetched.length) { ctx.empty('No regional reliability data for the current scope.'); return; }
    const t = ctx.theme;

    // Display ranking is worst-first (the design reads "act on rank 1 first");
    // rank chip = position in THIS display ordering, derived from the real scores.
    const rows = [...fetched].sort((a, b) => Number(a.composite_score ?? 0) - Number(b.composite_score ?? 0));

    const head = ['#', 'Region', 'Coverage', 'Coverage confidence', 'Commodity readiness', 'Composite score'];
    const body = rows.map((r, i) => {
      const comp = Number(r.composite_score ?? 0);
      const c = bandColor(comp, t);
      const rank = `<span style="display:inline-grid;place-items:center;width:22px;height:22px;border-radius:5px;
        background:${c};color:${t.paper};font-size:.72rem;font-weight:700;font-variant-numeric:tabular-nums">${i + 1}</span>`;
      return `<tr>
        <td>${rank}</td>
        <td style="font-weight:600;color:${t.ink[0]}">${regionName(String(r.region ?? ''))}</td>
        <td class="num" style="font-variant-numeric:tabular-nums;color:${t.ink[1]}">${Number(r.coverage_pct ?? 0)}%</td>
        <td class="num" style="font-variant-numeric:tabular-nums;color:${t.ink[1]}">${Number(r.coverage_confidence_pct ?? 0)}%</td>
        <td class="num" style="font-variant-numeric:tabular-nums;color:${t.ink[1]}">${Number(r.commodity_readiness_pct ?? 0)}%</td>
        <td>${barCell(comp, comp, c, t, true)}</td>
      </tr>`;
    }).join('');

    const dot = (col: string, label: string) =>
      `<span style="display:inline-flex;align-items:center;gap:.35rem;color:${t.ink[2]};font-size:.74rem">
         <span style="width:7px;height:7px;border-radius:50%;background:${col}"></span>${label}</span>`;

    ctx.el.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:.6rem">
        <span style="font-size:.72rem;color:${t.ink[3]};border:1px solid ${t.line};border-radius:999px;padding:.15rem .6rem">Pop-weighting pending</span>
      </div>
      <div class="scrollable">
        <table class="dash">
          <thead><tr>${head.map((h, i) => `<th${i === head.length - 1 ? ' style="min-width:140px"' : ''}>${h}</th>`).join('')}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <div style="display:flex;align-items:center;gap:1rem;margin-top:.7rem;padding-top:.6rem;border-top:1px solid ${t.line}">
        ${dot(t.status.alert, 'Low (&lt;60)')}
        ${dot(t.status.watch, 'Moderate (60–70)')}
        ${dot(t.status.good, 'Strong (&gt;70)')}
      </div>`;
    return () => { /* pure DOM */ };
  },
};
export default def;
