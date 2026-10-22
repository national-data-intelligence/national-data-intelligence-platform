/**
 * Commodity status cards + Facility Integrity (Resource §1).
 * answers.md Q3-rm-statboard. Four supply-readiness stat cards (Drugs & Supplies, Availability,
 * Stockout Rate, Inventory Value at Risk) plus a Facility Integrity strip (mapping coverage,
 * unmapped, active-but-silent) — the integrity strip promotes rm-facilities' latent value
 * (insight-notes TRANSFORM) and replaces the source-less workforce/equipment vanity cards.
 * Guardrail: silent ≠ closed; unmapped ≠ nonexistent (labelled).
 * Source: bi_supply.mart_resource_allocation + MFR/DQ (integrity).
 *
 * DATA CONTRACT (mock: rm-statboard.json) — rows keyed by `kind`:
 *   kind='stat': label · value:num · unit:'percent'|'etb-m' · target:str · delta_text:str ·
 *                delta_good:bool · spark:int[]
 *   kind='integrity': label · value:num · unit:'percent'|'count'
 * reactsTo: geography · period · commodity.
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import { iconCard } from '../_shared/charts';
import { moneyM } from '../_shared/reference';

const fmt = (v: number, unit: string) =>
  unit === 'percent' ? `${v}%` : unit === 'etb-m' ? moneyM(v)
  : unit === 'months' ? `${v} mo` : Number(v).toLocaleString();

const def: WidgetDef = {
  id: 'rm-statboard',
  reactsTo: ['geography', 'period', 'commodity'],
  async render(ctx: WidgetCtx) {
    const rows = await ctx.fetchData();
    if (!rows || !rows.length) { ctx.empty('No resource statboard data for the selected filters.'); return; }
    const t = ctx.theme;
    // Mock contract keys stat tiles kind='stat'; the live fetcher emits one kind
    // PER METRIC (availability/mos/stockout/…). Treat every non-integrity row as
    // a stat tile so both vocabularies render.
    const stats = rows.filter(r => r.kind !== 'integrity');
    const integ = rows.filter(r => r.kind === 'integrity');

    const ICON: [RegExp, string, string][] = [
      [/availab/i, 'i-check-circle', t.status.good], [/month/i, 'i-calendar', t.status.info],
      [/stock(ed)? ?out/i, 'i-alert', t.status.alert], [/wastage/i, 'i-package', t.status.watch],
    ];
    const card = (r: any) => {
      const hit = ICON.find(([re]) => re.test(String(r.label ?? '')));
      return iconCard(t, { label: String(r.label ?? ''), value: fmt(Number(r.value ?? 0), String(r.unit ?? '')), icon: hit?.[1] ?? 'i-chart-bar', color: hit?.[2] });
    };

    ctx.el.style.cssText = 'display:flex;flex-direction:column;height:100%';
    ctx.el.innerHTML = `
      <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:1fr;gap:.8rem">${stats.map(card).join('')}</div>
      ${integ.length ? `<div style="margin-top:.8rem;padding-top:.7rem;border-top:1px solid ${t.line}">
        <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:${t.ink[3]};margin-bottom:.5rem">Facility Integrity</div>
        <div style="display:flex;gap:1.4rem">
          ${integ.map(r => `<div>
            <div style="font-size:1.15rem;font-weight:800;color:${t.ink[0]};font-variant-numeric:tabular-nums">${fmt(Number(r.value ?? 0), String(r.unit ?? 'count'))}</div>
            <div style="font-size:.72rem;color:${t.ink[3]}">${r.label}</div></div>`).join('')}
        </div>
      </div>` : ''}`;
    return () => { /* pure DOM */ };
  },
};
export default def;
