/**
 * Order Next — recommended reorder queue (Resource §5).
 * answers.md Q3-rm-order-next · insight-notes: KEEP — a reorder queue from AMC + days-to-stockout is
 * real warehouse output. Urgency P1 ≤14d · P2 15–30d · P3 >30d; suggested order from target stock −
 * SOH + lead-time buffer. Guardrail: show lead-time + AMC assumptions behind each suggestion.
 * Source: bi_supply.mart_resource_allocation/stockout_forecast (+ DHIS2 for impact weighting).
 *
 * DATA CONTRACT (mock: rm-order-next.json): commodity · days_left:int · national_coverage_pct:int ·
 *   regions_covered:str · suggested_order:str · estimated_cost_etb:num · lead_time_days:int ·
 *   lead_time_source:str · urgency:str · action:str. reactsTo: geography.
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';

const etb = (n: number) => (n >= 1e6 ? `ETB ${(n / 1e6).toFixed(1)}M` : `ETB ${Math.round(n / 1e3)}K`);
const URG_PILL: Record<string, string> = { 'P1 critical': 'alert', 'P2 urgent': 'watch', 'P3 watch': 'neutral' };

const def: WidgetDef = {
  id: 'rm-order-next',
  reactsTo: ['geography'],
  async render(ctx: WidgetCtx) {
    const rows = await ctx.fetchData();
    if (!rows || !rows.length) { ctx.empty('No reorder recommendations for the selected filters.'); return; }
    const t = ctx.theme;
    const head = ['Commodity', 'Days left', 'National coverage', 'Suggested order', 'Est. cost', 'Lead time', 'Urgency', 'Action'];
    const body = rows.map(r => {
      const urg = String(r.urgency ?? '');
      return `<tr>
        <td style="font-weight:600;color:${t.ink[0]}">${r.commodity ?? '-'}</td>
        <td class="num" style="font-variant-numeric:tabular-nums;font-weight:700;color:${Number(r.days_left ?? 99) <= 14 ? t.status.alert : t.ink[1]}">${Number(r.days_left ?? 0)}</td>
        <td style="color:${t.ink[1]}">${Number(r.national_coverage_pct ?? 0)}%${r.regions_covered ? ` <span style="color:${t.ink[3]}">(${r.regions_covered})</span>` : ''}</td>
        <td style="font-variant-numeric:tabular-nums">${r.suggested_order ?? '-'}</td>
        <td class="num" style="font-variant-numeric:tabular-nums">${etb(Number(r.estimated_cost_etb ?? 0))}</td>
        <td style="color:${t.ink[1]}">${Number(r.lead_time_days ?? 0)} days <span style="color:${t.ink[3]}">${r.lead_time_source ?? ''}</span></td>
        <td><span class="pill ${URG_PILL[urg] || 'neutral'}">${urg || '-'}</span></td>
        <td><button type="button" class="rm-po-btn" style="border:1px solid ${t.line};background:${t.paper};color:${t.ink[1]};border-radius:8px;padding:.25rem .6rem;font-size:.76rem;font-weight:600;cursor:pointer">Raise PO</button></td>
      </tr>`;
    }).join('');
    ctx.el.innerHTML = `
      <p style="font-size:.82rem;color:${t.ink[2]};margin:0 0 .5rem">Suggested reorder quantities ranked by stockout urgency</p>
      <div class="scrollable"><table class="dash"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
    // "Raise PO" is not wired to procurement writes in this build (answers Q2D.11) — inform, don't fake.
    ctx.el.querySelectorAll<HTMLButtonElement>('.rm-po-btn').forEach(b => {
      b.title = 'PO creation is not enabled in this environment';
    });
    return () => { /* pure DOM */ };
  },
};
export default def;
