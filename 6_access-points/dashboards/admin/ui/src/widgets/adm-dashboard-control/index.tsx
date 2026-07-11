/**
 * Dashboard Control (#47) — the operator cockpit over the reconciled catalog.
 *
 * Tree of dashboards → pages → sections → widget placements with enable/disable
 * toggles at every level (writes ops_perm.catalog_override via the gateway —
 * runtime state that survives every re-seed), plus the soft-orphan panel
 * (widgets whose code left the authored catalog; grants preserved until an
 * explicit purge here). Toggles SUBTRACT visibility only — grants still gate
 * first; nothing here can widen access.
 *
 * The authored catalog itself is edited as data files in the repo
 * (<dash>/catalog/*.yaml + widget.yaml next to each widget) and lands via
 * seed-app-security.sh — this page controls the RUNTIME layer on top.
 */
import { useEffect, useState } from 'react';
import * as api from '../../api/permAdmin';

function Toggle({ on, busy, onClick, title }:
                { on: boolean; busy: boolean; onClick: () => void; title: string }) {
  return (
    <button className={`btn btn-sm ${on ? 'btn-ghost' : 'btn-warn'}`} disabled={busy}
            title={title} onClick={onClick} data-on={on ? '1' : '0'}>
      {on ? 'Enabled' : 'Disabled'}
    </button>
  );
}

function DashboardControl() {
  const [tree, setTree] = useState<api.CtDashboard[]>([]);
  const [orphans, setOrphans] = useState<api.CatalogOrphan[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  async function refresh() {
    try {
      const [t, o] = await Promise.all([api.getCatalogTree(), api.listCatalogOrphans()]);
      setTree(t.dashboards); setOrphans(o); setErr('');
    } catch (e: any) { setErr(String(e?.message || e)); }
  }
  useEffect(() => { void refresh(); }, []);

  async function toggle(kind: api.CatalogOverrideIn['kind'], scope_id: string, enabled: boolean) {
    setBusy(true);
    try {
      if (enabled) {
        // re-enabling = remove the disable override entirely (keeps the table lean)
        await api.deleteCatalogOverride(kind, scope_id);
      } else {
        await api.putCatalogOverride({ kind, scope_id, enabled: false });
      }
      await refresh();
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setBusy(false); }
  }

  async function purge(id: string) {
    if (!window.confirm(`Purge orphaned widget "${id}"? Its preserved grants and placements are deleted permanently.`)) return;
    setBusy(true);
    try { await api.purgeCatalogOrphan(id); await refresh(); }
    catch (e: any) { setErr(String(e?.message || e)); }
    finally { setBusy(false); }
  }

  const flip = (k: string) => setOpen(s => ({ ...s, [k]: !s[k] }));

  return (
    <section className="card" data-testid="dashboard-control">
      <header className="card-head">
        <div>
          <h3>Dashboard Control</h3>
          <p className="muted">Runtime enable/disable over the reconciled catalog (survives re-seed;
            subtract-only — role grants still gate first). Authored structure is edited as
            catalog data files in the repo.</p>
        </div>
        <button className="btn btn-sm" onClick={() => void refresh()} disabled={busy}>Refresh</button>
      </header>
      {err && <p className="pill warn" role="alert">{err}</p>}

      {orphans.length > 0 && (
        <div className="subcard" data-testid="orphan-panel">
          <h4>Orphaned widgets ({orphans.length})</h4>
          <p className="muted">Removed from the authored catalog; hidden everywhere. Grants/placements
            are preserved — re-adding the widget revives them. Purge to delete permanently.</p>
          <table className="table">
            <thead><tr><th>Widget</th><th>Orphaned</th><th className="num">Grants</th><th className="num">Placements</th><th /></tr></thead>
            <tbody>{orphans.map(o => (
              <tr key={o.id}>
                <td><code>{o.id}</code> <span className="muted">{o.title}</span></td>
                <td>{new Date(o.orphaned_at).toLocaleString()}</td>
                <td className="num">{o.grant_count}</td>
                <td className="num">{o.placement_count}</td>
                <td><button className="btn btn-sm btn-warn" disabled={busy}
                            onClick={() => void purge(o.id)}>Purge</button></td>
              </tr>))}
            </tbody>
          </table>
        </div>
      )}

      {tree.map(d => (
        <div className="subcard" key={d.id} data-testid={`ct-dash-${d.id}`}>
          <div className="row-head">
            <button className="btn btn-sm btn-ghost" onClick={() => flip(d.id)}>{open[d.id] ? '▾' : '▸'}</button>
            <strong>{d.title}</strong> <code className="muted">{d.id}</code>
            <Toggle on={d.enabled} busy={busy} title="Enable/disable this whole dashboard"
                    onClick={() => void toggle('dashboard', d.id, !d.enabled)} />
          </div>
          {open[d.id] && d.pages.map(p => (
            <div className="indent" key={p.id} data-testid={`ct-page-${p.id}`}>
              <div className="row-head">
                <button className="btn btn-sm btn-ghost" onClick={() => flip(p.id)}>{open[p.id] ? '▾' : '▸'}</button>
                <span>{p.title}</span> <code className="muted">{p.id}</code>
                <Toggle on={p.enabled} busy={busy} title="Enable/disable this page (tab disappears)"
                        onClick={() => void toggle('page', p.id, !p.enabled)} />
              </div>
              {open[p.id] && (
                <>
                  {p.sections.map(s => (
                    <div className="indent" key={s.id}>
                      <div className="row-head">
                        <span className="muted">§</span> <span>{s.title || s.id}</span>
                        <Toggle on={s.enabled} busy={busy} title="Enable/disable this layout band (its widgets hide)"
                                onClick={() => void toggle('section', s.id, !s.enabled)} />
                      </div>
                      {s.widgets.map(w => (
                        <div className="indent row-head" key={`${p.id}:${w.id}`} data-testid={`ct-w-${p.id}-${w.id}`}>
                          <code>{w.id}</code>
                          {w.orphaned && <span className="pill warn">orphaned</span>}
                          <span className="muted">{w.kind} · {w.col_span}×{w.row_span}</span>
                          <Toggle on={w.widget_enabled} busy={busy} title="Enable/disable this widget EVERYWHERE"
                                  onClick={() => void toggle('widget', w.id, !w.widget_enabled)} />
                          <Toggle on={w.placement_enabled} busy={busy} title="Enable/disable only on THIS page"
                                  onClick={() => void toggle('placement', `${p.id}::${w.id}`, !w.placement_enabled)} />
                        </div>
                      ))}
                    </div>
                  ))}
                  {p.default_widgets.map(w => (
                    <div className="indent row-head" key={`${p.id}:${w.id}`}>
                      <code>{w.id}</code>
                      {w.orphaned && <span className="pill warn">orphaned</span>}
                      <Toggle on={w.widget_enabled} busy={busy} title="Enable/disable this widget EVERYWHERE"
                              onClick={() => void toggle('widget', w.id, !w.widget_enabled)} />
                      <Toggle on={w.placement_enabled} busy={busy} title="Enable/disable only on THIS page"
                              onClick={() => void toggle('placement', `${p.id}::${w.id}`, !w.placement_enabled)} />
                    </div>
                  ))}
                </>
              )}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

import type { AdminWidget } from '../../runtime/types';
const widget: AdminWidget = {
  id: 'adm-dashboard-control',
  Component: DashboardControl,
};
export default widget;
