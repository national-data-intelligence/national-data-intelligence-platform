import type { WidgetDef } from '../../runtime/types';
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { CTFilters } from '../../ct/mount';
import { NODES, ensurePlanLoaded } from '../../ct/data/runtime';
import { setSlice } from '../../ct/store';

// Migrated Supply Control Tower component, mounted as a native internal-BI widget:
// a React island inside the widget's DOM slot, disposed via the returned cleanup —
// the same lifecycle dz-region-map uses for its ECharts map.
// The page's global region filter narrows the Control Tower like its own Region
// filter does: the bus carries region CODES, the Control Tower slices by region NAME.
function applyGeography(code: string | undefined): void {
  if (!code || code === 'all') { setSlice({ region: 'all' }); return; }
  const node = NODES.find(n => n.regionId === code);
  if (node) setSlice({ region: node.region });
}

const def: WidgetDef = {
  id: 'ct-filters',
  frameless: true,
  reactsTo: ['geography'],
  render(ctx) {
    const root = createRoot(ctx.el);
    root.render(createElement(CTFilters));
    ensurePlanLoaded().then(() => applyGeography(ctx.filters.geography));
    const off = ctx.bus.subscribe(['geography'], s => applyGeography(s.geography));
    return () => { off(); try { root.unmount(); } catch { /* idempotent */ } };
  },
};
export default def;
