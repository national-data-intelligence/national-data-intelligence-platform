/**
 * Act-First Woredas — overview action queue (Overview §2).
 * Redesign target: gpt-response/01-overview-dashboard-redesign.png · answers.md Q3-ov-act-first-woredas.
 *
 * "Where disease signal meets weak readiness this week." Ranked worst-first by an action
 * score (GPT-specified): 0.45*p_alarm + 0.25*(100-readiness) + 0.20*(100-reporting_reliability)
 * + 0.10*case_growth → priority band High≥75 · Elevated 60–74 · Watch 40–59. The widget
 * RENDERS the supplied rows + priority pill; the wiring team owns the SQL (DECISIONS §F2).
 *
 * DATA CONTRACT (mock: mock-gateway/data/ov-act-first-woredas.json)
 *   grain: one row per woreda signal in the active period. columns:
 *     rank:int · woreda:str · region:str · p_alarm:int(%) · readiness_index:int ·
 *     reporting_reliability_pct:int · evidence:str · action_priority:'High'|'Elevated'|'Watch'
 *   (our real mart also emits 'Immediate'|'This week' — mapped to the same pill bands).
 * reactsTo: geography · programme · period.
 *
 * 2026-07-07 (final visual mandate): rendered as the reference-golden simple ranked
 * table — priority-banded rank chips, per-cell progress bars, priority pills, row
 * chevron. No local search/pagination (dt-standard round superseded here). The
 * "Updated 1 hour ago" footer from the reference is NOT reproduced: it is a
 * hardcoded claim with no real timestamp behind it (never fabricate data).
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import { regionName } from '../_shared/reference';

/** value + proportional track (bar) for a table cell. */
function bar(text: string, pct: number, fill: string, track: string): string {
  const w = Math.max(0, Math.min(100, pct));
  return `<div style="display:flex;align-items:center;gap:.55rem;min-width:130px">
      <span style="font-variant-numeric:tabular-nums;min-width:34px">${text}</span>
      <span style="flex:1;height:6px;border-radius:3px;background:${track};overflow:hidden">
        <span style="display:block;height:100%;width:${w}%;border-radius:3px;background:${fill}"></span>
      </span>
    </div>`;
}

/** Priority vocabulary → pill class. Reference bands (High/Elevated/Watch) plus the
 *  real mart's vocabulary (Immediate/This week) styled onto the same bands. */
const PILL: Record<string, string> = {
  High: 'alert', Immediate: 'alert',
  Elevated: 'watch', 'This week': 'watch',
  Watch: 'watch',
};

/** Rank-badge colour by action priority (mockup colours 1..N by band). */
function priColor(priority: string, t: WidgetCtx['theme']): string {
  return (priority === 'High' || priority === 'Immediate') ? t.status.alert : t.status.watch;
}

const def: WidgetDef = {
  id: 'ov-act-first-woredas',
  reactsTo: ['geography', 'programme', 'period'],
  async render(ctx: WidgetCtx) {
    const rows = await ctx.fetchData();
    if (!rows || !rows.length) { ctx.empty('No action-priority woredas for the selected filters.'); return; }
    const t = ctx.theme;

    const head = ['#', 'Woreda', 'Region', 'Signal P(alarm)', 'Readiness', 'Reporting reliability', 'Evidence (this week)', 'Action priority', ''];
    const bodyHtml = rows.map(r => {
      const pAlarm = Number(r.p_alarm ?? 0);
      const readiness = Number(r.readiness_index ?? 0);
      const relia = Number(r.reporting_reliability_pct ?? 0);
      const pri = String(r.action_priority ?? '');
      const rank = `<span style="display:inline-grid;place-items:center;width:22px;height:22px;border-radius:5px;
        background:${priColor(pri, t)};color:${t.paper};font-size:.72rem;font-weight:700;font-variant-numeric:tabular-nums">${r.rank ?? ''}</span>`;
      return `<tr style="cursor:pointer">
        <td>${rank}</td>
        <td style="font-weight:600;color:${t.ink[0]}">${r.woreda ?? '-'}</td>
        <td style="color:${t.ink[2]}">${regionName(String(r.region ?? ''))}</td>
        <td>${bar(`${pAlarm}%`, pAlarm, t.status.alert, t.navy['50'])}</td>
        <td>${bar(String(readiness), readiness, t.navy['700'], t.navy['50'])}</td>
        <td>${bar(`${relia}%`, relia, t.navy['700'], t.navy['50'])}</td>
        <td style="color:${t.ink[1]}">${r.evidence ?? '-'}</td>
        <td><span class="pill ${PILL[pri] || 'neutral'}">${pri || '-'}</span></td>
        <td style="text-align:right;color:${t.ink[3]};font-weight:600">›</td>
      </tr>`;
    }).join('');

    ctx.el.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:.6rem">
        <p style="font-size:.82rem;color:${t.ink[2]};margin:0">Where disease signal meets weak readiness this week</p>
        <button type="button" class="ov-af-link" style="flex-shrink:0;border:1px solid ${t.line};background:${t.paper};color:${t.ink[1]};
          border-radius:8px;padding:.3rem .7rem;font-size:.78rem;font-weight:600;cursor:pointer">View full action queue →</button>
      </div>
      <div class="scrollable">
        <table class="dash"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>
          <tbody>${bodyHtml}</tbody></table>
      </div>`;

    const go = () => { ctx.host.navigateToPage('disease'); ctx.host.focusWidget('dz-woreda-table'); };
    const link = ctx.el.querySelector<HTMLButtonElement>('.ov-af-link');
    if (link) link.onclick = go;
    ctx.el.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach(tr => { tr.onclick = go; });

    return () => { /* pure DOM */ };
  },
};
export default def;
