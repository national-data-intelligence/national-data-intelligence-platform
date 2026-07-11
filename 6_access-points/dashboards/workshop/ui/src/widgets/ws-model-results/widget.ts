/** ws-model-results — a compact "results" panel for the model selected on the
 *  `ws_model` bus dimension: its newest scored performance metrics and the most
 *  recent batch-inference rows. Read-only, real-data-or-empty (never invents
 *  numbers), following the same authFetch + honest-empty pattern as the other
 *  ws-model-* widgets.
 *
 *    GET /gw/ml/{model}/performance?limit=8
 *        → {items:[{model_version,metric,value,sample_size,computed_at,...}]}
 *    GET /gw/ml/{model}/predictions?latest_run=true&limit=12
 *        → {model, rows:[{...flat forecast columns...}], row_count}
 *
 * Placed on the Models page; reacts to the catalogue row-click (ws_model), so
 * it shows the results for whatever model the researcher opened — including a
 * model just retrained/scored by the Airflow batch DAG. */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import { authFetch } from '../../api/useAuth';
import { esc, errText, unwrapList, fmtDateTime } from '../_shared/helpers';

type PerfRow = {
  model_version: string; metric: string;
  value: number | string | null; sample_size: number | null;
  computed_at: string | null;
};

const num = (v: number | string | null | undefined): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const fmtVal = (v: number | string | null | undefined): string => {
  const n = num(v);
  return n == null ? '—' : (Math.abs(n) >= 1000 ? n.toLocaleString() : n.toFixed(3));
};

/** Newest metric per name (performance rows come back newest-first). */
function latestByMetric(rows: PerfRow[]): PerfRow[] {
  const seen = new Set<string>();
  const out: PerfRow[] = [];
  for (const r of rows) {
    if (r.metric && !seen.has(r.metric)) { seen.add(r.metric); out.push(r); }
  }
  return out.slice(0, 4);
}

function perfHtml(rows: PerfRow[]): string {
  if (!rows.length) {
    return `<p class="mdl-note">No performance rows yet — the actuals scorer writes
            accuracy-vs-actuals windows after each scheduled/triggered scoring run.</p>`;
  }
  return `<div class="ws-perf-stats">
    ${rows.map(r => `
      <div class="ws-perf-stat">
        <div class="ws-perf-stat-v">${esc(fmtVal(r.value))}</div>
        <div class="ws-perf-stat-k">${esc((r.metric || '').toUpperCase())}</div>
        <div class="ws-perf-stat-m">${r.model_version ? 'v' + esc(r.model_version) : ''}${
          r.computed_at ? ' · ' + esc(fmtDateTime(r.computed_at)) : ''}${
          r.sample_size != null ? ' · n=' + esc(String(r.sample_size)) : ''}</div>
      </div>`).join('')}
  </div>`;
}

function predHtml(rows: Record<string, unknown>[]): string {
  if (!rows.length) {
    return `<p class="mdl-note">No inference rows yet — trigger the batch DAG
            (ml_batch_predict) or run the model on your data to populate results.</p>`;
  }
  // Render a compact table from a stable subset of the flat forecast columns
  // that exist across model families; fall back to whatever keys are present.
  const preferred = ['disease', 'district', 'year', 'week', 'alarm_prob',
                     'predicted_value', 'model_version'];
  const present = preferred.filter(c => c in rows[0]);
  const cols = present.length ? present : Object.keys(rows[0]).slice(0, 6);
  return `<div class="art-schema mdl-scroll-x"><table>
    <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>
      ${rows.slice(0, 12).map(r => `<tr>${cols.map(c => {
        const v = r[c];
        const isNum = typeof v === 'number' || (v != null && v !== '' && !isNaN(Number(v)) && /prob|value|year|week/.test(c));
        return `<td>${isNum ? esc(fmtVal(v as number)) : esc(v == null ? '—' : String(v))}</td>`;
      }).join('')}</tr>`).join('')}
    </tbody>
  </table></div>`;
}

async function draw(ctx: WidgetCtx): Promise<void> {
  const model = ctx.filters.ws_model || '';
  if (!model) {
    ctx.empty('Select a model in the catalogue above to see its latest results — scored metrics and recent inference output.');
    return;
  }

  let perf: PerfRow[] = [];
  let preds: Record<string, unknown>[] = [];
  let perfErr = '';
  let predErr = '';

  try {
    const r = await authFetch(`/gw/ml/${encodeURIComponent(model)}/performance?limit=8`);
    if (r.ok) perf = unwrapList<PerfRow>(await r.json(), 'items');
    else perfErr = await errText(r);
  } catch (e) { perfErr = String(e); }

  try {
    const r = await authFetch(`/gw/ml/${encodeURIComponent(model)}/predictions?latest_run=true&limit=12`);
    if (r.ok) preds = unwrapList<Record<string, unknown>>(await r.json(), 'rows');
    else predErr = await errText(r);
  } catch (e) { predErr = String(e); }

  ctx.el.innerHTML = `
    <div class="ws-model-results">
      <div>
        <div class="mdl-section-h">Latest scored metrics — <code>${esc(model)}</code></div>
        ${perfErr ? `<p class="mdl-note">Performance endpoint unavailable — ${esc(perfErr)}</p>`
                  : perfHtml(latestByMetric(perf))}
      </div>
      <div>
        <div class="mdl-section-h">Recent inference results${
          preds.length ? ` <span class="muted">(${preds.length} rows, latest run)</span>` : ''}</div>
        ${predErr ? `<p class="mdl-note">Predictions endpoint unavailable — ${esc(predErr)}</p>`
                  : predHtml(preds)}
      </div>
    </div>`;
}

const def: WidgetDef = {
  id: 'ws-model-results',
  reactsTo: ['ws_model'],
  render(ctx) { return draw(ctx); },
};
export default def;
