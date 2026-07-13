/** ws-help-tools — analysis tools opened with the existing SSO session
 *  (Tool-SSO, moh-staff side). Ported from the bespoke Tools.tsx: dbt Docs is
 *  a real SSO link (seeded in both realms, admitted off the shared Keycloak
 *  cookie); Superset stays an honest "coming soon" — never a dead link. */
import type { WidgetDef } from '../../runtime/types';
import { esc } from '../_shared/helpers';

const REALM = 'moh-staff';

type Tool = {
  id: string; name: string; ico: string; cat: string; desc: string;
  url?: string; auth?: string; ready: boolean;
  // Roles allowed to USE the tool — the button is HIDDEN for any other role
  // (owner external-tool SSO spec req 2). MUST mirror the tool-gate's
  // ALLOWED_ROLES so a shown button never lands on the gate's 403 page.
  // Omitted ⇒ visible to everyone who can see this page.
  roles?: string[];
};

/** Current user's R-* roles, decoded from the access token already on window
 *  (no extra fetch). Empty when unauthenticated (shell covers the app anyway). */
function currentRoles(): string[] {
  try {
    const t = (window as any).__nhdwAccessToken as string | undefined;
    if (!t) return [];
    const payload = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    const rr = (payload.realm_access?.roles ?? []) as string[];
    const flat = (payload.roles ?? []) as string[];
    return [...new Set([...rr, ...flat])].filter(r => r.startsWith('R-'));
  } catch { return []; }
}

const TOOLS: Tool[] = [
  {
    id: 'dbt-docs', name: 'dbt Docs', ico: 'i-database', cat: 'Data catalog & lineage',
    desc: 'Every published mart and its lineage back to source — column docs, tests and the compiled DAG, so you know exactly what a field means before you model on it.',
    url: `https://dbt-docs.127.0.0.1.nip.io/?realm=${REALM}`, auth: 'OIDC · Keycloak', ready: true,
    roles: ['R-CONS-ANA', 'R-CONS-RES', 'R-CONS-SCI', 'R-STEW', 'R-OPS-ADM', 'R-OPS-ENG', 'R-OPS-SEC', 'R-SUPER'],
  },
  {
    id: 'mlflow', name: 'MLflow', ico: 'i-cpu', cat: 'Model registry & experiments',
    desc: 'The experiment tracking and model registry behind the workshop — runs, metrics, artifacts and the @champion aliases the batch-inference DAG serves from.',
    // enters via the tool-gate sign-in leg so the existing SSO session admits
    // silently and lands on the MLflow home; role enforced at the gate too.
    url: `https://mlflow.127.0.0.1.nip.io/oauth2gate/login?realm=${REALM}&rd=/`,
    auth: 'OIDC · Keycloak', ready: true,
    roles: ['R-CONS-SCI', 'R-CONS-RES', 'R-CONS-ANA', 'R-OPS-ADM', 'R-SUPER'],
  },
  {
    id: 'superset', name: 'Superset', ico: 'i-chart-bar', cat: 'Self-service BI',
    desc: 'Ad-hoc SQL exploration and no-code chart/dashboard building over the governed marts (via Trino) — the analyst’s companion to the curated BI dashboards.',
    // Native FAB Keycloak OIDC (moh-staff): /login/keycloak initiates the flow
    // and admits silently off the shared session. Role-gated to the mapped
    // analyst set (mirrors superset_config.py AUTH_ROLES_MAPPING) so a shown
    // tile never lands a user in the empty Public role.
    url: 'https://superset.127.0.0.1.nip.io/login/keycloak',
    auth: 'OIDC · Keycloak', ready: true,
    roles: ['R-CONS-ANA', 'R-CONS-SCI', 'R-CONS-RES', 'R-DEC', 'R-STEW', 'R-SUPER'],
  },
];

const def: WidgetDef = {
  id: 'ws-help-tools',
  reactsTo: [],
  render(ctx) {
    // Req 2 — hide the button for any role not permitted the tool (mirrors the
    // gate's ALLOWED_ROLES). A tool with no `roles` is visible to everyone here.
    const mine = currentRoles();
    const visible = TOOLS.filter(t => !t.roles || t.roles.some(r => mine.includes(r)));
    ctx.el.innerHTML = `
      <p class="page-lede" style="margin-bottom:1rem">
        Analysis tools opened with your existing session — <strong>no second
        login</strong>. Each runs its own Keycloak sign-in and is admitted
        silently off the shared SSO cookie (you are in the
        <code>${esc(REALM)}</code> realm).</p>
      <div style="display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
        ${visible.map(t => `
          <div class="card card-elev" style="display:flex;flex-direction:column;opacity:${t.ready ? 1 : 0.72}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.6rem">
              <div style="display:flex;gap:.7rem;align-items:center;min-width:0">
                <span aria-hidden="true"
                  style="display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:10px;background:rgba(23,49,110,0.10);flex-shrink:0">
                  <svg class="ico"><use href="#${esc(t.ico)}"/></svg>
                </span>
                <div style="min-width:0">
                  <h4 style="margin:0">${esc(t.name)}</h4>
                  <span class="text-xs muted">${esc(t.cat)}</span>
                </div>
              </div>
              ${t.ready ? '<span class="pill good">SSO</span>' : '<span class="pill neutral">v2</span>'}
            </div>
            <p class="text-sm muted" style="flex:1;margin:.55rem 0 .9rem">${esc(t.desc)}</p>
            ${t.ready ? `
              <div style="display:flex;align-items:center;justify-content:space-between;gap:.6rem">
                <span class="text-xs muted">${esc(t.auth || '')}</span>
                <a class="btn btn-sm btn-primary" href="${esc(t.url!)}" target="_blank" rel="noreferrer">
                  Open <svg class="ico ico-sm"><use href="#i-external"/></svg></a>
              </div>` : `
              <div style="display:flex;align-items:center;justify-content:space-between;gap:.6rem">
                <span class="text-xs muted">Planned for v2</span>
                <button class="btn btn-sm btn-ghost" disabled aria-disabled="true">Coming soon</button>
              </div>`}
          </div>`).join('')}
      </div>`;
  },
};
export default def;
