/**
 * Facility Data-Trust Signals (Service §3) — lowest DHIS2↔EMR agreement.
 * answers.md Q3-sv-data-trust-table · insight-notes: sv-compliance REPLACE — the headline warehouse
 * capability (reported-vs-recorded). expected = DHIS2 reported; actual = EMR recorded; agreement =
 * min/max*100; severity Alert<75 · Watch 75–89 · Review 90–94 · Agree ≥95. Guardrail G2: EMR-active,
 * framed as a data-trust signal not an accusation. Source: EMR + DHIS2 + MFR.
 * DATA CONTRACT (mock: sv-data-trust-table.json): facility · indicator · agreement_ratio_pct ·
 *   expected_dhis2:int · actual_emr:int · difference:int · severity. reactsTo: geography · programme · period.
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';

const SEV_PILL: Record<string, string> = { Alert: 'alert', Watch: 'watch', Review: 'info', Agree: 'good' };

const def: WidgetDef = {
  id: 'sv-data-trust-table',
  reactsTo: ['geography', 'programme', 'period'],
  async render(ctx: WidgetCtx) {
    const rows = await ctx.fetchData();
    if (!rows || !rows.length) { ctx.empty('No reported-vs-recorded discrepancy rows for the selected filters.'); return; }
    const t = ctx.theme;
    const head = ['Facility', 'Indicator', 'Agreement ratio', 'Expected (DHIS2)', 'Actual (EMR)', 'Difference', 'Severity'];
    const body = rows.map(r => {
      const sev = String(r.severity ?? ''), diff = Number(r.difference ?? 0);
      return `<tr>
        <td style="font-weight:600;color:${t.navy['700']}">${r.facility ?? '-'}</td>
        <td>${r.indicator ?? '-'}</td>
        <td class="num" style="font-variant-numeric:tabular-nums">${Number(r.agreement_ratio_pct ?? 0)}%</td>
        <td class="num" style="font-variant-numeric:tabular-nums">${Number(r.expected_dhis2 ?? 0).toLocaleString()}</td>
        <td class="num" style="font-variant-numeric:tabular-nums">${Number(r.actual_emr ?? 0).toLocaleString()}</td>
        <td class="num" style="font-variant-numeric:tabular-nums;color:${diff < 0 ? t.status.alert : t.ink[1]}">${diff > 0 ? '+' : ''}${diff}</td>
        <td><span class="pill ${SEV_PILL[sev] || 'neutral'}">${sev || '-'}</span></td>
      </tr>`;
    }).join('');
    ctx.el.innerHTML = `
      <p style="font-size:.82rem;color:${t.ink[2]};margin:0 0 .5rem">DHIS2 vs EMR disagreement · EMR-active only</p>
      <div class="scrollable"><table class="dash"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
    return () => { /* pure DOM */ };
  },
};
export default def;
