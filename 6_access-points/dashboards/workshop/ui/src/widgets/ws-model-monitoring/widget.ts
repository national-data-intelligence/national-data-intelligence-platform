/** ws-model-monitoring — drift + performance from ops_ml, for the model
 *  selected on the `ws_model` bus dimension.
 *
 *   GET /gw/ml/{model}/drift?limit=200
 *       → {items:[{feature,kind,psi,ks,psi_threshold,drifted,computed_at,note}]}
 *   GET /gw/ml/{model}/performance?limit=200
 *       → {items:[{model_version,window_start,window_end,metric,value,
 *                  sample_size,computed_at}]}
 *
 * Rendering follows the dataviz rules: single-hue marks from the theme
 * (magnitude is not identity — no categorical palette), status pills carry a
 * text label (never colour alone), one y-axis per chart (multiple metrics →
 * small multiples), recessive grid, native hover tooltips on the points.
 * Honest empty state when no rows exist yet. */
import type { WidgetDef, WidgetCtx, Theme } from '../../runtime/types';
import { authFetch } from '../../api/useAuth';
import { esc, errText, unwrapList, fmtDate } from '../_shared/helpers';

type DriftRow = {
  feature: string; kind: string; psi: number | string | null;
  ks: number | string | null; psi_threshold: number | string | null;
  drifted: boolean | null; computed_at: string | null; note: string | null;
};
type PerfRow = {
  model_version: string; window_start: string; window_end: string;
  metric: string; value: number | string | null; sample_size: number | null;
  computed_at: string | null;
};

const num = (v: number | string | null | undefined): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* ── drift table (PSI bars + drifted badges) ─────────────────────────── */

