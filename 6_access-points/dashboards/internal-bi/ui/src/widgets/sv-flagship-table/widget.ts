/**
 * Flagship Attainment with confidence (Service §1).
 * answers.md Q3-sv-flagship-table · insight-notes: KEEP AND EXTEND — keep every official Ministry
 * indicator (G1), add coverage-CONFIDENCE (completeness + timeliness + mapping) + lineage so the
 * warehouse's value is trust context, not the number. Guardrails: only show a target where the
 * indicator really has one (G4); confidence is NOT coverage (G3).
 * Source: DHIS2 + DQ + MFR.
 *
 * DATA CONTRACT (mock: sv-flagship-table.json): indicator · programme · current_pct:int ·
 *   target_pct:int|null · status:'Good'|'Watch'|'Alert' · completeness_pct:int · timeliness_pct:int ·
 *   mapping_status · confidence_status ('High'|'Medium'|'Low'). reactsTo: geography · programme · period.
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';

const STATUS_PILL: Record<string, string> = { Good: 'good', Watch: 'watch', Alert: 'alert' };

const def: WidgetDef = {
  id: 'sv-flagship-table',
  reactsTo: ['geography', 'programme', 'period'],
  async render(ctx: WidgetCtx) {
    const rows = await ctx.fetchData();
    if (!rows || !rows.length) { ctx.empty('No flagship indicators for the selected filters.'); return; }
    const t = ctx.theme;
    const confColor: Record<string, string> = { High: t.status.good, Medium: t.status.watch, Low: t.status.alert };
    const body = rows.map(r => {
      const st = String(r.status ?? ''), conf = String(r.confidence_status ?? '');
      const tl = Number(r.timeliness_pct ?? 0);
      return `<tr>
        <td style="font-weight:600;color:${t.ink[0]}">${r.indicator ?? '-'}</td>
        <td style="color:${t.ink[2]}">${r.programme ?? '-'}</td>
        <td class="num" style="font-variant-numeric:tabular-nums">${Number(r.current_pct ?? 0)}%</td>
        <td class="num" style="font-variant-numeric:tabular-nums;color:${t.ink[3]}">${r.target_pct == null ? 'No target' : r.target_pct + '%'}</td>
        <td><span class="pill ${STATUS_PILL[st] || 'neutral'}">${st || '-'}</span></td>
        <td class="num" style="font-variant-numeric:tabular-nums">${Number(r.completeness_pct ?? 0)}%</td>
        <td><div style="display:flex;align-items:center;gap:.4rem;min-width:80px"><span style="font-variant-numeric:tabular-nums">${tl}%</span>
          <span style="flex:1;height:5px;border-radius:3px;background:${t.navy['50']};overflow:hidden"><span style="display:block;height:100%;width:${tl}%;background:${t.navy['700']}"></span></span></div></td>
        <td><span style="display:inline-flex;align-items:center;gap:.35rem;color:${t.ink[1]}"><span style="width:7px;height:7px;border-radius:50%;background:${confColor[conf] || t.ink[3]}"></span>${conf || '-'}</span></td>
      </tr>`;
    }).join('');
    ctx.el.innerHTML = `
      <p style="font-size:.82rem;color:${t.ink[2]};margin:0 0 .5rem">Official indicators with confidence and lineage</p>
      <div class="scrollable"><table class="dash">
        <thead><tr>
          <th>Indicator</th><th>Programme</th><th>Current</th><th>Target</th><th>Status</th>
          <th title="Confidence context">Completeness</th><th title="Confidence context">Timeliness</th>
          <th title="Confidence context">Confidence</th>
        </tr></thead><tbody>${body}</tbody></table></div>
      <p style="margin:.5rem 0 0;font-size:.72rem;color:${t.ink[3]}">Confidence context = data-trust, not coverage. Targets: HSTP-II flagship (blank = none set).</p>`;
    return () => { /* pure DOM */ };
  },
};
export default def;
