/**
 * Admin sidebar. Source: _mockups/03-infra-admin.html L838-869.
 *
 * Owner consolidation 2026-07-06 — nav mirrors the ops_perm page catalog:
 *   Infrastructure  Health & topology · Audit logs · Alert routing
 *   Data            Quality & lineage (40) · Models (42) · Review Queue (45)
 *   System & Access Users and Access (60) · Roles and Permissions (70) ·
 *                   SSO & identity (80) · Environment (100) · Documentation
 * The dedicated "Operator tools" page was dissolved — each tool is now
 * deep-linked where it is contextually relevant (topology → Headlamp,
 * Quality & Lineage → dbt Docs/MinIO/Airflow, Models → MLflow) with the
 * full reference strip on the Documentation page.
 *
 * Catalog-gated items: "Models" (admin/ml-health), "Review Queue"
 * (admin/review) and "Documentation" (admin/documentation) appear ONLY when
 * the caller's resolved dashboard spec grants that page's widget
 * (adm-models-datasets / adm-documentation) — the grant comes
 * from ops_perm role_widget rows, never a hardcoded role list here.
 * Labels come from the catalog page titles.
 */
import { useAdminApp } from '../useAdminApp';
import { useDashboardSpec, specAllowsWidget, specPageTitle } from '../api/spec';

type NavItem = { id: string; ico: string; title: string; badge?: boolean };

const ITEMS: Array<{ group: string; items: NavItem[] }> = [
  { group: 'Infrastructure', items: [
    { id: 'infra',   ico: 'i-tools',         title: 'Health & topology' },
    { id: 'alerts',  ico: 'i-bell',          title: 'Alert routing' },
  ]},
  { group: 'Data', items: [
    { id: 'dq',      ico: 'i-shield-check',  title: 'Quality & lineage' },
  ]},
  { group: 'Identity and Access', items: [
    { id: 'users-access',      ico: 'i-users',    title: 'Users and Access', badge: true },
    { id: 'roles-permissions', ico: 'i-policy',   title: 'Roles and Permissions' },
    { id: 'sso',               ico: 'i-lock',     title: 'SSO & identity' },
  ]},
];

/** Insert `item` into `items` right after the entry with id `afterId`
 *  (append if the anchor is somehow missing). */
function insertAfter(items: NavItem[], afterId: string, item: NavItem): NavItem[] {
  const i = items.findIndex(it => it.id === afterId);
  if (i === -1) return [...items, item];
  return [...items.slice(0, i + 1), item, ...items.slice(i + 1)];
}

export default function Sidebar() {
  const { state, setActive } = useAdminApp();
  // Resolved permission catalog for THIS caller: pages arrive with their
  // widget lists already grant-filtered by the gateway.
  const { spec } = useDashboardSpec('admin');

  // Build the nav: static items + catalog-gated additions in their
  // catalog-ordained slots.
  const groups = ITEMS.map(g => {
    let items = g.items;
    if (g.group === 'Infrastructure') {
      // #47 Dashboard Control — catalog-gated like models-datasets: shown only
      // when the caller's spec grants the widget (manage_catalog roles).
      if (specAllowsWidget(spec, 'admin/dashboard-control', 'adm-dashboard-control')) {
        items = insertAfter(items, 'infra', {
          id: 'dashboard-control', ico: 'i-tools',
          title: specPageTitle(spec, 'admin/dashboard-control', 'Dashboard Control'),
        });
      }
    }
    if (g.group === 'Data') {
      // Owner 2026-07-07: the former Models (ml-health) + Review Queue (review)
      // pages are MERGED into one "Models and datasets" page — since the
      // catalog-collapse it carries ONE widget (adm-models-datasets); show the
      // nav item when that widget is granted. Catalog order: dq (40) → this (42).
      if (specAllowsWidget(spec, 'admin/models-datasets', 'adm-models-datasets')) {
        items = insertAfter(items, 'dq', {
          id: 'models-datasets', ico: 'i-pulse',
          title: specPageTitle(spec, 'admin/models-datasets', 'Models and datasets'),
        });
      }
      // MDM stewardship — catalog-gated (stewards + ops admins). Inserted
      // after 'dq' LAST so the final order matches the catalog:
      // dq (40) → mdm (41) → models-datasets (42).
      if (specAllowsWidget(spec, 'admin/mdm', 'adm-mdm-review')) {
        items = insertAfter(items, 'dq', {
          id: 'mdm', ico: 'i-check-circle',
          title: specPageTitle(spec, 'admin/mdm', 'MDM Stewardship'),
        });
      }
    }
    return { group: g.group, items };
  });

  // Documentation is pinned to the VERY BOTTOM of the sidebar (owner 2026-07-07),
  // separated from the groups — catalog-gated on adm-documentation like before.
  const showDocs = specAllowsWidget(spec, 'admin/documentation', 'adm-documentation');
  const docsTitle = specPageTitle(spec, 'admin/documentation', 'Documentation');

  return (
    <aside className="admin-side">
      <div className="admin-sidehead">
        <a href="/" title="Back to public site">
          <img className="sidehead-logo" src="/static/assets/logo-fmoh.png" alt="" />
          <span className="sidehead-text">
            <span className="title">NHDW</span>
            <span className="subtitle">Admin console</span>
          </span>
        </a>
      </div>

      {groups.map(g => (
        <div key={g.group}>
          <h6>{g.group}</h6>
          {g.items.map(it => (
            <a key={it.id} className={state.active === it.id ? 'active' : undefined} onClick={() => setActive(it.id)}>
              <svg className="ico"><use href={'#' + it.ico} /></svg> {it.title}
              {it.badge && <span className="badge">{state.pendingRequestCount}</span>}
            </a>
          ))}
        </div>
      ))}

      {showDocs && (
        <div className="admin-side-bottom">
          <a className={state.active === 'documentation' ? 'active' : undefined} onClick={() => setActive('documentation')}>
            <svg className="ico"><use href="#i-book" /></svg> {docsTitle}
          </a>
        </div>
      )}
    </aside>
  );
}
