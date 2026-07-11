/** ex-sql-editor — ad-hoc, read-only SQL against the governed marts.
 *
 * POST /gw/sql/execute { sql, limit } runs one read-only statement through
 * Trino with per-referenced-table OPA enforcement, returning
 * { columns, rows, row_count, elapsed_ms, tables_used }. GET /gw/marts lists
 * the bi_% marts for a click-to-insert browser (the list is a navigation aid,
 * not permission-filtered — a mart may 403 on Run). Errors surface from the
 * server's { detail } (400 = query error, 403 = access denied). No fabricated
 * results — the legacy page's canned 14-row table is gone. */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import { authFetch } from '../../api/useAuth';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

const PLACEHOLDER = 'SELECT * FROM bi_facility.mart_equipment_availability LIMIT 100';

async function loadMarts(ctx: WidgetCtx, listEl: HTMLElement, ta: HTMLTextAreaElement) {
  const { theme } = ctx;
  let rows: any[] = [];
  try {
    const r = await authFetch('/gw/marts');
    if (r.ok) { const j = await r.json(); rows = Array.isArray(j.rows) ? j.rows : []; }
  } catch { /* leave empty */ }
  if (!rows.length) { listEl.innerHTML = `<p style="font-size:.8rem;color:${theme.ink[2]};margin:.3rem">No marts listed.</p>`; return; }

  const groups: Record<string, string[]> = {};
  rows.forEach(m => { (groups[m.table_schema] ||= []).push(m.table_name); });
  const render = (filter: string) => {
    const f = filter.toLowerCase();
    listEl.innerHTML = Object.entries(groups).map(([schema, tables]) => {
      const items = tables.filter(t => !f || `${schema}.${t}`.toLowerCase().includes(f)).map(t =>
        `<button class="mart-item" data-fq="${esc(schema)}.${esc(t)}" style="display:block;width:100%;text-align:left;border:0;background:none;
           cursor:pointer;padding:.25rem .4rem;font-family:${theme.fontMono};font-size:.78rem;color:${theme.ink[0]};border-radius:5px">
           ${esc(schema)}.<strong>${esc(t)}</strong></button>`).join('');
      return items ? `<div style="margin-bottom:.5rem">
        <div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.03em;color:${theme.ink[2]};margin:.2rem .4rem">${esc(schema)}</div>${items}</div>` : '';
    }).join('') || `<p style="font-size:.8rem;color:${theme.ink[2]};margin:.3rem">No match.</p>`;
    listEl.querySelectorAll<HTMLButtonElement>('.mart-item').forEach(b => {
      b.addEventListener('click', () => {
        const fq = b.dataset.fq!;
        const start = ta.selectionStart ?? ta.value.length;
        ta.setRangeText(fq, start, ta.selectionEnd ?? start, 'end');
        ta.focus();
      });
    });
  };
  render('');
  return render;
}

function renderResult(ctx: WidgetCtx, resEl: HTMLElement, data: any) {
  const { theme } = ctx;
  const cols: string[] = data.columns || [];
  const rows: any[] = data.rows || [];
  const meta = `${data.row_count ?? rows.length} row${(data.row_count ?? rows.length) === 1 ? '' : 's'} · ${data.elapsed_ms ?? '-'} ms`
    + (data.tables_used?.length ? ` · ${esc(data.tables_used.join(', '))}` : '');
  if (!rows.length) {
    resEl.innerHTML = `<div style="font-size:.82rem;color:${theme.ink[2]};padding:.4rem 0">${meta} — no rows.</div>`;
    return;
  }
  const head = cols.map(c => `<th>${esc(c)}</th>`).join('');
  const body = rows.map(row => `<tr>${cols.map(c => {
    const v = row[c];
    return `<td>${v == null ? '<span style="color:#9a9384">NULL</span>' : esc(v)}</td>`;
  }).join('')}</tr>`).join('');
  resEl.innerHTML = `
    <div style="font-size:.8rem;color:${theme.ink[2]};margin:.35rem 0">${meta}</div>
    <div class="scrollable" style="overflow:auto;max-height:420px">
      <table class="dash sr-table" style="margin:0;width:100%">
        <thead><tr>${head}</tr></thead><tbody>${body}</tbody>
      </table>
    </div>`;
}

