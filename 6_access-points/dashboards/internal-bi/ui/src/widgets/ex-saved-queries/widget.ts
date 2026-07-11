/** ex-saved-queries — the signed-in user's saved queries.
 *
 * GET /gw/queries/mine (owner-scoped by kc_sub) lists them; POST
 * /gw/queries/{id}/touch-run stamps a run; DELETE /gw/queries/{id} removes one.
 * Honest empty state when the user has saved none. NO fabricated rows. */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import { authFetch } from '../../api/useAuth';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

function relTime(iso: string | null): string {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return esc(iso);
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

async function draw(ctx: WidgetCtx) {
  const { theme } = ctx;
  let rows: any[];
  try {
    const r = await authFetch('/gw/queries/mine?limit=100');
    if (!r.ok) { ctx.empty('Could not load your saved queries.'); return; }
    rows = await r.json();
  } catch { ctx.empty('Could not load your saved queries.'); return; }
  if (!Array.isArray(rows) || !rows.length) {
    ctx.empty('No saved queries yet — save one from the SQL editor to re-run or schedule it.');
    return;
  }

  const sharePill: Record<string, string> = {
    private: theme.ink[2], shared: theme.status.info, public: theme.status.good,
  };
  const body = rows.map(q => {
    const desc = q.description ? `<div style="font-size:.78rem;color:${theme.ink[2]};margin-top:.15rem">${esc(q.description)}</div>` : '';
    const scope = Array.isArray(q.mart_scope) && q.mart_scope.length
      ? `<code style="font-size:.78rem">${esc(q.mart_scope.join(', '))}</code>` : '<span style="color:#9a9384">—</span>';
    const sched = q.schedule_cron ? `<span class="pill info">${esc(q.schedule_cron)}</span>` : '<span class="pill">manual</span>';
    const sc = sharePill[q.share_scope] || theme.ink[2];
    return `<tr data-qid="${esc(q.id)}">
      <td><strong>${esc(q.title)}</strong>${desc}</td>
      <td>${scope}</td>
      <td><span style="color:${sc};font-weight:600;text-transform:capitalize">${esc(q.share_scope)}</span></td>
      <td title="${esc(q.last_run_at)}">${relTime(q.last_run_at)}</td>
      <td>${sched}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm btn-primary" data-act="run" data-qid="${esc(q.id)}">Run</button>
        <button class="btn btn-sm btn-ghost" data-act="del" data-qid="${esc(q.id)}">Delete</button>
      </td>
    </tr>`;
  }).join('');

  ctx.el.innerHTML = `
    <div class="scrollable" style="overflow-x:auto">
      <table class="dash" style="margin:0;width:100%">
        <thead><tr>
          <th>Name</th><th>Datasets</th><th>Sharing</th><th>Last run</th><th>Schedule</th><th></th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;

  ctx.el.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.qid!;
      const act = btn.dataset.act!;
      btn.disabled = true;
      try {
        if (act === 'run') {
          await authFetch(`/gw/queries/${encodeURIComponent(id)}/touch-run`, { method: 'POST' });
        } else if (act === 'del') {
          if (!window.confirm('Delete this saved query? This cannot be undone.')) { btn.disabled = false; return; }
          await authFetch(`/gw/queries/${encodeURIComponent(id)}`, { method: 'DELETE' });
        }
      } catch { /* failure is reflected by the unchanged list after re-draw */ }
      finally {
        await draw(ctx);   // re-fetch + re-render to reflect the change
      }
    });
  });
}

const def: WidgetDef = {
  id: 'ex-saved-queries',
  reactsTo: [],
  render(ctx) { return draw(ctx); },
};
export default def;
