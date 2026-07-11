/** Decision brief — the Policy-Maker persona's morning read (HLR §2.2 /
 *  FR4.1): one cross-domain brief only the warehouse can write. Five lines,
 *  each from a different mart family (outbreak×supply, surveillance, supply,
 *  reporting trust, service cascades), severity-chipped. */
import type { WidgetDef } from '../../runtime/types';

const CHIP: Record<string, string> = {
  stockout: 'var(--alert)', critical: 'var(--alert)', tight: 'var(--watch)',
  ok: 'var(--good)', info: 'var(--info)',
};
const ICON: Record<string, string> = {
  act: '⚑', surveillance: '⚠', supply: '▣', trust: '◎', service: '↯',
};

const def: WidgetDef = {
  id: 'ov-brief',
  reactsTo: [],
  async render(ctx) {
    const rows = await ctx.fetchData();
    if (!rows || !rows.length) { ctx.empty('No brief available.'); return; }
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:10px;padding:4px 2px;';
    for (const r of rows) {
      const line = document.createElement('div');
      line.style.cssText = 'display:flex;align-items:baseline;gap:10px;font-size:14px;line-height:1.45;';
      const sev = String(r.severity ?? 'info');
      line.innerHTML =
        `<span style="color:${CHIP[sev] ?? 'var(--info)'};font-size:15px;flex:none;">${ICON[String(r.kind)] ?? '•'}</span>` +
        `<span style="flex:1;">${String(r.headline ?? '')}</span>` +
        `<span class="pill" style="flex:none;font-size:11px;padding:2px 8px;border-radius:10px;` +
        `background:color-mix(in srgb, ${CHIP[sev] ?? 'var(--info)'} 14%, transparent);` +
        `color:${CHIP[sev] ?? 'var(--info)'};">${sev}</span>`;
      wrap.appendChild(line);
    }
    ctx.el.appendChild(wrap);
  },
};
export default def;
