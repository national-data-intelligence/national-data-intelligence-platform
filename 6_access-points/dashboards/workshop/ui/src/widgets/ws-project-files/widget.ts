/** ws-project-files — the project's file space with nested folders, upload,
 *  and project-to-project direct-send. reactsTo `ws_project`.
 *
 *   GET  /gw/projects/{id}/files            → {files:[{name,size,…}], folders:[]}
 *   POST /gw/projects/{id}/files/folder     {path}          create nested folder
 *   POST /gw/projects/{id}/files/upload     multipart(path,file)  upload
 *   POST /gw/projects/{id}/send             {target_project_id,item_type:'file',
 *                                            item_ref}       copy into another
 *                                            project's received/ inbox
 * No storage credentials reach the browser — the gateway proxies MinIO. */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import { authFetch } from '../../api/useAuth';
import { listProjects } from '../../api/projects';
import { fmtBytes, fmtDateTime } from '../../api/projects';
import { esc, errText, toast } from '../_shared/helpers';

type FileRow = { name: string; size: number; last_modified: string | null };

async function draw(ctx: WidgetCtx) {
  const { theme } = ctx;
  const projectId = ctx.filters.ws_project || '';
  if (!projectId) { ctx.empty('Select a project above to browse its file space.'); return; }

  let cwd = '';   // current folder, '' = root
  let projects: { id: string; name: string }[] = [];
  try { projects = (await listProjects({ scope: 'all' })).map(p => ({ id: p.id, name: p.name })); } catch { /* send picker degrades */ }

  const load = async () => {
    let files: FileRow[] = [], folders: string[] = [];
    try {
      const r = await authFetch(`/gw/projects/${encodeURIComponent(projectId)}/files`);
      if (!r.ok) { ctx.el.innerHTML = `<div class="widget-empty">Could not list files — ${esc(await errText(r))}</div>`; return; }
      const j = await r.json();
      files = j.files || []; folders = j.folders || [];
    } catch (e: any) { ctx.el.innerHTML = `<div class="widget-empty">Could not list files — ${esc(e?.message || String(e))}</div>`; return; }

    // Subfolders + files directly under cwd.
    const inCwd = (name: string) => cwd ? name.startsWith(cwd + '/') : true;
    const rel = (name: string) => cwd ? name.slice(cwd.length + 1) : name;
    const subFolders = [...new Set(folders.filter(f => inCwd(f) && rel(f).indexOf('/') === -1 && f !== cwd))];
    const cwdFiles = files.filter(f => inCwd(f.name) && rel(f.name).indexOf('/') === -1);

    const crumbs = ['<span class="prj-crumb" data-path="">project root</span>']
      .concat(cwd ? cwd.split('/').map((_, i, a) => {
        const p = a.slice(0, i + 1).join('/');
        return `<span class="prj-crumb-sep">/</span><span class="prj-crumb" data-path="${esc(p)}">${esc(a[i])}</span>`;
      }) : []).join('');

    ctx.el.innerHTML = `
      <div class="prj-files-tools">
        <div class="prj-crumbs">${crumbs}</div>
        <span style="flex:1"></span>
        <button class="btn btn-sm btn-ghost" data-act="mkdir"><svg class="ico ico-sm"><use href="#i-folder"/></svg> New folder</button>
        <label class="btn btn-sm btn-primary" style="cursor:pointer;margin:0">
          <svg class="ico ico-sm"><use href="#i-upload"/></svg> Upload<input type="file" data-act="upload" style="display:none"></label>
      </div>
      ${(!subFolders.length && !cwdFiles.length)
        ? `<div class="widget-empty"><svg class="ico"><use href="#i-folder"/></svg><span>This folder is empty. Upload a file or create a sub-folder — JupyterLab writes here too, and linked datasets appear under <code>datasets/</code>.</span></div>`
        : `<div class="art-schema prj-files" style="margin:0"><table><thead><tr>
             <th>Name</th><th>Size</th><th>Modified</th><th></th></tr></thead><tbody>
             ${subFolders.map(f => `
               <tr class="prj-row-folder" data-folder="${esc(f)}">
                 <td><svg class="ico ico-sm" style="color:${theme.navy['500']};vertical-align:-2px"><use href="#i-folder"/></svg> <strong>${esc(rel(f))}/</strong></td>
                 <td class="muted">folder</td><td></td><td></td>
               </tr>`).join('')}
             ${cwdFiles.map(f => `
               <tr>
                 <td><code>${esc(rel(f.name))}</code></td>
                 <td>${esc(fmtBytes(f.size))}</td>
                 <td>${esc(fmtDateTime(f.last_modified))}</td>
                 <td style="text-align:right"><button class="btn btn-sm btn-ghost" data-send="${esc(f.name)}"><svg class="ico ico-sm"><use href="#i-arrow-right"/></svg> Send</button></td>
               </tr>`).join('')}
           </tbody></table></div>`}
      <div class="prj-files-msg" style="display:none;margin-top:.6rem"></div>`;

    const msg = ctx.el.querySelector<HTMLElement>('.prj-files-msg')!;
    const showMsg = (h: string) => { msg.style.display = ''; msg.innerHTML = h; };

    ctx.el.querySelectorAll<HTMLElement>('.prj-crumb').forEach(c =>
      c.addEventListener('click', () => { cwd = c.dataset.path || ''; void load(); }));
    ctx.el.querySelectorAll<HTMLElement>('.prj-row-folder').forEach(r =>
      r.addEventListener('click', () => { cwd = r.dataset.folder!; void load(); }));

    ctx.el.querySelector<HTMLButtonElement>('button[data-act="mkdir"]')!
      .addEventListener('click', async () => {
        const name = window.prompt('New folder name'); if (!name) return;
        const path = cwd ? `${cwd}/${name}` : name;
        const r = await authFetch(`/gw/projects/${encodeURIComponent(projectId)}/files/folder`,
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) });
        if (r.ok) { toast(`Folder created: ${name}`); void load(); }
        else showMsg(`<div class="alert-banner" style="background:var(--alert-50);color:var(--alert)">Could not create folder: ${esc(await errText(r))}</div>`);
      });

    ctx.el.querySelector<HTMLInputElement>('input[data-act="upload"]')!
      .addEventListener('change', async (e) => {
        const f = (e.currentTarget as HTMLInputElement).files?.[0]; if (!f) return;
        const fd = new FormData(); fd.set('path', cwd); fd.set('file', f);
        const r = await authFetch(`/gw/projects/${encodeURIComponent(projectId)}/files/upload`, { method: 'POST', body: fd });
        if (r.ok) { toast(`Uploaded ${f.name}`); void load(); }
        else showMsg(`<div class="alert-banner" style="background:var(--alert-50);color:var(--alert)">Upload failed: ${esc(await errText(r))}</div>`);
      });

    ctx.el.querySelectorAll<HTMLButtonElement>('button[data-send]').forEach(btn =>
      btn.addEventListener('click', () => {
        const filePath = btn.dataset.send!;
        const targets = projects.filter(p => p.id !== projectId);
        showMsg(`
          <div class="prj-send-box">
            <span>Send <code>${esc(filePath.split('/').pop() || filePath)}</code> to</span>
            <select class="prj-send-target">${targets.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>
            <button class="btn btn-sm btn-primary" data-act="do-send">Send</button>
            <button class="btn btn-sm btn-ghost" data-act="cancel-send">Cancel</button>
          </div>`);
        msg.querySelector('[data-act="cancel-send"]')!.addEventListener('click', () => { msg.style.display = 'none'; });
        msg.querySelector('[data-act="do-send"]')!.addEventListener('click', async () => {
          const target = (msg.querySelector('.prj-send-target') as HTMLSelectElement).value;
          const r = await authFetch(`/gw/projects/${encodeURIComponent(projectId)}/send`,
            { method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ target_project_id: target, item_type: 'file', item_ref: filePath }) });
          if (r.ok) { const j = await r.json(); toast(`Sent to ${j.target_name} · received/`); msg.style.display = 'none'; }
          else showMsg(`<div class="alert-banner" style="background:var(--alert-50);color:var(--alert)">Send failed: ${esc(await errText(r))}</div>`);
        });
      }));
  };

  await load();
}

const def: WidgetDef = {
  id: 'ws-project-files',
  reactsTo: ['ws_project'],
  render(ctx) { return draw(ctx); },
};
export default def;
