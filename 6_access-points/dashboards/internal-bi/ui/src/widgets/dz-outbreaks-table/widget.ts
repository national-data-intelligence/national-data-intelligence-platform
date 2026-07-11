/**
 * Active Outbreaks — live episode roster with response readiness (Disease §3).
 * answers.md Q3-dz-outbreaks-table · insight-notes: KEEP AND EXTEND — add a readiness column per
 * episode (are RDT/ACT/vaccine in stock in the affected woredas) so the roster carries its own
 * response context. Guardrail: episode start/close logic visible; readiness bands stated.
 * Source: bi_idsr.mart_idsr_outbreaks + Supply (readiness) + MFR.
 *
 * DATA CONTRACT (mock: dz-outbreaks-table.json) — one row per outbreak episode:
 *   id:str · disease:str · region:str · woreda:str · declared:date · days:int · total:int ·
 *   new_7d:int · cfr_pct:num · status:'Alert'|'Watch' · rrt:str · readiness:'Ready'|'Partial'|'Limited'
 *   (live mart also ships lowercase active/contained/closed — all vocabularies mapped).
 * reactsTo: geography.
 *
 * 2026-07-07 (final visual mandate): reference-golden plain roster — right-aligned
 * "Subscribe to alerts" + episode count, one table inside .scrollable (the grid
 * row_span caps the card; rows scroll INSIDE it). dt-standard round superseded.
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import { regionName } from '../_shared/reference';

// The live mart ships lowercase episode states (active/contained/closed) in
// addition to the mock contract's Alert/Watch — map ALL observed vocabularies.
const STATUS_PILL: Record<string, string> = {
  alert: 'alert', watch: 'watch', active: 'alert', contained: 'good', closed: 'neutral',
};
const READY_PILL: Record<string, string> = { ready: 'good', partial: 'watch', limited: 'alert' };

const def: WidgetDef = {
  id: 'dz-outbreaks-table',
  reactsTo: ['geography'],
  async render(ctx: WidgetCtx) {
    const rows = await ctx.fetchData();
    if (!rows || !rows.length) { ctx.empty('No active outbreaks for the selected filters.'); return; }
    const t = ctx.theme;

    const head = ['ID', 'Disease', 'Region', 'Woreda', 'Declared', 'Days', 'Total', 'New 7D', 'CFR', 'Status', 'RRT', 'Readiness'];
    const body = rows.map(r => {
      const st = String(r.status ?? ''), rd = String(r.readiness ?? '');
      return `<tr>
        <td style="font-weight:600;color:${t.navy['700']};white-space:nowrap">${r.id ?? '-'}</td>
        <td>${r.disease ?? '-'}</td>
        <td style="color:${t.ink[2]}">${regionName(String(r.region ?? ''))}</td>
        <td>${r.woreda ?? '-'}</td>
        <td style="color:${t.ink[2]};white-space:nowrap">${r.declared ?? '-'}</td>
        <td class="num" style="font-variant-numeric:tabular-nums">${Number(r.days ?? 0)}</td>
        <td class="num" style="font-variant-numeric:tabular-nums">${Number(r.total ?? 0).toLocaleString()}</td>
        <td class="num" style="font-variant-numeric:tabular-nums">${Number(r.new_7d ?? 0)}</td>
        <td class="num" style="font-variant-numeric:tabular-nums">${Number(r.cfr_pct ?? 0).toFixed(1)}%</td>
        <td><span class="pill ${STATUS_PILL[st.toLowerCase()] || 'neutral'}">${st || '-'}</span></td>
        <td style="color:${t.ink[1]}">${r.rrt ?? '-'}</td>
        <td><span class="pill ${READY_PILL[rd.toLowerCase()] || 'neutral'}">${rd || '-'}</span></td>
      </tr>`;
    }).join('');

    ctx.el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:flex-end;gap:1rem;margin-bottom:.5rem">
        <div style="display:flex;align-items:center;gap:.7rem;flex-shrink:0">
          <button type="button" class="dz-ob-sub" style="border:1px solid ${t.line};background:${t.paper};color:${t.ink[1]};border-radius:8px;padding:.3rem .7rem;font-size:.78rem;font-weight:600;cursor:pointer">Subscribe to alerts</button>
          <span style="font-size:.72rem;color:${t.ink[3]}">${rows.length.toLocaleString()} active outbreaks</span>
        </div>
      </div>
      <div class="scrollable" style="max-height:430px"><table class="dash"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
    const sub = ctx.el.querySelector<HTMLButtonElement>('.dz-ob-sub');
    if (sub) sub.onclick = () => ctx.host.openSubscribe?.('all', ctx.filters.geography);
    return () => { /* pure DOM */ };
  },
};
export default def;
