/** ws-model-workbench — the combined model detail + interact panel.
 *  reactsTo `ws_model` (published by ws-models-table); instructive empty
 *  state until a model is selected.
 *
 *   GET  /gw/ml/{model}                 facts: aliases, deployment, last run,
 *                                       registry description (the model card
 *                                       text the runner set from the package
 *                                       manifest — the only real card source)
 *   GET  /gw/ml/{model}/versions        registry versions (aliases merged from
 *                                       the detail payload — the versions
 *                                       route's per-version aliases are empty)
 *   GET  /gw/ml/{model}/predictions?limit=6   latest stored batch sample
 *   POST /gw/ml/{model}/predict         async ad-hoc predict → runner Job;
 *   GET  /gw/ml/jobs/{id}               poll ~10-30 s → presigned result CSV
 *   GET  /gw/ml/{model}/runs            the runner's VERBATIM error after a
 *                                       failed Job (the k8s condition only
 *                                       says "backoff limit reached")
 *
 * Ported faithfully from the bespoke sections/ModelDetail.tsx (incl. the
 * PredictRunner paste/file modes and error surfacing). */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import {
  getModel, listVersions, listPredictions, submitPredict, getJob, listRuns,
  fmtEpochMs, fmtDateTime, fmtNum, fmtProb, aliasPillClass,
  type MlModelDetail, type MlVersion, type MlPredictionRow, type MlJobStatus,
} from '../../api/ml';
import { esc } from '../_shared/helpers';

const SAMPLE_LIMIT = 6;

function runStatusPill(status: string): string {
  return status === 'success' ? 'good'
       : status === 'failed' ? 'alert'
       : 'watch';
}

function fact(icon: string, label: string, valueHtml: string): string {
  return `
    <div class="mdl-fact">
      <svg class="ico"><use href="#${icon}"/></svg>
      <div>
        <div class="mdl-fact-lbl">${esc(label)}</div>
        <div class="mdl-fact-val">${valueHtml}</div>
      </div>
    </div>`;
}

