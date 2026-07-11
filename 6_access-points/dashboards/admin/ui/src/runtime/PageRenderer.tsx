/**
 * Admin dashboard · page renderer.
 *
 * Renders the ACTIVE page's widgets FROM THE CALLER'S RESOLVED CATALOG SPEC
 * (same useDashboardSpec module-cache the Sidebar boots — one network fetch).
 * One catalog widget id = one registry module (owner catalog-collapse
 * 2026-07-07; the interim claims/dedupe scheme is retired). The emitted DOM is
 * identical to the old hand-written `{active === 'x' && <X/>}` App.tsx — one
 * organism per page inside `.admin-pageframe`, no extra wrappers.
 *
 * Spec not usable (first-paint loading, network failure, or denied)?
 * → FALLBACK_PAGE_WIDGETS (the full catalog composition), because the
 * pre-migration admin rendered pages regardless of the spec; see pages.ts.
 *
 * An id no module owns renders a VISIBLE placeholder (never a silent gap) —
 * same never-silently-drop rule as the public dashboard's WidgetSlot.
 */
import type { AdminHost } from './types';
import { FALLBACK_PAGE_WIDGETS } from './pages';
import { getWidget, registeredIds } from './registry';
import { useDashboardSpec } from '../api/spec';

function MissingWidget({ id }: { id: string }) {
  return (
    <div
      role="alert"
      style={{
        margin: '1rem',
        padding: '1rem 1.25rem',
        border: '2px dashed #b3261e',
        borderRadius: 8,
        background: '#fdecea',
        color: '#8c1d18',
        fontFamily: 'monospace',
        fontSize: '0.85rem',
      }}
    >
      no renderer for <strong>{id}</strong>
      <br />
      registered: {registeredIds().join(', ') || '(none)'}
    </div>
  );
}

export default function PageRenderer({ host }: { host: AdminHost }) {
  const { spec, loaded } = useDashboardSpec('admin');

  // Granted widget ids for the active page, in catalog order. Strictly
  // spec-driven once the spec is loaded; full static composition otherwise.
  const ids: string[] = (loaded && spec)
    ? (spec.pages.find(p => p.id === `admin/${host.active}`)?.widgets.map(w => w.id) ?? [])
    : (FALLBACK_PAGE_WIDGETS[host.active] ?? []);

  return (
    <>
      {ids.map(id => {
        const widget = getWidget(id);
        return widget
          ? <widget.Component key={id} host={host} />
          : <MissingWidget key={id} id={id} />;
      })}
    </>
  );
}
