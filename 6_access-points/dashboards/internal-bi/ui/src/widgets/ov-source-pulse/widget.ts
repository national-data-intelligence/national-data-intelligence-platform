/** Source pulse — per-source trust tiles from bi_quality.mart_data_quality.
 *  DW-unique by construction: only the warehouse sees every feed side by
 *  side. Completeness graded against the HLR §3.2.4 reporting norms
 *  (≥90 ok / 80–90 watch / <80 poor); sources without a computed metric show
 *  an honest "no metric" state, never a fabricated score. */
import type { WidgetDef } from '../../runtime/types';
import { iconCard } from '../_shared/charts';


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
      const t = ctx.theme;
      const color = status === 'ok' ? t.status.good : status === 'watch' ? t.status.watch
        : status === 'poor' ? t.status.alert : t.navy['500'];
      const compl = r.completeness_pct == null ? '—' : `${Number(r.completeness_pct).toFixed(1)}%`;
      const src = String(r.source);
      const ico = SOURCE_ICON.find(([re]) => re.test(src))?.[1] ?? 'i-database';
      const tile = document.createElement('div');
      tile.innerHTML = iconCard(ctx.theme, { label: src, value: compl, icon: ico, color });
      wrap.appendChild(tile);
    }
    ctx.el.appendChild(wrap);
  },
};
export default def;
