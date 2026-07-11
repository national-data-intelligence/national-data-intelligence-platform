/** ws-groups — "Your groups" + "Discover", with working create/join/leave.
 *
 *   GET  /gw/groups             → { groups: [...] } (member flag per row)
 *   POST /gw/groups             {name, description} → 201 (contributor roles)
 *   POST /gw/groups/{id}/join   open groups
 *   POST /gw/groups/{id}/leave
 *
 * A 403 on create (role not allowed) is surfaced honestly next to the form;
 * join errors render verbatim. Ported from the bespoke Groups.tsx page
 * (same .grp-card / .grp-row1 / .grp-stats classes). */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import { authFetch } from '../../api/useAuth';
import { esc, errText, toast, unwrapList } from '../_shared/helpers';

type GroupRow = {
  id: string; name: string; description: string; visibility: string;
  created_at: string; member_count: number; artifact_count: number;
  last_activity_at: string | null; i_am_a_member: boolean;
};

function fmtCount(n: number, singular: string, plural?: string): string {
  return `${n} ${n === 1 ? singular : (plural || singular + 's')}`;
}

function visibilityHint(v: string): string {
  if (v === 'open') return 'open · self-join';
  if (v === 'request') return 'open · request to join';
  if (v === 'invite-only' || v === 'closed') return 'invite-only';
  if (v === 'public') return 'open · self-join';
  return v;
}

