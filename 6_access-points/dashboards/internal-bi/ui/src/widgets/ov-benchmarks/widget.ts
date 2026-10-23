/**
 * System benchmarks — 4 high-level "how big is the system" stat cards (Overview Headline).
 * Light cards matching the existing design system (tokens/type/sprite icons); span the full
 * Headline row (4-across), each with a distinct on-palette accent icon. Rudimentary,
 * internationally-monitored MoH/Ethiopia context — placeholder numbers; the real values are
 * supplied by the wiring team.
 *
 * DATA CONTRACT (mock: ov-benchmarks.json) — one row per card:
 *   icon:sprite-id · value:str · label:str · note:str
 * reactsTo: geography · period.
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import { iconCard } from '../_shared/charts';

// Country-neutral empty-state: shown only when fetchData() returns nothing. Values
// are em-dashes rather than a specific country's figures, and labels avoid
// Ethiopia-only terms, so a profile with no benchmark data never shows Ethiopian numbers.
const DEFAULTS = [
  { icon: 'i-hospital', value: '—', label: 'Health facilities', note: 'On the master facility registry' },
  { icon: 'i-users', value: '—', label: 'Population', note: 'Catchment served' },
  { icon: 'i-map', value: '—', label: 'Regions', note: 'Administrative areas' },
  { icon: 'i-map', value: '—', label: 'Districts covered', note: 'Districts with a facility' },
];

const def: WidgetDef = {
  id: 'ov-benchmarks',
  reactsTo: ['geography'],
  frameless: true,   // tiles ARE the cards — host draws no wrapping card
  async render(ctx: WidgetCtx) {
    const rows = await ctx.fetchData();
    const cards = rows && rows.length ? rows : DEFAULTS;
    const t = ctx.theme;

    // Distinct on-palette accent per card — introduces color into the four icons.
    const accents = [t.status.info, t.status.good, t.status.watch, t.navy['600']];
    ctx.el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1rem;height:100%">
        ${cards.map((c: any, i: number) => {
          // The gateway ships icon tokens WITHOUT the sprite's `i-` prefix; normalise, falling
          // back to this card's positional default when the row omits an icon.
          const raw = String(c.icon ?? '').trim();
          const iconId = raw ? (raw.startsWith('i-') ? raw : `i-${raw}`) : DEFAULTS[i % DEFAULTS.length].icon;
          return iconCard(t, { label: String(c.label ?? ''), value: String(c.value ?? '—'), icon: iconId, color: accents[i % accents.length] });
        }).join('')}
      </div>`;
    return () => { /* pure DOM */ };
  },
};
export default def;
