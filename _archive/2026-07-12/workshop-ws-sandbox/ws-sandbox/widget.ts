/** ws-sandbox — the researcher's compute sandbox.
 *
 *   GET  /gw/workspace/profiles   the profile catalogue + per-role eligibility
 *   GET  /gw/workspace/status     the caller's JupyterLab pod state
 *   POST /gw/workspace/spawn      spawn my pod (self-serve profiles only)
 *   POST /gw/workspace/stop       stop my pod
 *
 * When the hub isn't configured the status answers {running:false, reason:…} —
 * rendered as an honestly disabled state (the reason verbatim), never a fake
 * "running" badge. "Request bigger pod" opens the compute-request modal. */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import { authFetch } from '../../api/useAuth';
import { esc, errText, toast } from '../_shared/helpers';

type Profile = {
  slug: string; display_name: string; description: string; self_serve: boolean;
  resources?: Record<string, string>;
};
type Catalogue = { default_profile: string | null; profiles: Profile[]; user_role: string | null };
type LabStatus = {
  running: boolean; reason?: string | null;
  server?: string | null; url?: string | null; last_activity?: string | null;
};

function notConfigured(st: LabStatus): boolean {
  return !st.running && /not configured/i.test(st.reason || '');
}

type ProjectRow = { id: string; name: string; slug?: string };

