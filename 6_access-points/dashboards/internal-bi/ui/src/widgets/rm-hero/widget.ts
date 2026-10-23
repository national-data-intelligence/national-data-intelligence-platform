/**
 * Stockout Watch — headline hero (Resource §1).
 * answers.md Q3-rm-hero · insight-notes: KEEP AND EXTEND — the AMC-based stockout count is real
 * warehouse output; add a secondary read (services exposed behind the stockouts) so the headline
 * is IMPACT, not just inventory. Guardrail G6: no population-impact claim until a denominator lands
 * (we show services exposed via DHIS2 volume, NOT population).
 * Source: bi_supply.mart_resource_allocation/stockout_forecast (+ DHIS2 service volume + MFR).
 *
 * DATA CONTRACT (mock: rm-hero.json) — single row:
 *   commodities_at_risk:int · commodity_region_pairs:int · already_stockout:int ·
 *   value_at_risk_etb:num · services_exposed:int · estimated_service_disruption:int ·
 *   urgent_items:str ("name|days;name|days;…")
 * reactsTo: geography · period · commodity.
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import { iconCard } from '../_shared/charts';

const def: WidgetDef = {
  id: 'rm-hero',
  reactsTo: ['geography', 'period', 'commodity'],
  async render(ctx: WidgetCtx) {
    const r = (await ctx.fetchData())?.[0];
    if (!r) { ctx.empty('No stockout headline data for the selected filters.'); return; }
    const t = ctx.theme;
    // Shared card DNA — copied from the Overview Headline stat cards (ov-benchmarks) so these read
    // as the same, considered system: paper surface, soft shadow, radius 16, even 1rem 1.1rem padding.
    // Borderless (owner rule: cards never have borders) — the soft shadow carries the elevation.
    const tint = (hex: string, a: number) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return hex;
      const n = parseInt(m[1], 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    };
    const pill = `<span style="display:inline-flex;align-items:center;gap:.3rem;align-self:flex-start;padding:.15rem .5rem;border-radius:999px;background:${tint(t.status.alert, 0.10)};color:${t.status.alert};font-size:.7rem;font-weight:700">
      <span style="width:.4rem;height:.4rem;border-radius:50%;background:currentColor"></span>${Number(r.already_stockout ?? 0)} already in stockout</span>`;
    ctx.el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:auto 1fr;gap:1rem;height:100%">
        <div style="grid-column:1 / -1">${iconCard(t, { label: 'Commodities at risk of stockout', value: String(Number(r.commodities_at_risk ?? 0)), icon: 'i-package', color: t.status.watch, extra: pill, big: true })}</div>
        ${iconCard(t, { label: 'Services exposed', value: Number(r.services_exposed ?? 0).toLocaleString(), icon: 'i-users', color: t.status.info })}
        ${iconCard(t, { label: 'Est. service disruption', value: Number(r.estimated_service_disruption ?? 0).toLocaleString(), icon: 'i-alert', color: t.status.alert })}
      </div>`;
    return () => { /* pure DOM */ };
  },
};
export default def;
