/**
 * Supply Hotspots — worst regions weighted by service volume (Resource §2).
 * answers.md Q3-rm-hotspots · insight-notes: KEEP AND EXTEND — add service volume so a stockout at
 * a high-throughput region ranks above one at a quiet region (stock list → impact list).
 * Source: bi_supply + DHIS2 (service volume) + MFR.
 * DATA CONTRACT (mock: rm-hotspots.json): rank · region · composite:num · exposed_services:int ·
 *   service_volume_month:int · trend:'up'|'flat'|'down'. reactsTo: geography.
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import { regionName } from '../_shared/reference';

const kfmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));

const def: WidgetDef = {
  id: 'rm-hotspots',
  reactsTo: ['geography'],
  async render(ctx: WidgetCtx) {
    const rows = await ctx.fetchData();
    if (!rows || !rows.length) { ctx.empty('No supply hotspot rows for the selected filters.'); return; }
    const t = ctx.theme;
    const trend = (v: string): [string, string] =>
      v === 'up' ? ['↑', t.status.alert] : v === 'down' ? ['↓', t.status.good] : ['→', t.ink[3]];
    const head = ['#', 'Region', 'Composite', 'Exposed services', 'Service volume /mo', 'Trend'];
    const body = rows.map(r => {
      const [arrow, col] = trend(String(r.trend ?? 'flat'));
      return `<tr>
        <td style="color:${t.ink[3]};font-variant-numeric:tabular-nums">${r.rank ?? ''}</td>
        <td style="font-weight:600;color:${t.ink[0]}">${regionName(String(r.region ?? ''))}</td>
        <td><span style="display:inline-block;font-weight:700;font-variant-numeric:tabular-nums;color:${t.ink[1]};background:${t.navy['50']};border-radius:6px;padding:.1rem .45rem">${Number(r.composite ?? 0).toFixed(1)}</span></td>
        <td class="num" style="font-variant-numeric:tabular-nums">${Number(r.exposed_services ?? 0).toLocaleString()}</td>
        <td class="num" style="font-variant-numeric:tabular-nums">${kfmt(Number(r.service_volume_month ?? 0))}</td>
        <td style="color:${col};font-weight:700">${arrow}</td>
      </tr>`;
    }).join('');
    ctx.el.innerHTML = `
      <div class="scrollable"><table class="dash"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
    return () => { /* pure DOM */ };
  },
};
export default def;
