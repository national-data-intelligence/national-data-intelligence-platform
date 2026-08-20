import type { WidgetDef } from '../../runtime/types';
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { CTKpis } from '../../ct/mount';

// Migrated Supply Control Tower component, mounted as a native internal-BI widget:
// a React island inside the widget's DOM slot, disposed via the returned cleanup —
// the same lifecycle dz-region-map uses for its ECharts map.
const def: WidgetDef = {
  id: 'ct-kpis',
  frameless: true,
  render(ctx) {
    const root = createRoot(ctx.el);
    root.render(createElement(CTKpis));
    return () => { try { root.unmount(); } catch { /* idempotent */ } };
  },
};
export default def;