function renderError(ctx: WidgetCtx, resEl: HTMLElement, status: number, detail: string) {
  const { theme } = ctx;
  const denied = status === 403;
  const color = denied ? theme.status.alert : theme.status.watch;
  resEl.innerHTML = `
    <div style="margin:.35rem 0;padding:.55rem .7rem;border:1px solid ${color};border-radius:7px;background:${color}12">
      <div style="font-size:.8rem;font-weight:700;color:${color}">${denied ? 'Access denied' : 'Query error'}</div>
      <div style="font-size:.82rem;color:${theme.ink[0]};margin-top:.2rem;white-space:pre-wrap">${esc(detail)}</div>
    </div>`;
}

const def: WidgetDef = {
  id: 'ex-sql-editor',
  reactsTo: [],
  render(ctx) {
    const { theme } = ctx;
    ctx.el.innerHTML = `
      <div style="display:grid;grid-template-columns:1.7fr 1fr;gap:1rem;align-items:start">
        <div style="min-width:0">
          <textarea data-sql spellcheck="false" style="width:100%;min-height:225px;resize:vertical;
            font-family:${theme.fontMono};font-size:.84rem;line-height:1.5;padding:.6rem .7rem;
            border:1px solid ${theme.line};border-radius:8px;color:${theme.ink[0]};background:#F5F7FA;
            box-shadow:inset 0 1px 2px rgba(15,23,42,0.05)"
            placeholder="${PLACEHOLDER}"></textarea>
          <div style="display:flex;align-items:center;gap:.6rem;margin:.5rem 0">
            <button class="btn btn-sm btn-primary" data-run>Run query</button>
            <label style="font-size:.78rem;color:${theme.ink[2]};display:flex;align-items:center;gap:.35rem">
              limit <input data-limit type="number" value="500" min="1" max="5000" style="width:76px"/></label>
            <span style="font-size:.76rem;color:${theme.ink[2]}">read-only · OPA-enforced per table · ⌘/Ctrl+Enter to run</span>
          </div>
          <div data-result></div>
        </div>
        <div style="min-width:0;border:1px solid ${theme.line};border-radius:8px;padding:.55rem">
          <div style="font-size:.82rem;font-weight:600;color:${theme.ink[0]};margin-bottom:.3rem">Available marts</div>
          <input data-mart-filter type="text" placeholder="filter marts…" class="search-input" style="width:100%;margin-bottom:.4rem"/>
          <div data-mart-list style="max-height:420px;overflow:auto"></div>
        </div>
      </div>`;

    const ta = ctx.el.querySelector<HTMLTextAreaElement>('[data-sql]')!;
    const resEl = ctx.el.querySelector<HTMLElement>('[data-result]')!;
    const listEl = ctx.el.querySelector<HTMLElement>('[data-mart-list]')!;
    const filterEl = ctx.el.querySelector<HTMLInputElement>('[data-mart-filter]')!;
    const runBtn = ctx.el.querySelector<HTMLButtonElement>('[data-run]')!;
    const limitEl = ctx.el.querySelector<HTMLInputElement>('[data-limit]')!;

    let rerenderList: ((f: string) => void) | undefined;
    loadMarts(ctx, listEl, ta).then(fn => { rerenderList = fn as any; });
    filterEl.addEventListener('input', () => rerenderList?.(filterEl.value));

    async function run() {
      const sql = ta.value.trim() || PLACEHOLDER;
      const limit = Math.max(1, Math.min(5000, Number(limitEl.value) || 500));
      runBtn.disabled = true;
      const prev = runBtn.textContent; runBtn.textContent = 'Running…';
      resEl.innerHTML = `<div style="font-size:.82rem;color:${theme.ink[2]};padding:.4rem 0">Running…</div>`;
      try {
        const r = await authFetch('/gw/sql/execute', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql, limit }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) renderResult(ctx, resEl, j);
        else renderError(ctx, resEl, r.status, j.detail || `Request failed (${r.status}).`);
      } catch (e: any) {
        renderError(ctx, resEl, 0, e?.message || 'Network error.');
      } finally {
        runBtn.disabled = false; runBtn.textContent = prev;
      }
    }
    runBtn.addEventListener('click', run);
    ta.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); }
    });
  },
};
export default def;
