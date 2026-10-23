/**
 * System Trust · Disease Snapshot (This Week) (Overview §3, card 4 of 4).
 * answers.md Q3-ov-trust-cards. Top three current disease alerts by P(alarm).
 * DATA CONTRACT (mock: ov-disease-snapshot.json) single row:
 *   new_cases:int · alert_count:int · top_alerts: [disease:str, region:str, p_alarm:int][]
 * P(alarm) colour band: ≥70 alert · 55–69 watch · <55 neutral.
 * reactsTo: geography · programme · period.
 *
 * 2026-07-07: rebuilt on the shared statCard skeleton so its subtitle / metric /
 * caption rows fall on the SAME horizontal lines as the sibling trust cards
 * (owner defect #4 — this card previously had no headline metric at all).
 * Metric = new cases this week (real, from the row it already fetches); the
 * top-3 alert list renders in the statCard body zone.
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';

function pctColor(v: number, t: WidgetCtx['theme']): string {
  return v >= 70 ? t.status.alert : v >= 55 ? t.status.watch : t.ink[2];
}

const def: WidgetDef = {
  id: 'ov-disease-snapshot',
  reactsTo: ['geography', 'programme', 'period'],
  async render(ctx: WidgetCtx) {
    const r = (await ctx.fetchData())?.[0];
    if (!r) { ctx.empty('No disease snapshot for the selected filters.'); return; }
    const t = ctx.theme;
    // top_alerts arrives as [disease, region, p_alarm][] (mock contract) OR as the
    // real fetcher's comma-joined label string — normalise both. String entries
    // carry NO region/p_alarm; those cells stay empty (honest, never fabricated).
    const raw = r.top_alerts;
    const alerts: any[] = Array.isArray(raw)
      ? raw
      : (typeof raw === 'string' && raw.trim() && raw.trim() !== '—'
          ? raw.split(',').map((s: string) => [s.trim(), '', null]) : []);
    const clamp = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    const list = alerts.slice(0, 3).map(a => {
      const disease = a[0] ?? '-', region = a[1] ?? '', p = a[2] == null ? null : Number(a[2]);
      return `<div style="display:flex;align-items:center;gap:.5rem;height:26px;border-bottom:1px solid ${t.line}">
        <span style="font-weight:600;color:${t.ink[0]};font-size:.8rem;${clamp}">${disease}</span>
        <span style="color:${t.ink[3]};font-size:.74rem;flex:1;${clamp}">${region}</span>
        ${p == null ? '' : `<span style="font-weight:700;font-size:.78rem;font-variant-numeric:tabular-nums;color:${pctColor(p, t)}">${p}%</span>`}
      </div>`;
    }).join('');
    const alertCount = Number(r.alert_count ?? 0);
    // The fetcher sums every week on file (not the latest week), so the figure is
    // labelled as a total until the data side sends the latest week.
    ctx.el.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;gap:.55rem">
        <div style="font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:${t.ink[3]};white-space:nowrap">Total reported cases</div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:.6rem;margin-top:-.3rem">
          <div style="font-size:1.95rem;font-weight:800;letter-spacing:-.025em;color:${t.ink[0]};font-variant-numeric:tabular-nums;line-height:1.1">${Number(r.new_cases ?? 0).toLocaleString()}</div>
          ${alertCount ? `<span style="flex-shrink:0;padding:.2rem .6rem;border-radius:999px;background:var(--alert-50);color:${t.status.alert};font-size:.72rem;font-weight:700">${alertCount} alert${alertCount === 1 ? '' : 's'}</span>` : ''}
        </div>
        ${list ? `<div style="margin-top:auto">${list}</div>` : ''}
      </div>`;
    return () => { /* pure DOM */ };
  },
};
export default def;
