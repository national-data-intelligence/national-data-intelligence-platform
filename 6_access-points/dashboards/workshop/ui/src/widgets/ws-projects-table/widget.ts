/** ws-projects-table — the projects catalogue (My / Group / Public grouping).
 *
 *   GET /gw/projects?scope=all — projects VISIBLE to the caller (own ∪ public
 *   ∪ group-shared); the gateway's visibility clause scopes the payload, so
 *   another user's private project never reaches this widget.
 *
 * Ported from the bespoke Projects.tsx (same .prj-card / .prj-group classes).
 * "New project" opens the project-create modal; clicking a card publishes the
 * `ws_project` bus dimension — the detail/files/artifacts widgets react. */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import { authFetch } from '../../api/useAuth';
import {
  listProjects, visibilityLabel, visibilityIcon, visibilityPillClass,
  statusLabel, statusPillClass, projectGradient, fmtDate, type ProjectRow,
} from '../../api/projects';
import { esc } from '../_shared/helpers';

function card(p: ProjectRow, selected: boolean): string {
  return `
    <button class="prj-card${selected ? ' active' : ''}" data-pid="${esc(p.id)}"
            title="Open this project's detail below">
      <div class="prj-card-cover" style="background:${projectGradient(p.id)}"></div>
      <div class="prj-card-body">
        <div class="prj-card-row1">
          <span class="prj-vis-badge ${esc(visibilityPillClass(p.visibility))}">
            <svg class="ico ico-sm"><use href="#${esc(visibilityIcon(p.visibility))}"/></svg>
            ${esc(visibilityLabel(p.visibility))}
          </span>
          ${p.status !== 'active'
            ? `<span class="pill ${esc(statusPillClass(p.status))}">${esc(statusLabel(p.status))}</span>` : ''}
        </div>
        <h4 class="prj-card-name">${esc(p.name)}</h4>
        <p class="prj-card-desc">${esc(p.description || 'No description yet.')}</p>
        <div class="prj-card-foot">
          <span class="prj-card-owner">
            <svg class="ico ico-sm"><use href="#i-user"/></svg>
            ${esc(p.owner_username || 'you')}
          </span>
          <span class="prj-card-foot-right">
            ${(p.artifact_count != null && p.artifact_count > 0)
              ? `<span title="Artifacts"><svg class="ico ico-sm"><use href="#i-package"/></svg> ${esc(p.artifact_count)}</span>` : ''}
            <span class="muted">Updated ${esc(fmtDate(p.updated_at))}</span>
          </span>
        </div>
      </div>
    </button>`;
}

async function draw(ctx: WidgetCtx) {
  let projects: ProjectRow[] | null = null;
  let loadErr = '';
  let myKcSub: string | null = null;
  try {
    projects = await listProjects({ scope: 'all' });
  } catch (e: any) { loadErr = e?.message || String(e); }
  try {
    const me = await authFetch('/auth/me').then(r => r.json());
    if (me?.kc_sub) myKcSub = me.kc_sub;
  } catch { /* fall back to the private-is-mine invariant */ }

  if (projects === null) { ctx.empty(`Could not load projects — ${loadErr}`); return; }

  const state = { q: '' };

  const paint = () => {
    const all = projects!;
    const term = state.q.trim().toLowerCase();
    const filtered = term
      ? all.filter(p =>
          (p.name + ' ' + (p.description || '') + ' ' + (p.owner_username || ''))
            .toLowerCase().includes(term))
      : all;
    // "My" = anything I own; a private project is only ever returned to its
    // owner, so it's mine even if /auth/me hasn't resolved a sub.
    const isMine = (p: ProjectRow) =>
      (!!myKcSub && p.owner_kc_sub === myKcSub) || p.visibility === 'private';
    const sections = [
      { key: 'mine', label: 'My projects', icon: 'i-user', items: filtered.filter(isMine) },
      { key: 'group', label: 'Shared with your groups', icon: 'i-users', items: filtered.filter(p => !isMine(p) && p.visibility === 'group') },
      { key: 'public', label: 'Public projects', icon: 'i-globe', items: filtered.filter(p => !isMine(p) && p.visibility === 'public') },
    ].filter(s => s.items.length > 0);
    const selected = ctx.bus.get().ws_project || '';

    const listEl = ctx.el.querySelector<HTMLElement>('.ws-prj-list')!;
    if (all.length === 0) {
      listEl.innerHTML = `
        <div class="art-empty">
          <svg class="ico"><use href="#i-folder"/></svg>
          <h4>No projects yet</h4>
          <p>Create one to get a private file space in the warehouse and an
          experiment for its model runs.</p>
        </div>`;
    } else if (sections.length === 0) {
      listEl.innerHTML = `
        <div class="art-empty">
          <svg class="ico"><use href="#i-search"/></svg>
          <h4>No projects match</h4>
          <p>Nothing matches “${esc(state.q.trim())}”.</p>
        </div>`;
    } else {
      listEl.innerHTML = sections.map(s => `
        <div class="prj-group">
          <div class="prj-group-hdr">
            <svg class="ico"><use href="#${esc(s.icon)}"/></svg>
            <h3>${esc(s.label)}</h3>
            <span class="muted prj-group-count">${s.items.length}</span>
          </div>
          <div class="grid grid-3 prj-grid">
            ${s.items.map(p => card(p, p.id === selected)).join('')}
          </div>
        </div>`).join('');
    }

    listEl.querySelectorAll<HTMLButtonElement>('button.prj-card').forEach(btn => {
      btn.addEventListener('click', () => {
        ctx.bus.set('ws_project', btn.dataset.pid!);
        listEl.querySelectorAll('button.prj-card').forEach(x =>
          x.classList.toggle('active', x === btn));
        ctx.host.focusWidget('ws-project-detail');
      });
    });
  };

  ctx.el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:.7rem">
      <div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap">
        <span class="art-search" style="flex:1;min-width:220px;margin:0">
          <svg class="ico"><use href="#i-search"/></svg>
          <input class="ws-flt-q" placeholder="Search projects by name, description or owner" aria-label="Search projects">
        </span>
        <button class="btn btn-sm btn-primary" data-act="new">
          <svg class="ico ico-sm"><use href="#i-plus"/></svg> New project</button>
      </div>
      <div class="ws-prj-list"></div>
    </div>`;

  ctx.el.querySelector<HTMLButtonElement>('button[data-act="new"]')!
    .addEventListener('click', () => {
      ctx.host.openModal('project-create', {
        onDone: async (created?: { id?: string }) => {
          try { projects = await listProjects({ scope: 'all' }); } catch { /* keep old list */ }
          if (created?.id) ctx.bus.set('ws_project', created.id);   // open the fresh project
          paint();
        },
      });
    });
  ctx.el.querySelector<HTMLInputElement>('.ws-flt-q')!
    .addEventListener('input', (e) => {
      state.q = (e.currentTarget as HTMLInputElement).value;
      paint();
    });

  paint();
}

const def: WidgetDef = {
  id: 'ws-projects-table',
  reactsTo: [],   // it PUBLISHES ws_project
  render(ctx) { return draw(ctx); },
};
export default def;
