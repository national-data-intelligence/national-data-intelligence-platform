/** Source pulse — per-source trust tiles from bi_quality.mart_data_quality.
 *  DW-unique by construction: only the warehouse sees every feed side by
 *  side. Completeness graded against the HLR §3.2.4 reporting norms
 *  (≥90 ok / 80–90 watch / <80 poor); sources without a computed metric show
 *  an honest "no metric" state, never a fabricated score. */
import type { WidgetDef } from '../../runtime/types';

const CHIP: Record<string, string> = {
  ok: 'var(--good)', watch: 'var(--watch)', poor: 'var(--alert)',
  no_metric: 'var(--ink-4, #9ca3af)',
};

// Source system → house-sprite icon (no vendor logos in the repo).
const SOURCE_ICON: [RegExp, string][] = [
  [/dhis/i, 'i-database'], [/mfr|registry/i, 'i-building'], [/emr/i, 'i-hospital'],
  [/ewars|climate|idsr/i, 'i-pulse'], [/lmis|supply/i, 'i-package'],
];

const def: WidgetDef = {
  id: 'ov-source-pulse',
  reactsTo: ['geography'],
  async render(ctx) {
    const rows = await ctx.fetchData();
    if (!rows || !rows.length) { ctx.empty('No source-quality rows in the current scope.'); return; }
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;padding:2px;';
    for (const r of rows) {
      const status = String(r.status ?? 'no_metric');
      const color = CHIP[status] ?? CHIP.no_metric;
      const compl = r.completeness_pct == null ? '—' : `${Number(r.completeness_pct).toFixed(1)}%`;
      const tile = document.createElement('div');
      // Borderless soft card (owner: cards never have borders; the status colour
      // moves from a left-accent border to a small dot).
      tile.style.cssText =
        'border-radius:12px;box-shadow:0 1px 2px rgba(15,23,42,.05),0 5px 16px rgba(15,23,42,.045);' +
        'padding:12px 14px;display:flex;flex-direction:column;gap:3px;background:var(--paper);';
      const src = String(r.source);
      const ico = SOURCE_ICON.find(([re]) => re.test(src))?.[1] ?? 'i-database';
      tile.innerHTML =
        `<span style="font-size:.86rem;font-weight:700;color:var(--ink-2,#334155);display:flex;align-items:center;gap:8px"><svg class="ico" aria-hidden="true" style="width:20px;height:20px;color:${color};flex:none"><use href="#${ico}"/></svg>${src}</span>` +
        `<span style="font-size:22px;font-weight:650;color:${status === 'no_metric' ? 'var(--ink-3,#667085)' : 'var(--ink)'};">${compl}</span>`;
      wrap.appendChild(tile);
    }
    ctx.el.appendChild(wrap);
  },
};
export default def;
