/**
 * Procurement Pipeline — open purchase orders vs forecast need (Resource §5).
 * answers.md Q3-rm-pipeline · insight-notes: KEEP (if PO source real) — link pipeline arrivals to
 * forecast stockouts (will the order arrive before the shelf empties). Days vs need = ETA − need-by.
 * Guardrail G5: don't render an empty pipeline as populated.
 * Source: bi_supply / procurement source.
 * DATA CONTRACT (mock: rm-pipeline.json): po_number · commodity · destination · eta_days:int ·
 *   days_vs_need:str · status:'Arrived'|'Customs'|'In transit'|'Shipped'. reactsTo: geography.
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';

const STATUS_PILL: Record<string, string> = { Arrived: 'good', Customs: 'watch', 'In transit': 'info', Shipped: 'neutral' };

const def: WidgetDef = {
  id: 'rm-pipeline',
  reactsTo: ['geography'],
  async render(ctx: WidgetCtx) {
    const rows = await ctx.fetchData();
    if (!rows || !rows.length) { ctx.empty('No open procurement pipeline orders for the selected filters.'); return; }
    const t = ctx.theme;
    const head = ['PO number', 'Commodity', 'Destination', 'ETA', 'Days vs need', 'Status'];
    const body = rows.map(r => {
      const st = String(r.status ?? '');
      const dvn = String(r.days_vs_need ?? '');
      const dvnColor = dvn.startsWith('+') ? t.status.alert : dvn.toLowerCase().includes('on time') ? t.status.good : t.ink[1];
      return `<tr>
        <td style="font-weight:600;color:${t.navy['700']}">${r.po_number ?? '-'}</td>
        <td>${r.commodity ?? '-'}</td>
        <td style="color:${t.ink[2]}">${r.destination ?? '-'}</td>
        <td class="num" style="font-variant-numeric:tabular-nums">${Number(r.eta_days ?? 0)} days</td>
        <td style="color:${dvnColor};font-weight:600">${dvn || '-'}</td>
        <td><span class="pill ${STATUS_PILL[st] || 'neutral'}">${st || '-'}</span></td>
      </tr>`;
    }).join('');
    ctx.el.innerHTML = `
      <p style="font-size:.82rem;color:${t.ink[2]};margin:0 0 .5rem">Open purchase orders with delivery ETA linked to forecast need</p>
      <div class="scrollable" style="max-height:430px"><table class="dash"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>
      <p style="margin:.5rem 0 0;font-size:.7rem;color:${t.ink[3]}">Preview · no PO ledger in current feeds</p>`;
    return () => { /* pure DOM */ };
  },
};
export default def;