async function draw(ctx: WidgetCtx) {
  const { theme } = ctx;
  let cat: Catalogue | null = null;
  let catErr = '';
  let st: LabStatus | null = null;
  let projects: ProjectRow[] = [];
  try {
    const [rCat, rSt, rPrj] = await Promise.all([
      authFetch('/gw/workspace/profiles'),
      authFetch('/gw/workspace/status'),
      authFetch('/gw/projects'),
    ]);
    if (rCat.ok) cat = await rCat.json(); else catErr = await errText(rCat);
    if (rSt.ok) st = await rSt.json();
    if (rPrj.ok) {
      const j = await rPrj.json();
      projects = (Array.isArray(j) ? j : (j.projects || j.items || [])) as ProjectRow[];
    }
  } catch { /* both stay null → empty state below */ }

  if (!cat && !st) { ctx.empty('Could not reach the workspace service.'); return; }

  // ── lab state panel ──
  let labHtml: string;
  if (st?.running) {
    const openUrl = st.url || st.server || '';
    labHtml = `
      <div style="display:flex;align-items:center;gap:.7rem;flex-wrap:wrap">
        <span class="pill good">running</span>
        <span style="font-size:.85rem;color:${theme.ink[1]}">Your JupyterLab pod is up${st.last_activity ? ` · last activity ${esc(st.last_activity)}` : ''}.</span>
        <span style="flex:1"></span>
        ${openUrl ? `<a class="btn btn-sm btn-primary" href="${esc(openUrl)}" target="_blank" rel="noreferrer">
            <svg class="ico ico-sm"><use href="#i-external"/></svg> Open lab</a>` : ''}
        <button class="btn btn-sm btn-ghost" data-act="stop">Stop</button>
      </div>`;
  } else if (st && notConfigured(st)) {
    labHtml = `
      <div style="display:flex;align-items:center;gap:.7rem;flex-wrap:wrap">
        <span class="pill neutral">not running</span>
        <span style="font-size:.85rem;color:${theme.ink[2]}">JupyterLab is unavailable in this environment.</span>
        <span style="flex:1"></span>
        <button class="btn btn-sm btn-ghost" disabled aria-disabled="true" title="${esc(st.reason)}">
          <svg class="ico ico-sm"><use href="#i-play"/></svg> Start lab</button>
      </div>`;
  } else if (!projects.length) {
    // Every lab is project-scoped (no unscoped sandbox) — need a project first.
    labHtml = `
      <div style="display:flex;align-items:center;gap:.7rem;flex-wrap:wrap">
        <span class="pill neutral">not running</span>
        <span style="font-size:.85rem;color:${theme.ink[2]}">Create or join a project first — every lab opens on a project's files.</span>
        <span style="flex:1"></span>
        <button class="btn btn-sm btn-ghost" disabled aria-disabled="true" title="No project available">
          <svg class="ico ico-sm"><use href="#i-play"/></svg> Start lab</button>
      </div>`;
  } else {
    labHtml = `
      <div style="display:flex;align-items:center;gap:.7rem;flex-wrap:wrap">
        <span class="pill neutral">not running</span>
        <span style="font-size:.85rem;color:${theme.ink[2]}">Open a lab on one of your projects — its files sync into the session.</span>
        <span style="flex:1"></span>
        <select class="ws-prj-select" style="font-size:.85rem;padding:.35rem .55rem;border:1px solid var(--line);border-radius:8px;background:var(--paper);color:${theme.ink[0]}">
          ${projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}
        </select>
        <button class="btn btn-sm btn-primary" data-act="spawn">
          <svg class="ico ico-sm"><use href="#i-play"/></svg> Start lab</button>
      </div>`;
  }

  // ── profile cards ──
  let profilesHtml: string;
  if (catErr) {
    profilesHtml = `<p class="mdl-note alert" style="margin:0">Could not load the profile catalogue: ${esc(catErr)}</p>`;
  } else if (!cat || !cat.profiles.length) {
    profilesHtml = `<p class="mdl-note" style="margin:0">The gateway returned no workspace profiles (profile catalogue not mounted).</p>`;
  } else {
    profilesHtml = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:.7rem">
        ${cat.profiles.map(p => {
          const cpu = p.resources?.cpu_limit || '';
          const mem = p.resources?.memory_limit || '';
          const isDefault = p.slug === cat!.default_profile;
          return `
          <div class="ws-profile-card${p.self_serve ? '' : ' locked'}">
            <div style="display:flex;align-items:center;gap:.4rem">
              <strong style="font-size:.9rem;color:${theme.ink[0]}">${esc(p.slug)}</strong>
              ${isDefault ? '<span class="pill neutral">default</span>' : ''}
              <span style="flex:1"></span>
              ${p.self_serve
                ? '<span class="pill good">self-serve</span>'
                : '<span class="pill watch">request only</span>'}
            </div>
            ${(cpu || mem) ? `<div style="font-family:${theme.fontMono};font-size:.78rem;color:${theme.ink[2]}">${esc(cpu)} CPU · ${esc(mem)}</div>` : ''}
            <p style="font-size:.78rem;color:${theme.ink[2]};margin:0;line-height:1.45">${esc(p.description)}</p>
          </div>`;
        }).join('')}
      </div>
      <div style="margin-top:.7rem;display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">
        <span style="font-size:.8rem;color:${theme.ink[2]}">Need more than your self-serve profiles allow?</span>
        <button class="btn btn-sm btn-ghost" data-act="request">
          <svg class="ico ico-sm"><use href="#i-server"/></svg> Request bigger pod</button>
      </div>`;
  }

  ctx.el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:1rem">
      <div class="ws-lab-state">${labHtml}</div>
      <div>
        <div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:${theme.ink[2]};font-weight:600;margin-bottom:.5rem">Compute profiles</div>
        ${profilesHtml}
      </div>
      <div class="ws-msg" style="display:none"></div>
    </div>`;

  const msg = ctx.el.querySelector<HTMLElement>('.ws-msg')!;
  const fail = (text: string) => {
    msg.style.display = '';
    msg.innerHTML = `<div class="alert-banner" style="background:var(--alert-50);color:var(--alert)">${esc(text)}</div>`;
  };

  ctx.el.querySelector<HTMLButtonElement>('button[data-act="request"]')
    ?.addEventListener('click', () => ctx.host.openModal('compute-request'));

  ctx.el.querySelector<HTMLButtonElement>('button[data-act="spawn"]')
    ?.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      const sel = ctx.el.querySelector<HTMLSelectElement>('.ws-prj-select');
      const project_id = sel?.value;
      if (!project_id) { fail('Pick a project to open the lab on.'); return; }
      btn.disabled = true;
      try {
        const r = await authFetch('/gw/workspace/spawn', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ project_id }),   // project-scoped lab (no unscoped)
        });
        if (!r.ok) { fail(`Spawn failed: ${await errText(r)}`); btn.disabled = false; return; }
        toast('Workspace spawn requested — the pod is starting');
        await draw(ctx);                   // re-read the real status
      } catch (err: any) {
        fail(`Spawn failed: ${err?.message || String(err)}`);
        btn.disabled = false;
      }
    });

  ctx.el.querySelector<HTMLButtonElement>('button[data-act="stop"]')
    ?.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      try {
        const r = await authFetch('/gw/workspace/stop', { method: 'POST' });
        if (!r.ok) { fail(`Stop failed: ${await errText(r)}`); btn.disabled = false; return; }
        toast('Workspace stopped');
        await draw(ctx);
      } catch (err: any) {
        fail(`Stop failed: ${err?.message || String(err)}`);
        btn.disabled = false;
      }
    });
}

const def: WidgetDef = {
  id: 'ws-sandbox',
  reactsTo: [],
  render(ctx) { return draw(ctx); },
};
export default def;
