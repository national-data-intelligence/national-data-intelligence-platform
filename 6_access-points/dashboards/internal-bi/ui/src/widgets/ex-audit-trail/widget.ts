/** ex-audit-trail — the signed-in user's recent data exports.
 *
 * GET /gw/exports/me → the caller's own export jobs (user-scoped by kc_sub in
 * the gateway). Every ad-hoc or template export is written to ops_export and
 * shown here with its status, dataset, format and size. Honest empty state
 * when the user hasn't exported anything yet. NO fabricated audit rows. */
import type { WidgetDef } from '../../runtime/types';
import { authFetch } from '../../api/useAuth';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

function relTime(iso: string | null): string {
  if (!iso) return '-';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return esc(iso);
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function fmtBytes(n: number | null): string {
  if (n == null) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

const def: WidgetDef = {
  id: 'ex-audit-trail',
  reactsTo: [],
  async render(ctx) {
    const { theme } = ctx;
    let rows: any[];
    try {
      const r = await authFetch('/gw/exports/me?limit=25');
      if (!r.ok) { ctx.empty('Could not load your export history.'); return; }
      rows = await r.json();
    } catch { ctx.empty('Could not load your export history.'); return; }
    if (!Array.isArray(rows) || !rows.length) {
      ctx.empty('No exports yet — run a query or template export and it will be logged here.');
      return;
    }

    const statusColor: Record<string, string> = {
      ready: theme.status.good, pending: theme.status.watch, failed: theme.status.alert,
    };
    const body = rows.map(x => {
      const report = Array.isArray(x.mart_scope) && x.mart_scope.length ? x.mart_scope.join(', ') : '-';
      const sc = statusColor[x.status] || theme.ink[2];
      // Only render a link for an http(s) URL — never let a non-http scheme
      // (e.g. javascript:) reach an href, even though the gateway issues these.
      const safeUrl = typeof x.download_url === 'string' && /^https?:\/\//i.test(x.download_url);
      const dl = safeUrl
        ? `<a href="${esc(x.download_url)}" target="_blank" rel="noopener" style="color:${theme.navy['700'] || '#1d3557'};font-weight:600;text-decoration:none">Download</a>`
        : '<span style="color:#9a9384">—</span>';
      return `<tr>
        <td title="${esc(x.requested_at)}">${relTime(x.requested_at)}</td>
        <td><code style="font-size:.82rem">${esc(report)}</code></td>
        <td><span class="ck-fmt">${esc((x.format || '').toUpperCase())}</span></td>
        <td class="num">${x.row_count == null ? '-' : Number(x.row_count).toLocaleString()}</td>
        <td class="num">${fmtBytes(x.byte_count)}</td>
        <td><span style="color:${sc};font-weight:600;text-transform:capitalize">${esc(x.status)}</span></td>
        <td>${dl}</td>
      </tr>`;
    }).join('');

    ctx.el.innerHTML = `
      <div class="scrollable" style="overflow-x:auto">
        <table class="dash" style="margin:0;width:100%">
          <thead><tr>
            <th>Requested</th><th>Dataset</th><th>Format</th>
            <th class="num">Rows</th><th class="num">Size</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  },
};
export default def;