async function draw(ctx: WidgetCtx) {
  const { theme } = ctx;
  let groups: GroupRow[] | null = null;
  let loadErr = '';
  try {
    const r = await authFetch('/gw/groups');
    if (r.ok) groups = unwrapList<GroupRow>(await r.json(), 'groups');
    else loadErr = await errText(r);
  } catch (e: any) { loadErr = e?.message || String(e); }

  if (groups === null) { ctx.empty(`Could not load groups${loadErr ? ` — ${loadErr}` : ''}.`); return; }

  const mine = groups.filter(g => g.i_am_a_member);
  const discover = groups.filter(g => !g.i_am_a_member);

  const mineCards = mine.map(g => `
    <div class="grp-card" data-gid="${esc(g.id)}">
      <div class="grp-row1">
        <span class="grp-badge">Member</span>
        <span class="grp-name">${esc(g.name)}</span>
      </div>
      <p class="grp-desc">${esc(g.description)}</p>
      <div class="grp-stats">
        <span>${esc(fmtCount(g.member_count, 'member'))}</span>
        ${g.artifact_count > 0 ? `<span>${esc(fmtCount(g.artifact_count, 'shared artifact'))}</span>` : ''}
        ${g.last_activity_at ? '<span>active</span>' : ''}
      </div>
      <button class="btn btn-sm btn-ghost mt-sm" data-act="leave" data-gid="${esc(g.id)}">
        <svg class="ico ico-sm"><use href="#i-x"/></svg> Leave</button>
    </div>`).join('');

  const discoverCards = discover.map(g => {
    const joinable = g.visibility === 'open' || g.visibility === 'public';
    return `
    <div class="grp-card discover" data-gid="${esc(g.id)}">
      <div class="grp-row1"><span class="grp-name">${esc(g.name)}</span></div>
      <p class="grp-desc">${esc(g.description)}</p>
      <div class="grp-stats">
        <span>${esc(fmtCount(g.member_count, 'member'))}</span>
        <span>${esc(visibilityHint(g.visibility))}</span>
      </div>
      ${joinable
        ? `<button class="btn btn-sm btn-ghost mt-sm" data-act="join" data-gid="${esc(g.id)}">
             <svg class="ico ico-sm"><use href="#i-arrow-right"/></svg> Join</button>`
        : `<button class="btn btn-sm btn-ghost mt-sm" disabled aria-disabled="true"
             title="This group does not allow self-join (${esc(g.visibility)})">
             <svg class="ico ico-sm"><use href="#i-lock"/></svg> ${esc(visibilityHint(g.visibility))}</button>`}
    </div>`;
  }).join('');

  const cardGrid = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:.75rem';
  ctx.el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:.9rem">
      <div style="display:flex;align-items:flex-start;gap:.9rem">
        <p style="font-size:.85rem;color:${theme.ink[2]};margin:0;flex:1;line-height:1.5;max-width:64ch">
          A research team, a programme, or a university course — members share
          artifacts at the <strong style="color:${theme.ink[1]}">shared</strong> tier.</p>
        <button class="btn btn-sm btn-primary" data-act="new" style="flex:none">
          <svg class="ico ico-sm"><use href="#i-plus"/></svg> Create a group</button>
      </div>
      <form class="grp-create wk-form" style="display:none;gap:.5rem;border:1px solid var(--line);border-radius:10px;padding:.9rem 1rem;background:var(--paper-2)">
        <label><span>Name</span>
          <input name="name" minlength="3" maxlength="80" placeholder="e.g. Malaria modelling network" required></label>
        <label><span>Description <span class="muted">· optional</span></span>
          <input name="description" placeholder="What does this group work on?"></label>
        <div class="grp-create-err"></div>
        <div style="display:flex;gap:.5rem;justify-content:flex-end">
          <button type="button" class="btn btn-sm btn-ghost" data-act="cancel-new">Cancel</button>
          <button type="submit" class="btn btn-sm btn-primary">Create</button>
        </div>
      </form>
      <div class="grp-msg"></div>

      <div>
        <h4 class="grp-heading" style="margin-bottom:.6rem">Your groups <span class="text-xs muted">(${mine.length})</span></h4>
        <div style="${cardGrid}">
          ${mineCards ||
            `<p class="muted" style="grid-column:1 / -1;font-size:.84rem;padding:.5rem 0">You're not a member of any groups yet — join one from Discover below.</p>`}
        </div>
      </div>

      <div>
        <h4 class="grp-heading" style="margin-bottom:.6rem">Discover <span class="text-xs muted">(${discover.length})</span></h4>
        <div style="${cardGrid}">
          ${discoverCards ||
            `<p class="muted" style="grid-column:1 / -1;font-size:.84rem;padding:.5rem 0">No other groups to discover right now.</p>`}
        </div>
      </div>
    </div>`;

  const form = ctx.el.querySelector<HTMLFormElement>('form.grp-create')!;
  const formErr = form.querySelector<HTMLElement>('.grp-create-err')!;
  const msg = ctx.el.querySelector<HTMLElement>('.grp-msg')!;
  const showMsg = (text: string) => {
    msg.innerHTML = `<div class="alert-banner" style="background:var(--alert-50);color:var(--alert)">${esc(text)}</div>`;
  };

  ctx.el.querySelector<HTMLButtonElement>('button[data-act="new"]')!
    .addEventListener('click', () => { form.style.display = 'flex'; form.style.flexDirection = 'column'; });
  form.querySelector<HTMLButtonElement>('button[data-act="cancel-new"]')!
    .addEventListener('click', () => { form.style.display = 'none'; formErr.innerHTML = ''; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = (form.elements.namedItem('name') as HTMLInputElement).value.trim();
    const description = (form.elements.namedItem('description') as HTMLInputElement).value.trim();
    if (name.length < 3) return;
    formErr.innerHTML = '';
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    submit.disabled = true;
    try {
      const r = await authFetch('/gw/groups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, ...(description ? { description } : {}) }),
      });
      if (r.status === 201) {
        toast(`Group "${name}" created`);
        await draw(ctx);
        return;
      }
      const detail = await errText(r);
      formErr.innerHTML = r.status === 403
        ? `<div class="alert-banner" style="background:var(--watch-50);color:var(--watch)">Your role can't create groups: ${esc(detail)}</div>`
        : `<div class="alert-banner" style="background:var(--alert-50);color:var(--alert)">Create failed: ${esc(detail)}</div>`;
    } catch (err: any) {
      formErr.innerHTML = `<div class="alert-banner" style="background:var(--alert-50);color:var(--alert)">Create failed: ${esc(err?.message || String(err))}</div>`;
    } finally {
      submit.disabled = false;
    }
  });

  ctx.el.querySelectorAll<HTMLButtonElement>('button[data-act="join"],button[data-act="leave"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const gid = btn.dataset.gid!;
      const act = btn.dataset.act!;
      btn.disabled = true;
      try {
        const r = await authFetch(`/gw/groups/${encodeURIComponent(gid)}/${act}`, { method: 'POST' });
        if (!r.ok) {
          showMsg(`Could not ${act} the group: ${await errText(r)}`);
          btn.disabled = false;
          return;
        }
        toast(act === 'join' ? 'Joined the group' : 'Left the group');
        await draw(ctx);
      } catch (err: any) {
        showMsg(`Could not ${act} the group: ${esc(err?.message || String(err))}`);
        btn.disabled = false;
      }
    });
  });
}

const def: WidgetDef = {
  id: 'ws-groups',
  reactsTo: [],
  render(ctx) { return draw(ctx); },
};
export default def;