function versionsHtml(versions: MlVersion[] | null, err: string | null,
                      modelAliases: Record<string, string>): string {
  if (err) return `<p class="mdl-note alert">Failed to load versions: ${esc(err)}</p>`;
  if (versions === null) return `<p class="muted">Loading versions…</p>`;
  if (!versions.length) return `<p class="mdl-note">No versions registered yet.</p>`;
  const aliasesFor = (version: string): string[] => {
    const fromDetail = Object.entries(modelAliases)
      .filter(([, v]) => v === version).map(([a]) => a);
    return [...new Set([...fromDetail, ...(versions.find(x => x.version === version)?.aliases ?? [])])];
  };
  return `
    <div class="art-schema mdl-scroll-x">
      <table>
        <thead><tr><th>Version</th><th>Alias</th><th>Registered</th><th>MLflow run</th></tr></thead>
        <tbody>
          ${versions.map(v => {
            const aliases = aliasesFor(v.version);
            return `
            <tr>
              <td><code>v${esc(v.version)}</code></td>
              <td>${aliases.length
                ? aliases.map(a => `<span class="pill ${esc(aliasPillClass(a))}">@${esc(a)}</span>`).join(' ')
                : '<span class="muted">—</span>'}</td>
              <td>${esc(fmtEpochMs(v.creation_timestamp))}</td>
              <td>${v.run_id ? `<code title="${esc(v.run_id)}">${esc(v.run_id.slice(0, 12))}…</code>` : '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function predictionsHtml(rows: MlPredictionRow[] | null, err: string | null): string {
  if (err) return `<p class="mdl-note alert">Failed to load predictions: ${esc(err)}</p>`;
  if (rows === null) return `<p class="muted">Loading predictions…</p>`;
  if (!rows.length) {
    return `<p class="mdl-note">No stored predictions yet — rows appear in
      <code>ops_ml.ml_predictions</code> after the model's first successful batch run.</p>`;
  }
  const hasDisease = rows.some(r => r.disease !== '');
  return `
    <p class="mdl-note">Sample from the latest successful batch run — most recent target
      week first, highest alarm probability at the top (first ${rows.length} rows shown).</p>
    <div class="art-schema mdl-scroll-x">
      <table>
        <thead><tr>
          ${hasDisease ? '<th>Disease</th>' : ''}
          <th>${hasDisease ? 'District' : 'District / item'}</th>
          <th>Week</th><th>Forecast (95% band)</th><th>Alarm</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              ${hasDisease ? `<td><code>${esc(r.disease || '—')}</code></td>` : ''}
              <td><code>${esc(r.district)}</code></td>
              <td>${esc(r.year)}·W${esc(r.week)}</td>
              <td>${esc(fmtNum(r.pred_cases_mean))}${(r.pred_cases_lwr95 != null && r.pred_cases_upr95 != null)
                ? ` <span class="muted">[${esc(fmtNum(r.pred_cases_lwr95))}–${esc(fmtNum(r.pred_cases_upr95))}]</span>` : ''}</td>
              <td>${r.alarm_flag === 1
                ? `<span class="pill alert">alarm · ${esc(fmtProb(r.alarm_prob))}</span>`
                : `<span class="muted">${esc(fmtProb(r.alarm_prob))}</span>`}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/* ── async predict runner (ported PredictRunner) ─────────────────────── */

type RunPhase = 'idle' | 'submitting' | 'running' | 'succeeded' | 'failed';

function mountPredictRunner(el: HTMLElement, model: string): () => void {
  const state = {
    mode: 'paste' as 'paste' | 'file',
    pasteText: '',
    fileText: '',
    fileName: '',
    phase: 'idle' as RunPhase,
    jobId: null as string | null,
    job: null as MlJobStatus | null,
    error: null as string | null,
    elapsed: 0,
    start: 0,
  };
  let pollIv: number | undefined;
  let tickIv: number | undefined;
  let disposed = false;

  const stopTimers = () => {
    if (pollIv) { window.clearInterval(pollIv); pollIv = undefined; }
    if (tickIv) { window.clearInterval(tickIv); tickIv = undefined; }
  };

  const csv = () => (state.mode === 'file' ? state.fileText : state.pasteText);

  const startPolling = () => {
    // Poll the runner Job every 2.5 s while it runs. Transient poll errors
    // don't abort the loop — the Job keeps running server-side regardless.
    pollIv = window.setInterval(async () => {
      if (state.phase !== 'running' || !state.jobId) return;
      try {
        const j = await getJob(state.jobId);
        if (disposed) return;
        state.job = j;
        if (j.status === 'succeeded') {
          state.phase = 'succeeded';
          stopTimers();
          paint();
        } else if (j.status === 'failed') {
          // The Job condition only carries the generic "backoff limit" text;
          // the runner's real error (e.g. the exact signature mismatch) is
          // recorded in ops_ml.ml_run.error_msg — fetch the matching ad-hoc
          // run and surface it verbatim.
          let msg = j.error || 'runner job failed (no error message reported)';
          try {
            const runs = await listRuns(model, 10);
            const detailed = runs.find(r =>
              r.trigger_kind === 'api' && r.status === 'failed' && !!r.error_msg &&
              !!r.started_at &&
              new Date(r.started_at).getTime() >= state.start - 120_000);
            if (detailed?.error_msg) msg = detailed.error_msg;
          } catch { /* keep the Job condition message */ }
          if (disposed) return;
          state.error = msg;
          state.phase = 'failed';
          stopTimers();
          paint();
        }
      } catch { /* transient — next tick retries */ }
    }, 2500);
    // 1-second elapsed ticker while the job is in flight.
    tickIv = window.setInterval(() => {
      state.elapsed = Math.round((Date.now() - state.start) / 1000);
      const t = el.querySelector<HTMLElement>('.mdl-run-elapsed');
      if (t) t.textContent = `${state.elapsed}s`;
    }, 1000);
  };

  const run = async () => {
    if (!csv().trim()) return;
    state.error = null;
    state.job = null;
    state.jobId = null;
    state.start = Date.now();
    state.elapsed = 0;
    state.phase = 'submitting';
    paint();
    try {
      const sub = await submitPredict(model, { csv: csv() });
      if (disposed) return;
      state.jobId = sub.job_id;
      state.phase = 'running';
      paint();
      startPolling();
    } catch (e: any) {
      if (disposed) return;
      state.error = e?.message || String(e);
      state.phase = 'failed';
      stopTimers();
      paint();
    }
  };

  const reset = () => {
    stopTimers();
    state.phase = 'idle';
    state.jobId = null;
    state.job = null;
    state.error = null;
    state.elapsed = 0;
    paint();
  };

  function paint() {
    const busy = state.phase === 'submitting' || state.phase === 'running';
    let body: string;
    if (state.phase === 'idle' || state.phase === 'failed') {
      body = `
        <div class="art-scope mdl-run-mode" role="group" aria-label="Input mode">
          <button type="button" class="art-scope-btn${state.mode === 'paste' ? ' active' : ''}" data-mode="paste">Paste CSV</button>
          <button type="button" class="art-scope-btn${state.mode === 'file' ? ' active' : ''}" data-mode="file">Upload CSV</button>
        </div>
        ${state.mode === 'paste'
          ? `<textarea class="mdl-run-csv" rows="5" aria-label="CSV input"
               placeholder="header row, then data rows — e.g.\ncol_a,col_b,…\nvalue,value,…">${esc(state.pasteText)}</textarea>`
          : `<label class="mdl-run-file">
               <input type="file" accept=".csv,text/csv">
               <svg class="ico"><use href="#i-upload"/></svg>
               <span>${state.fileName
                 ? `${esc(state.fileName)} · ${state.fileText.length.toLocaleString()} characters`
                 : 'Choose a .csv file'}</span>
             </label>`}
        ${state.phase === 'failed' && state.error ? `
          <div class="alert-banner" style="background:var(--alert-50);color:var(--alert)">
            <div style="min-width:0;flex:1">
              <div>Prediction failed${state.jobId ? ` — runner job <code>${esc(state.jobId)}</code> reported:` : ':'}</div>
              <pre class="mdl-run-err">${esc(state.error)}</pre>
            </div>
          </div>` : ''}
        <div class="mdl-run-actions">
          <button class="btn btn-primary" data-act="run"${csv().trim() ? '' : ' disabled'}>
            <svg class="ico"><use href="#i-play"/></svg>
            ${state.phase === 'failed' ? 'Try again' : 'Run prediction'}</button>
          ${state.phase === 'failed' ? '<button class="btn btn-ghost" data-act="reset">Clear</button>' : ''}
        </div>`;
    } else if (state.phase === 'succeeded' && state.job) {
      const job = state.job;
      body = `
        <div class="mdl-run-done">
          <p><span class="pill good">succeeded</span>
            Runner job <code>${esc(job.job_id)}</code> finished${job.completion_time ? ` at ${esc(fmtDateTime(job.completion_time))}` : ''}
            (${state.elapsed}s from submit).</p>
          ${job.result_url
            ? `<a class="btn btn-primary" href="${esc(job.result_url)}">
                 <svg class="ico"><use href="#i-download"/></svg> Download result CSV</a>`
            : `<div class="alert-banner" style="background:var(--watch-50);color:var(--watch)">
                 The result CSV is stored at <code>${esc(job.result_uri || 'unknown')}</code>, but a
                 browser download link could not be signed — ask an operator to fetch it.</div>`}
          <div class="mdl-run-actions">
            <button class="btn btn-ghost btn-sm" data-act="reset">Run another prediction</button>
          </div>
        </div>`;
    } else {
      body = `
        <div class="mdl-run-progress" role="status">
          <span class="mdl-spinner" aria-hidden="true"></span>
          <div>
            <strong>${state.phase === 'submitting'
              ? 'Uploading your CSV and creating the runner job…'
              : 'Model running in the cluster…'}</strong>
            <div class="muted">
              ${state.jobId ? `job <code>${esc(state.jobId)}</code> · ` : ''}
              <span class="mdl-run-elapsed">${state.elapsed}s</span> elapsed — typically 10–30s.
              The job keeps running if you navigate away.</div>
          </div>
        </div>`;
    }

    el.innerHTML = `
      <div class="mdl-run">
        <div class="mdl-run-hdr">
          <svg class="ico"><use href="#i-play"/></svg>
          <h4>Run this model on your data</h4>
        </div>
        <p class="mdl-note">
          Submitting creates a one-off runner job in the cluster that loads
          <code>${esc(model)}@champion</code>, scores your CSV and stores the result —
          <strong>this takes roughly 10–30 seconds</strong>; the result is a
          downloadable CSV, not an instant answer.</p>
        <p class="mdl-note">
          Your CSV must match the model's input signature
          (<code>feature_spec.yaml → input.signature</code> in the model package).
          The gateway does not expose the signature, so the required columns can't
          be listed here — the runner validates the upload against the real
          signature and any mismatch is reported below verbatim.</p>
        ${body}
      </div>`;

    // wire events for the current phase
    el.querySelectorAll<HTMLButtonElement>('button[data-mode]').forEach(b =>
      b.addEventListener('click', () => { state.mode = b.dataset.mode as 'paste' | 'file'; paint(); }));
    const ta = el.querySelector<HTMLTextAreaElement>('textarea.mdl-run-csv');
    if (ta) ta.addEventListener('input', () => {
      state.pasteText = ta.value;
      const btn = el.querySelector<HTMLButtonElement>('button[data-act="run"]');
      if (btn) btn.disabled = !csv().trim();
    });
    const fi = el.querySelector<HTMLInputElement>('.mdl-run-file input[type="file"]');
    if (fi) fi.addEventListener('change', async () => {
      const f = fi.files?.[0];
      if (!f) return;
      state.fileName = f.name;
      state.fileText = await f.text();
      if (!disposed) paint();
    });
    el.querySelector<HTMLButtonElement>('button[data-act="run"]')
      ?.addEventListener('click', () => { void run(); });
    el.querySelectorAll<HTMLButtonElement>('button[data-act="reset"]').forEach(b =>
      b.addEventListener('click', reset));
    void busy;
  }

  paint();
  return () => { disposed = true; stopTimers(); };
}

/* ── the widget ──────────────────────────────────────────────────────── */

async function draw(ctx: WidgetCtx): Promise<void | (() => void)> {
  const model = ctx.filters.ws_model || '';
  if (!model) {
    ctx.empty('Select a model in the catalogue above to open its workbench — facts, versions, latest predictions and the predict runner.');
    return;
  }

  let detail: MlModelDetail | null = null;
  let detailErr = '';
  let versions: MlVersion[] | null = null;
  let versionsErr: string | null = null;
  let preds: MlPredictionRow[] | null = null;
  let predsErr: string | null = null;
  const [dRes, vRes, pRes] = await Promise.allSettled([
    getModel(model),
    listVersions(model),
    listPredictions(model, { limit: SAMPLE_LIMIT }),
  ]);
  if (dRes.status === 'fulfilled') detail = dRes.value; else detailErr = dRes.reason?.message || String(dRes.reason);
  if (vRes.status === 'fulfilled') versions = vRes.value; else versionsErr = vRes.reason?.message || String(vRes.reason);
  if (pRes.status === 'fulfilled') preds = pRes.value; else predsErr = pRes.reason?.message || String(pRes.reason);

  if (!detail) {
    ctx.empty(`Failed to load model “${model}” — ${detailErr}`);
    return;
  }

  const aliases = Object.entries(detail.aliases ?? {});
  const run = detail.last_run;

  ctx.el.innerHTML = `
    <div class="mdl-detail" style="position:static;max-height:none;border:none;box-shadow:none;padding:0">
      <div class="mdl-detail-badges">
        ${aliases.length
          ? aliases.map(([a, v]) => `<span class="pill ${esc(aliasPillClass(a))}">@${esc(a)} v${esc(v)}</span>`).join(' ')
          : '<span class="pill neutral">no alias set</span>'}
        <span class="pill neutral">${esc(detail.deployment_kind)}</span>
        ${detail.enabled === false ? '<span class="pill neutral">paused</span>' : ''}
      </div>
      <h3 class="mdl-detail-name">${esc(detail.model)}</h3>

      ${detail.description
        ? `<p class="mdl-detail-desc">${esc(detail.description)}</p>`
        : `<p class="mdl-note">This model has no description in the registry — its package manifest carried none.</p>`}

      <div class="mdl-facts">
        ${fact('i-shield-check', 'Serving version', detail.champion_version
          ? `v${esc(detail.champion_version)} <span class="muted">via @${esc(detail.deployment?.model_alias || 'champion')}</span>`
          : 'none promoted')}
        ${fact('i-calendar', 'Schedule', detail.schedule
          ? `weekly batch · <code>${esc(detail.schedule)}</code>`
          : detail.deployment_kind === 'batch' ? 'batch (no schedule row)' : 'on demand')}
        ${fact('i-refresh', 'Last run', run
          ? `<span class="pill ${esc(runStatusPill(run.status))}">${esc(run.status)}</span>
             ${esc(fmtDateTime(run.finished_at || run.started_at))}${run.row_count != null ? ` <span class="muted">· ${esc(fmtNum(run.row_count, 0))} rows</span>` : ''}`
          : 'no runs recorded')}
        ${fact('i-clock', 'Registry updated',
          `${esc(fmtEpochMs(detail.last_updated))}${detail.latest_version ? ` <span class="muted">· latest v${esc(detail.latest_version)}</span>` : ''}`)}
      </div>
      ${run?.status === 'failed' && run.error_msg ? `
        <div class="alert-banner" style="background:var(--alert-50);color:var(--alert)">
          Last run failed: ${esc(run.error_msg)}</div>` : ''}

      <div class="mdl-section">
        <h4 class="mdl-section-h">Versions</h4>
        ${versionsHtml(versions, versionsErr, detail.aliases ?? {})}
      </div>

      <div class="mdl-section">
        <h4 class="mdl-section-h">Latest stored predictions</h4>
        ${predictionsHtml(preds, predsErr)}
      </div>

      <div class="mdl-section ws-predict-slot"></div>
    </div>`;

  const runnerCleanup = mountPredictRunner(
    ctx.el.querySelector<HTMLElement>('.ws-predict-slot')!, model);
  return () => { runnerCleanup(); };
}

const def: WidgetDef = {
  id: 'ws-model-workbench',
  reactsTo: ['ws_model'],
  render(ctx) { return draw(ctx); },
};
export default def;