function driftHtml(rows: DriftRow[], theme: Theme): string {
  const maxPsi = Math.max(
    0.001,
    ...rows.map(r => num(r.psi) ?? 0),
    ...rows.map(r => num(r.psi_threshold) ?? 0),
  ) * 1.15;
  return `
    <div class="art-schema mdl-scroll-x">
      <table>
        <thead><tr>
          <th>Feature</th><th>Kind</th><th style="min-width:180px">PSI</th>
          <th>KS</th><th>State</th><th>Computed</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => {
            const psi = num(r.psi);
            const thr = num(r.psi_threshold);
            const ks = num(r.ks);
            const w = psi != null ? Math.max(1, Math.round((psi / maxPsi) * 100)) : 0;
            const tx = thr != null ? Math.round((thr / maxPsi) * 100) : null;
            return `
            <tr${r.note ? ` title="${esc(r.note)}"` : ''}>
              <td><code>${esc(r.feature)}</code></td>
              <td>${esc(r.kind || '—')}</td>
              <td>
                <div class="ws-psi" title="PSI ${psi != null ? esc(psi.toFixed(3)) : '—'}${thr != null ? ` · threshold ${esc(thr.toFixed(3))}` : ''}">
                  <div class="ws-psi-track">
                    <div class="ws-psi-fill" style="width:${w}%;background:${theme.navy['500']}"></div>
                    ${tx != null ? `<div class="ws-psi-thr" style="left:${tx}%"></div>` : ''}
                  </div>
                  <span class="ws-psi-val">${psi != null ? esc(psi.toFixed(3)) : '—'}</span>
                </div>
              </td>
              <td style="font-variant-numeric:tabular-nums">${ks != null ? esc(ks.toFixed(3)) : '—'}</td>
              <td>${r.drifted
                ? '<span class="pill alert">drifted</span>'
                : '<span class="pill good">stable</span>'}</td>
              <td>${esc(fmtDate(r.computed_at))}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

/* ── performance: a single window is a stat tile; a series is a chart ── */

function perfStat(rows: PerfRow[], metric: string, theme: Theme): string {
  const p = rows.filter(r => r.metric === metric && num(r.value) != null)[0];
  if (!p) return '';
  const v = num(p.value)!;
  const fmtV = (n: number) => Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 1 ? n.toFixed(2) : n.toFixed(3);
  return `
    <div class="ws-perf-stat">
      <div class="ws-perf-stat-val" style="color:${theme.ink[0]}">${esc(fmtV(v))}</div>
      <div class="ws-perf-stat-lbl">${esc(metric)}</div>
      <div class="ws-perf-stat-sub">v${esc(p.model_version)} · ${esc(fmtDate(p.window_end))}${p.sample_size != null ? ` · n=${esc(String(p.sample_size))}` : ''}</div>
    </div>`;
}

function perfChart(rows: PerfRow[], metric: string, theme: Theme): string {
  const pts = rows
    .filter(r => r.metric === metric && num(r.value) != null)
    .sort((a, b) => String(a.window_end).localeCompare(String(b.window_end)));
  if (!pts.length) return '';
  const W = 640, H = 180, padL = 46, padR = 14, padT = 14, padB = 26;
  const vals = pts.map(p => num(p.value)!);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= Math.abs(lo) * 0.1 || 0.1; hi += Math.abs(hi) * 0.1 || 0.1; }
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const x = (i: number) => pts.length === 1
    ? (padL + (W - padL - padR) / 2)
    : padL + (i / (pts.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(num(p.value)!).toFixed(1)}`).join(' ');
  const gridYs = [0, 0.5, 1].map(t => padT + t * (H - padT - padB));
  const gridVals = [hi, (hi + lo) / 2, lo];
  const fmtV = (v: number) => Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3);
  const last = pts[pts.length - 1];
  const lastV = num(last.value)!;
  return `
    <div class="ws-perf-chart">
      <div class="ws-perf-title">${esc(metric)}
        <span class="muted">· ${pts.length} window${pts.length === 1 ? '' : 's'}</span></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(metric)} over time"
           style="width:100%;height:auto;display:block">
        ${gridYs.map((gy, i) => `
          <line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}"
                stroke="${theme.line}" stroke-width="1"/>
          <text x="${padL - 6}" y="${(gy + 3).toFixed(1)}" text-anchor="end"
                font-size="9" fill="${theme.ink[3]}" font-family="${theme.fontSans}">${esc(fmtV(gridVals[i]))}</text>`).join('')}
        <text x="${padL}" y="${H - 8}" font-size="9" fill="${theme.ink[3]}" font-family="${theme.fontSans}">${esc(fmtDate(pts[0].window_end))}</text>
        <text x="${W - padR}" y="${H - 8}" text-anchor="end" font-size="9" fill="${theme.ink[3]}" font-family="${theme.fontSans}">${esc(fmtDate(last.window_end))}</text>
        <path d="${line}" fill="none" stroke="${theme.navy['700']}" stroke-width="2"
              stroke-linejoin="round" stroke-linecap="round"/>
        ${pts.map((p, i) => `
          <circle cx="${x(i).toFixed(1)}" cy="${y(num(p.value)!).toFixed(1)}" r="4"
                  fill="${theme.paper}" stroke="${theme.navy['700']}" stroke-width="1.6">
            <title>${esc(metric)} = ${esc(fmtV(num(p.value)!))}
window ${esc(fmtDate(p.window_start))} → ${esc(fmtDate(p.window_end))}
v${esc(p.model_version)}${p.sample_size != null ? ` · n=${esc(String(p.sample_size))}` : ''}</title>
          </circle>`).join('')}
        <text x="${(x(pts.length - 1) + 7).toFixed(1)}" y="${(y(lastV) - 7).toFixed(1)}"
              font-size="10" font-weight="600" fill="${theme.ink[1]}" font-family="${theme.fontSans}"
              ${x(pts.length - 1) > W - 80 ? 'text-anchor="end"' : ''}>${esc(fmtV(lastV))}</text>
      </svg>
    </div>`;
}

/* ── the widget ──────────────────────────────────────────────────────── */

async function draw(ctx: WidgetCtx) {
  const { theme } = ctx;
  const model = ctx.filters.ws_model || '';
  if (!model) {
    ctx.empty('Select a model in the catalogue above to see its drift and performance monitoring.');
    return;
  }

  let drift: DriftRow[] = [];
  let perf: PerfRow[] = [];
  let driftErr = '';
  let perfErr = '';
  try {
    const r = await authFetch(`/gw/ml/${encodeURIComponent(model)}/drift?limit=200`);
    if (r.ok) drift = unwrapList<DriftRow>(await r.json());
    else driftErr = `HTTP ${r.status}: ${await errText(r)}`;
  } catch (e: any) { driftErr = e?.message || String(e); }
  try {
    const r = await authFetch(`/gw/ml/${encodeURIComponent(model)}/performance?limit=200`);
    if (r.ok) perf = unwrapList<PerfRow>(await r.json());
    else perfErr = `HTTP ${r.status}: ${await errText(r)}`;
  } catch (e: any) { perfErr = e?.message || String(e); }

  if (driftErr && perfErr && !drift.length && !perf.length) {
    ctx.empty(`Monitoring unavailable for ${model} — drift: ${driftErr} · performance: ${perfErr}`);
    return;
  }
  if (!drift.length && !perf.length) {
    ctx.empty(`No monitoring rows yet for ${model} — runs write drift/performance after each scheduled scoring.`);
    return;
  }

  // Drift: keep only the LATEST row per feature (the endpoint returns every
  // run, which stacked the same features 3× and read as noise). One row per
  // feature = the current drift picture.
  const latestByFeature = new Map<string, DriftRow>();
  for (const r of drift) {
    const cur = latestByFeature.get(r.feature);
    if (!cur || String(r.computed_at ?? '') > String(cur.computed_at ?? '')) {
      latestByFeature.set(r.feature, r);
    }
  }
  const latestDrift = [...latestByFeature.values()]
    .sort((a, b) => Number(!!b.drifted) - Number(!!a.drifted)   // drifted first
                 || (num(b.psi) ?? 0) - (num(a.psi) ?? 0));
  const driftedN = latestDrift.filter(r => r.drifted).length;

  // Performance: a metric with one window is a stat tile; a real series is a
  // chart (a full line chart for a single dot was mostly empty space).
  const metrics = [...new Set(perf.map(p => p.metric))];
  const singleMetrics = metrics.filter(m => perf.filter(p => p.metric === m && num(p.value) != null).length === 1);
  const seriesMetrics = metrics.filter(m => perf.filter(p => p.metric === m && num(p.value) != null).length > 1);

  ctx.el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:1.1rem">
      <div>
        <div class="mdl-section-h" style="display:flex;align-items:baseline;gap:.5rem">
          Feature drift
          <span class="pill ${driftedN ? 'alert' : 'good'}">${driftedN ? `${driftedN} drifting` : 'all stable'}</span>
          <span class="muted" style="font-size:.78rem">latest run · ${esc(fmtDate(latestDrift[0]?.computed_at))}</span>
        </div>
        ${latestDrift.length
          ? driftHtml(latestDrift, theme)
          : `<p class="mdl-note">${driftErr
              ? `Drift endpoint unavailable — ${esc(driftErr)}`
              : 'No drift rows yet — runs write PSI/KS vs the training profile after each scheduled scoring.'}</p>`}
      </div>
      <div>
        <div class="mdl-section-h">Performance</div>
        ${(singleMetrics.length || seriesMetrics.length)
          ? `${singleMetrics.length ? `<div class="ws-perf-stats">${singleMetrics.map(m => perfStat(perf, m, theme)).join('')}</div>` : ''}
             ${seriesMetrics.map(m => perfChart(perf, m, theme)).join('')}`
          : `<p class="mdl-note">${perfErr
              ? `Performance endpoint unavailable — ${esc(perfErr)}`
              : 'No performance rows yet — the actuals scorer writes accuracy-vs-actuals windows after each scheduled run.'}</p>`}
      </div>
    </div>`;
}

const def: WidgetDef = {
  id: 'ws-model-monitoring',
  reactsTo: ['ws_model'],
  render(ctx) { return draw(ctx); },
};
export default def;
