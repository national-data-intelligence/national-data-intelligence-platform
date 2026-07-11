/**
 * Public dashboard · page renderer.
 *
 * Given the active page, render its `fullBleed` widgets bare, then wrap its
 * `content` widgets in the single `<div className="pub-content">` the friend's
 * CSS targets — DOM-identical to the old hand-written App.tsx so every existing
 * rule in base.css / home.css still applies. Widgets are looked up by id in the
 * registry; an unknown id renders a VISIBLE placeholder (never silently drops a
 * section — a missing renderer must be obvious in the page, not a blank gap).
 */
import type { PublicHost } from './types';
import { PAGES } from './pages';
import { getWidget, registeredIds } from './registry';

/**
 * Render a single widget by id, or a VISIBLE placeholder if the id isn't in the
 * registry. Exported so chrome (GovBar/Footer) and modals go through the same
 * never-silently-drop path as page content.
 */
export function WidgetSlot({ id, host }: { id: string; host: PublicHost }) {
  const widget = getWidget(id);
  if (!widget) {
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
  const Component = widget.Component;
  return <Component host={host} />;
}

export default function PageRenderer({ host }: { host: PublicHost }) {
  const spec = PAGES[host.active];
  const fullBleed = spec?.fullBleed ?? [];
  const content = spec?.content ?? [];

  return (
    <>
      {fullBleed.map((id) => (
        <WidgetSlot key={id} id={id} host={host} />
      ))}
      {content.length > 0 && (
        <div className="pub-content">
          {content.map((id) => (
            <WidgetSlot key={id} id={id} host={host} />
          ))}
        </div>
      )}
    </>
  );
}
