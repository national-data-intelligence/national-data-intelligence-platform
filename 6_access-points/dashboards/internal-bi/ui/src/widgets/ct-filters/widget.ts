import type { WidgetDef } from '../../runtime/types';
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { CTFilters } from '../../ct/mount';
import { ensurePlanLoaded } from '../../ct/data/runtime';

// Migrated Supply Control Tower component, mounted as a native internal-BI widget:
// a React island inside the widget's DOM slot, disposed via the returned cleanup —
// the same lifecycle dz-region-map uses for its ECharts map.
const def: WidgetDef = {
  id: 'ct-filters',
  frameless: true,
  render(ctx) {
    const root = createRoot(ctx.el);
    root.render(createElement(CTFilters));
    ensurePlanLoaded();
    return () => { try { root.unmount(); } catch { /* idempotent */ } };
  },
};
export default def;
