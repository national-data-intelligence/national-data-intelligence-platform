/**
 * Hotspot Action Queue — highest-burden woredas with response context (Disease §4).
 * answers.md Q3-dz-woreda-table · insight-notes: KEEP AND EXTEND — a hotspot list by signal alone
 * is a source-system view; add readiness + reliability so it IS the action queue (signal meets
 * thin response capacity). Guardrail: sort logic visible; NOT a "worst-managed" ranking.
 * Source: bi_idsr.mart_idsr_disease_weekly (+ml) + Supply (readiness) + DQ (reliability) + MFR.
 *
 * DATA CONTRACT (mock: dz-woreda-table.json) — one row per hotspot woreda:
 *   rank:int · woreda:str · region:str · cases_12w:int · incidence_100k:num · cfr_pct:num ·
 *   p_alarm:int(%) · readiness:'Ready'|'Partial'|'Limited' · reliability:'High'|'Medium'|'Low'
 * reactsTo: geography · programme.
 *
 * 2026-07-07 (final visual mandate): reference-golden plain ranked table (slate
 * rank chips, pills) in .scrollable — dt-standard round superseded. Region codes
 * render as full names; pill lookup stays case-insensitive for the live vocab.
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import { regionName } from '../_shared/reference';

// Lowercased lookup — live mart vocabulary may differ in case from the mock.
const READY_PILL: Record<string, string> = { ready: 'good', partial: 'watch', limited: 'alert' };
const RELIA_PILL: Record<string, string> = { high: 'good', medium: 'watch', low: 'alert' };

const def: WidgetDef = {
  id: 'dz-woreda-table',
  reactsTo: ['geography', 'programme'],
  async render(ctx: WidgetCtx) {
    const rows = await ctx.fetchData();
    if (!rows || !rows.length) { ctx.empty('No hotspot woredas for the selected filters.'); return; }
    const t = ctx.theme;

    const head = ['#', 'Woreda', 'Region', 'Cases (12w)', 'Incidence /100k', 'CFR %', 'P(alarm)', 'Readiness', 'Reliability'];
    const body = rows.map(r => {
      const p = Number(r.p_alarm ?? 0);
      const ready = String(r.readiness ?? ''), relia = String(r.reliability ?? '');
      return `<tr>
        <td><span style="display:inline-grid;place-items:center;width:20px;height:20px;border-radius:4px;background:${t.navy['50']};color:${t.ink[1]};font-size:.72rem;font-weight:700">${r.rank ?? ''}</span></td>
        <td style="font-weight:600;color:${t.ink[0]}">${r.woreda ?? '-'}</td>
        <td style="color:${t.ink[2]}">${regionName(String(r.region ?? ''))}</td>
        <td class="num" style="font-variant-numeric:tabular-nums">${Number(r.cases_12w ?? 0).toLocaleString()}</td>
        <td class="num" style="font-variant-numeric:tabular-nums">${Number(r.incidence_100k ?? 0)}</td>
        <td class="num" style="font-variant-numeric:tabular-nums">${Number(r.cfr_pct ?? 0).toFixed(1)}%</td>
        <td class="num" style="font-variant-numeric:tabular-nums;font-weight:600">${p}%</td>
        <td><span class="pill ${READY_PILL[ready.toLowerCase()] || 'neutral'}">${ready || '-'}</span></td>
        <td><span class="pill ${RELIA_PILL[relia.toLowerCase()] || 'neutral'}">${relia || '-'}</span></td>
      </tr>`;
    }).join('');

    ctx.el.innerHTML = `
      <p style="font-size:.82rem;color:${t.ink[2]};margin:0 0 .5rem">Highest-burden woredas · last 12 weeks</p>
      <div class="scrollable" style="max-height:430px"><table class="dash"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
    return () => { /* pure DOM */ };
  },
};
export default def;
