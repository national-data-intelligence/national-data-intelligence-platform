/**
 * Highest-Risk Woredas by Composite Score (Service §2, EMR-active).
 * answers.md Q3-sv-risk-woredas. risk_score = 0.40*coverage_gap + 0.35*normalized_stockout_days
 * + 0.25*(100 − reporting_completeness), normalised 0–100; High≥70 · Elevated 55–69 · Watch <55.
 * Guardrail G2: EMR-active scope stated; formula shown (not a black box).
 * DATA CONTRACT (mock: sv-risk-woredas.json): woreda · region · coverage_gap_pct · stockout_days ·
 *   reporting_completeness_pct · risk_score:int · risk_band. reactsTo: geography · programme · period.
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import { regionName } from '../_shared/reference';

const BAND_PILL: Record<string, string> = { High: 'alert', Elevated: 'watch', Watch: 'neutral' };

const def: WidgetDef = {
  id: 'sv-risk-woredas',
  reactsTo: ['geography', 'programme', 'period'],
  async render(ctx: WidgetCtx) {
    const rows = await ctx.fetchData();
    if (!rows || !rows.length) { ctx.empty('No high-risk woreda rows for the selected filters.'); return; }
    const t = ctx.theme;
    const head = ['Woreda', 'Region', 'Coverage gap', 'Stockout days', 'Reporting completeness', 'Risk score'];
    const body = rows.map(r => {
      const band = String(r.risk_band ?? '');
      return `<tr>
        <td style="font-weight:600;color:${t.ink[0]}">${r.woreda ?? '-'}</td>
        <td style="color:${t.ink[2]}">${regionName(String(r.region ?? ''))}</td>
        <td class="num" style="font-variant-numeric:tabular-nums">${Number(r.coverage_gap_pct ?? 0)}%</td>
        <td class="num" style="font-variant-numeric:tabular-nums">${Number(r.stockout_days ?? 0)}</td>
        <td class="num" style="font-variant-numeric:tabular-nums">${Number(r.reporting_completeness_pct ?? 0)}%</td>
        <td><span style="font-weight:700;font-variant-numeric:tabular-nums;margin-right:.4rem">${Number(r.risk_score ?? 0)}</span><span class="pill ${BAND_PILL[band] || 'neutral'}">${band || '-'}</span></td>
      </tr>`;
    }).join('');
    ctx.el.innerHTML = `
      <p style="font-size:.82rem;color:${t.ink[2]};margin:0 0 .2rem">EMR-active · ranked worst-first</p>
      <div class="scrollable"><table class="dash"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
    return () => { /* pure DOM */ };
  },
};
export default def;
