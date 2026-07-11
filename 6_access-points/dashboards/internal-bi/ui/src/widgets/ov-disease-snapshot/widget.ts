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
import { statCard } from '../_shared/charts';

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
    return statCard(ctx.el, {
      subtitle: 'New cases reported this week',
      value: Number(r.new_cases ?? 0).toLocaleString(),
      note: `${alertCount} model alert${alertCount === 1 ? '' : 's'} · top 3 by P(alarm)`,
      body: list,
    }, t);
  },
};
export default def;
