/** ws-project-detail — metadata + the visibility control + open-in-lab.
 *  reactsTo `ws_project` (published by ws-projects-table).
 *
 *   GET   /gw/projects/{id}        ACL-checked detail
 *   PATCH /gw/projects/{id}        OWNER-ONLY visibility change; choosing
 *                                  "group" requires a group you belong to
 *                                  (picker from GET /gw/groups)
 *   POST  /gw/workspace/spawn      {project_id} → open the returned url;
 *                                  honestly disabled when the hub isn't
 *                                  configured (GET /gw/workspace/status)
 *
 * Ported from the bespoke ProjectDetail.tsx header + VisibilityControl. */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import { authFetch } from '../../api/useAuth';
import {
  getProject, updateProject,
  visibilityLabel, visibilityIcon, visibilityPillClass, visibilityHint,
  statusLabel, statusPillClass, reviewStatusLabel, reviewStatusPillClass,
  projectGradient, fmtDate,
  type ProjectRow, type ProjectVisibility,
} from '../../api/projects';
import { listGroups, type GroupRow } from '../../api/groups';
import { esc, errText, toast } from '../_shared/helpers';

const VISIBILITIES: ProjectVisibility[] = ['private', 'group', 'public'];

async function draw(ctx: WidgetCtx): Promise<void | (() => void)> {
  const { theme } = ctx;
  const projectId = ctx.filters.ws_project || '';
  if (!projectId) {
    ctx.empty('Select a project in the catalogue above to see its detail, files and artifacts.');
    return;
  }

  let project: ProjectRow | null = null;
  let loadErr = '';
  let myKcSub: string | null = null;
  try { project = await getProject(projectId); }
  catch (e: any) { loadErr = e?.message || String(e); }
  try {
    const me = await authFetch('/auth/me').then(r => r.json());
    if (me?.kc_sub) myKcSub = me.kc_sub;
  } catch { /* isOwner stays conservative */ }

  if (!project) { ctx.empty(`Could not load this project — ${loadErr}`); return; }

  // Hub availability decides the open-in-lab affordance's honest state.
  let hubReason: string | null = null;   // non-null ⇒ hub unusable, reason verbatim
  let hubRunningUrl: string | null = null;
  try {
    const r = await authFetch('/gw/workspace/status');
    if (r.ok) {
      const st = await r.json();
      if (st.running) hubRunningUrl = st.url || st.server || null;
      else if (/not configured/i.test(st.reason || '')) hubReason = st.reason;
    }
  } catch { /* leave the button enabled; spawn errors surface on click */ }

  const isOwner = (!!myKcSub && project.owner_kc_sub === myKcSub) || project.visibility === 'private';
  const p = project;

  // ── public-review state (tasks #42/#43) ──
  // "Submit for review" is an OWNER action, gated on review_status:
  //   draft / changes_requested / rejected → submittable
  //   in_review                            → disabled "In review"
  //   approved                             → published (a "Public" badge, no button)
  const rs = (p.review_status as string) || 'draft';
  const canSubmitReview = isOwner && (rs === 'draft' || rs === 'changes_requested' || rs === 'rejected');
  const submitLabel = rs === 'changes_requested' || rs === 'rejected' ? 'Re-submit for review' : 'Submit for review';

  ctx.el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:.9rem">
      <div class="prj-header" style="background:${projectGradient(p.id)};margin:0">
        <div class="prj-header-body">
          <div class="prj-header-badges">
            <span class="prj-vis-badge ${esc(visibilityPillClass(p.visibility))}">
              <svg class="ico ico-sm"><use href="#${esc(visibilityIcon(p.visibility))}"/></svg>
              ${esc(visibilityLabel(p.visibility))}
            </span>
            <span class="pill ${esc(statusPillClass(p.status))}">${esc(statusLabel(p.status))}</span>
            <span class="pill ${esc(reviewStatusPillClass(rs))}">${esc(reviewStatusLabel(rs))}</span>
          </div>
          <h2 class="prj-header-name">${esc(p.name)}</h2>
          <div class="prj-header-meta">
            <span>Owner <strong>${esc(p.owner_username || (isOwner ? 'you' : p.owner_kc_sub))}</strong></span>
            <span>·</span><span><code>${esc(p.slug)}</code></span>
            <span>·</span><span>Created ${esc(fmtDate(p.created_at))}</span>
            ${p.contributor_count != null
              ? `<span>·</span><span>${esc(p.contributor_count)} contributor${p.contributor_count === 1 ? '' : 's'}</span>` : ''}
          </div>
          ${p.description ? `<p class="prj-header-desc">${esc(p.description)}</p>` : ''}
        </div>
      </div>

      <div class="prj-actions" style="margin:0">
        ${hubReason
          ? `<button class="btn btn-sm btn-ghost" disabled aria-disabled="true" title="${esc(hubReason)}">
               <svg class="ico ico-sm"><use href="#i-external"/></svg> Open in JupyterLab</button>
             <span class="prj-actions-hint muted">${esc(hubReason)}</span>`
          : `<button class="btn btn-sm btn-primary" data-act="open-lab">
               <svg class="ico ico-sm"><use href="#i-external"/></svg> Open in JupyterLab</button>
             <span class="prj-actions-hint muted">${hubRunningUrl
               ? 'Your lab is running — opens it on this project.'
               : 'Spawns your lab pod on this project’s file space.'}</span>`}
        <button class="btn btn-sm btn-ghost" data-act="download-zip" style="margin-left:.5rem">
          <svg class="ico ico-sm"><use href="#i-download"/></svg> Download ZIP</button>
        ${canSubmitReview
          ? `<button class="btn btn-sm btn-primary" data-act="submit-review" style="margin-left:.5rem">
               <svg class="ico ico-sm"><use href="#i-graduation"/></svg> ${esc(submitLabel)}</button>`
          : isOwner && rs === 'in_review'
            ? `<button class="btn btn-sm btn-ghost" disabled aria-disabled="true" style="margin-left:.5rem"
                 title="This project is with a reviewer.">
                 <svg class="ico ico-sm"><use href="#i-clock"/></svg> In review</button>`
            : isOwner && rs === 'approved'
              ? `<span class="pill good" style="margin-left:.5rem;align-self:center">
                   <svg class="ico ico-sm"><use href="#i-globe"/></svg> Public</span>`
              : ''}
      </div>
      <div class="ws-prj-msg"></div>

      <div class="prj-panel" style="margin:0">
        <div class="prj-panel-hdr">
          <svg class="ico"><use href="#i-shield"/></svg>
          <h3>Who can see this</h3>
        </div>
        <p class="prj-panel-lede muted">
          Visibility is the single tag that decides who can find and open this
          project. ${isOwner ? 'Change it any time.' : 'Only the project owner can change it.'}</p>
        <div class="ws-vis-slot"></div>
      </div>
    </div>`;

  const msg = ctx.el.querySelector<HTMLElement>('.ws-prj-msg')!;
  const showErr = (text: string) => {
    msg.innerHTML = `<div class="alert-banner" style="background:var(--alert-50);color:var(--alert)">${esc(text)}</div>`;
  };

  // ── Download the project as a role-protected ZIP ──
  ctx.el.querySelector<HTMLButtonElement>('button[data-act="download-zip"]')
    ?.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      msg.innerHTML = '';
      try {
        const r = await authFetch(`/gw/projects/${encodeURIComponent(p.id)}/download.zip`);
        if (!r.ok) { showErr(`Could not download: ${await errText(r)}`); return; }
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${p.slug || p.name || 'project'}.zip`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      } catch (err: any) {
        showErr(`Could not download: ${err?.message || String(err)}`);
      } finally { btn.disabled = false; }
    });

  // ── Open in JupyterLab ──
  ctx.el.querySelector<HTMLButtonElement>('button[data-act="open-lab"]')
    ?.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      msg.innerHTML = '';
      try {
        const r = await authFetch('/gw/workspace/spawn', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ project_id: p.id }),
        });
        if (!r.ok) { showErr(`Could not open the lab: ${await errText(r)}`); btn.disabled = false; return; }
        const body = await r.json().catch(() => ({} as any));
        const url = body?.url || hubRunningUrl;
        if (url) window.open(url, '_blank', 'noreferrer');
        else toast('Lab spawn requested — the pod is starting; reopen once it is up');
        btn.disabled = false;
      } catch (err: any) {
        showErr(`Could not open the lab: ${err?.message || String(err)}`);
        btn.disabled = false;
      }
    });

  // ── Submit for review (owner-only) — opens the project-submit modal,
  //    which runs the essential-files check and POSTs the submit. On success
  //    it re-draws THIS detail (now in_review) via onDone. ──
  ctx.el.querySelector<HTMLButtonElement>('button[data-act="submit-review"]')
    ?.addEventListener('click', () => {
      ctx.host.openModal('project-submit', {
        project_id: p.id,
        project_name: p.name,
        onDone: () => { void draw(ctx); },
      });
    });

  // ── visibility control (owner-only PATCH; group picker lazily) ──
  const visSlot = ctx.el.querySelector<HTMLElement>('.ws-vis-slot')!;
  const vs = {
    pendingVis: p.visibility as ProjectVisibility,
    pendingGroup: p.group_id as string | null,
    groups: null as GroupRow[] | null,
    groupsErr: null as string | null,
    busy: false,
    saveErr: null as string | null,
  };

  const groupName = (id: string | null): string => {
    if (!id) return '';
    return p.group_name || vs.groups?.find(g => g.id === id)?.name || id;
  };

  const paintVis = () => {
    const changed = vs.pendingVis !== p.visibility
      || (vs.pendingVis === 'group' && vs.pendingGroup !== p.group_id);
    const needsGroup = vs.pendingVis === 'group' && !vs.pendingGroup;

    let groupHtml = '';
    if (vs.pendingVis === 'group') {
      if (!isOwner) {
        groupHtml = `<p class="muted" style="font-size:.82rem;margin:0">
          Shared with <strong>${esc(groupName(p.group_id) || 'a group')}</strong>.</p>`;
      } else if (vs.groupsErr) {
        groupHtml = `<div class="alert-banner" style="background:var(--alert-50);color:var(--alert)">
          Could not load your groups: ${esc(vs.groupsErr)}</div>`;
      } else if (vs.groups === null) {
        groupHtml = `<p class="muted">Loading your groups…</p>`;
      } else if (vs.groups.length === 0) {
        groupHtml = `<p class="muted" style="font-size:.82rem;margin:0">
          You're not a member of any group yet — join one from the Community
          section to share a project with it.</p>`;
      } else {
        groupHtml = `
          <label class="prj-vis-group-label">
            <span>Share with group</span>
            <select class="ws-vis-group">
              <option value="">— choose a group —</option>
              ${vs.groups.map(g =>
                `<option value="${esc(g.id)}"${vs.pendingGroup === g.id ? ' selected' : ''}>${esc(g.name)}</option>`).join('')}
            </select>
          </label>`;
      }
    }

    visSlot.innerHTML = `
      <div class="prj-vis-options">
        ${VISIBILITIES.map(v => `
          <button type="button" class="prj-vis-opt${vs.pendingVis === v ? ' active' : ''}"
                  data-vis="${esc(v)}" ${isOwner ? '' : 'disabled'} aria-pressed="${vs.pendingVis === v}">
            <svg class="ico"><use href="#${esc(visibilityIcon(v))}"/></svg>
            <span class="prj-vis-opt-main">
              <span class="prj-vis-opt-name">${esc(visibilityLabel(v))}</span>
              <span class="prj-vis-opt-hint">${esc(visibilityHint(v))}</span>
            </span>
          </button>`).join('')}
      </div>
      ${groupHtml ? `<div class="prj-vis-group">${groupHtml}</div>` : ''}
      ${vs.saveErr ? `
        <div class="alert-banner" style="background:var(--alert-50);color:var(--alert)">
          Could not update visibility: ${esc(vs.saveErr)}</div>` : ''}
      ${isOwner ? `
        <div class="prj-vis-foot">
          <button class="btn btn-sm btn-primary" data-act="save"
                  ${vs.busy || !changed || needsGroup ? 'disabled' : ''}>
            <svg class="ico ico-sm"><use href="#i-check"/></svg>
            ${vs.busy ? 'Saving…' : 'Save visibility'}</button>
          ${changed && !vs.busy
            ? '<button class="btn btn-sm btn-ghost" data-act="cancel">Cancel</button>' : ''}
        </div>` : ''}`;

    visSlot.querySelectorAll<HTMLButtonElement>('button[data-vis]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!isOwner) return;
        vs.pendingVis = btn.dataset.vis as ProjectVisibility;
        // The group picker only lists groups you belong to — fetched lazily.
        if (vs.pendingVis === 'group' && vs.groups === null && !vs.groupsErr) {
          listGroups()
            .then(g => { vs.groups = g.filter(x => x.i_am_a_member); paintVis(); })
            .catch(e => { vs.groupsErr = e?.message || String(e); paintVis(); });
        }
        paintVis();
      });
    });
    visSlot.querySelector<HTMLSelectElement>('select.ws-vis-group')
      ?.addEventListener('change', (e) => {
        vs.pendingGroup = (e.currentTarget as HTMLSelectElement).value || null;
        paintVis();
      });
    visSlot.querySelector<HTMLButtonElement>('button[data-act="cancel"]')
      ?.addEventListener('click', () => {
        vs.pendingVis = p.visibility as ProjectVisibility;
        vs.pendingGroup = p.group_id;
        vs.saveErr = null;
        paintVis();
      });
    visSlot.querySelector<HTMLButtonElement>('button[data-act="save"]')
      ?.addEventListener('click', async () => {
        const changedNow = vs.pendingVis !== p.visibility
          || (vs.pendingVis === 'group' && vs.pendingGroup !== p.group_id);
        if (!changedNow || (vs.pendingVis === 'group' && !vs.pendingGroup)) return;
        vs.busy = true; vs.saveErr = null;
        paintVis();
        try {
          const patch = vs.pendingVis === 'group'
            ? { visibility: vs.pendingVis, group_id: vs.pendingGroup }
            : { visibility: vs.pendingVis };
          await updateProject(p.id, patch);
          toast('Project visibility updated');
          await draw(ctx);   // re-read the authoritative row
        } catch (e: any) {
          vs.saveErr = e?.message || String(e);
          vs.busy = false;
          paintVis();
        }
      });
  };

  paintVis();
  void theme;
}

const def: WidgetDef = {
  id: 'ws-project-detail',
  reactsTo: ['ws_project'],
  render(ctx) { return draw(ctx); },
};
export default def;
