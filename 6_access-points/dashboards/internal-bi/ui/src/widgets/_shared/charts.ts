/**
 * Shared chart primitives for internal-BI widgets — thin, theme-driven echarts
 * wrappers. Widgets in THIS dashboard reuse these (funnel, lollipop bar,
 * paginated table); each wrapper takes real, already-shaped data + the resolved
 * theme and returns a cleanup fn (dispose chart + resize listener). No colours
 * or fonts are hardcoded — everything comes from `theme`.
 */
import * as echarts from 'echarts';
import type { Theme } from '../../runtime/types';
import { normRegion, geoNameFor } from './geo';

/** EWARS alarm-probability risk ramp (semantic, like status colours — NOT the
 *  accent). low→high: pale green · green · amber · orange · red. Aligned to the
 *  2026-07-05 cool-slate status palette (tokens.json). Shared by heatmap + donut. */
export const ALARM_RAMP = ['#EAF7F0', '#A7E0C4', '#F5D98A', '#F19A3E', '#EF4444'];
export const alarmBandColor = (p: number): string =>
  p < 0.2 ? '#A7E0C4' : p < 0.5 ? '#F5D98A' : p < 0.8 ? '#F19A3E' : '#EF4444';
/** Stock ramp — low = red (stockout risk), high = green (healthy). Cool palette. */
export const STOCK_RAMP = ['#EF4444', '#F19A3E', '#F5D98A', '#A7E0C4', '#22A06B'];

/** Wire an echarts instance to container resize + return its disposer. */
function bindResize(chart: echarts.ECharts): () => void {
  const onResize = () => chart.resize();
  window.addEventListener('resize', onResize);
  // Also follow the card's own size (grid reflow) via ResizeObserver.
  let ro: ResizeObserver | undefined;
  try {
    ro = new ResizeObserver(() => chart.resize());
    ro.observe(chart.getDom());
  } catch { /* ResizeObserver unavailable — window resize still covers it */ }
  return () => {
    window.removeEventListener('resize', onResize);
    ro?.disconnect();
    chart.dispose();
  };
}

/**
 * Aspect-preserving sizer for fixed-shape charts (funnels, maps). When a
 * permission reflow grows the card to fill horizontal space, a fixed-height
 * chart would just stretch wide-and-short and look wrong. Instead we drive the
 * chart's HEIGHT from its measured WIDTH (height = clamp(width*ratio, min, max))
 * so it grows vertically too and keeps a sensible aspect. We observe the PARENT
 * (`el`), never the host we resize — so setting the height can't feed back into
 * the observer.
 */
function bindAspect(
  el: HTMLElement, host: HTMLElement, chart: echarts.ECharts,
  ratio: number, min: number, max: number,
): () => void {
  const apply = () => {
    const w = el.clientWidth || host.clientWidth || 600;
    const h = Math.max(min, Math.min(max, Math.round(w * ratio)));
    if (host.style.height !== `${h}px`) host.style.height = `${h}px`;
    chart.resize();
  };
  apply();
  const onResize = () => apply();
  window.addEventListener('resize', onResize);
  let ro: ResizeObserver | undefined;
  try { ro = new ResizeObserver(() => apply()); ro.observe(el); } catch { /* window resize covers it */ }
  return () => { window.removeEventListener('resize', onResize); ro?.disconnect(); chart.dispose(); };
}

/** Descending funnel (programme cascades). data = [{name, value}] top→bottom. */
export function funnel(el: HTMLElement, data: { name: string; value: number }[], theme: Theme): () => void {
  const host = document.createElement('div');
  host.style.width = '100%';
  host.style.height = '290px';   // initial; bindAspect drives it from width below
  el.appendChild(host);
  const chart = echarts.init(host);
  const base = data[0]?.value || 1;
  const styled = data.map((d, i) => ({
    ...d,
    itemStyle: {
      color: theme.amber(data.length > 1 ? i / (data.length - 1) : 0),
      borderColor: theme.paper, borderWidth: 1, opacity: 0.95,
    },
  }));
  chart.setOption({
    textStyle: { fontFamily: theme.fontSans },
    tooltip: {
      trigger: 'item',
      formatter: (p: any) => `${p.name}<br/><b>${(+p.value).toLocaleString()}</b> (${((p.value / base) * 100).toFixed(0)}%)`,
    },
    series: [{
      type: 'funnel', sort: 'descending', min: 0, max: base, gap: 2,
      label: {
        position: 'inside', formatter: '{b} · {c}', fontSize: 10.5, color: '#fff',
        fontWeight: 600, textShadowColor: 'rgba(0,0,0,0.35)', textShadowBlur: 2,
      },
      data: styled,
    }],
  });
  // Grow taller as the card widens (permission reflow) so a full-width funnel
  // keeps a sensible aspect instead of stretching wide-and-short.
  return bindAspect(el, host, chart, 0.4, 280, 460);
}

/** Horizontal lollipop bar (ranked coverage/attainment). data = [{name, value}]. */
export function lollipop(
  el: HTMLElement,
  data: { name: string; value: number }[],
  theme: Theme,
  opts: { pct?: boolean; xMax?: number } = {},
): () => void {
  const host = document.createElement('div');
  host.style.height = `${Math.max(200, data.length * 34 + 40)}px`;
  host.style.width = '100%';
  el.appendChild(host);
  const chart = echarts.init(host);
  const fmt = opts.pct ? (v: number) => `${v}%` : (v: number) => `${v}`;
  const vals = data.map(d => d.value);
  const sorted = [...vals].sort((a, b) => a - b);
  const colorFor = (v: number) =>
    theme.amber(1 - (sorted.indexOf(v) / Math.max(1, vals.length - 1)));  // low value = deep amber
  chart.setOption({
    textStyle: { fontFamily: theme.fontSans },
    grid: { left: 180, right: 60, top: 8, bottom: 28 },
    tooltip: { formatter: (p: any) => `${p.name}<br/><b>${fmt(p.value)}</b>` },
    xAxis: {
      type: 'value', max: opts.xMax,
      axisLabel: { fontSize: 9, color: theme.ink[3], formatter: opts.pct ? '{value}%' : '{value}' },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'category', data: data.map(d => d.name),
      axisLabel: { fontSize: 10.5, color: theme.ink[1] },
      axisLine: { show: false }, axisTick: { show: false },
    },
    series: [
      { type: 'bar', barWidth: 2, silent: true, data: vals.map(v => ({ value: v, itemStyle: { color: theme.line } })) },
      {
        type: 'scatter', symbolSize: 14, z: 5,
        data: vals.map(v => ({ value: v, itemStyle: { color: colorFor(v), borderColor: theme.paper, borderWidth: 1.5 } })),
        label: { show: true, position: 'right', fontSize: 10, color: theme.ink[2], formatter: (p: any) => fmt(p.value) },
      },
    ],
  });
  return bindResize(chart);
}

/** Compact BI cascade: one rounded horizontal bar per step, charcoal→blue-gray, label left,
 *  % right (always readable — never white-on-pale, no text-shadow). Pathway order preserved. */
export function barCascade(el: HTMLElement, data: { name: string; pct: number }[], theme: Theme): () => void {
  // Step 1 (100%) darkest charcoal → later steps lighter blue-gray.
  const STOPS = ['#334155', '#475569', '#64748B', '#7E8CA3', '#94A3B8'];
  const stepColor = (i: number) => STOPS[Math.min(STOPS.length - 1, data.length > 1 ? Math.round((i / (data.length - 1)) * (STOPS.length - 1)) : 0)];
  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:.5rem">` + data.map((d, i) => {
    const w = Math.max(3, Math.min(100, d.pct));
    return `<div style="display:flex;align-items:center;gap:.6rem;font-size:.8rem">
      <span style="width:120px;flex-shrink:0;color:${theme.ink[1]};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.name}</span>
      <span style="flex:1;height:20px;border-radius:10px;background:${theme.navy['50']};overflow:hidden">
        <span style="display:block;height:100%;width:${w}%;background:${stepColor(i)};border-radius:10px"></span></span>
      <span style="width:40px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;color:${theme.ink[0]}">${Math.round(d.pct)}%</span>
    </div>`;
  }).join('') + `</div>`;
  return () => {};
}

/** Care-cascade FUNNEL: centered, vertically-stacked tapered trapezoid segments (CSS clip-path,
 *  no bars). Slate ramp light (top / widest) → dark slate (bottom / narrowest); pathway order
 *  preserved. Concise label sits inside each segment with dynamic black/white ink by segment
 *  luminance. A readability floor keeps the narrowest step wide enough to hold its label. */
export function funnelCascade(el: HTMLElement, data: { name: string; pct: number }[], theme: Theme): () => void {
  const n = data.length;
  const STOPS = ['#94A3B8', '#7E8CA3', '#64748B', '#475569', '#334155'];   // light(top) → dark slate(bottom)
  const segColor = (i: number) => STOPS[Math.min(STOPS.length - 1, n > 1 ? Math.round((i / (n - 1)) * (STOPS.length - 1)) : STOPS.length - 1)];
  const ink = (hex: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex); const v = m ? parseInt(m[1], 16) : 0;
    const rgb = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] > 0.21 ? theme.ink[0] : '#ffffff';
  };
  // Proportional to pct, but floored so even the last step can hold its label (48%..100% of column).
  const width = (pct: number) => 48 + 0.52 * Math.max(0, Math.min(100, pct));
  const H = 176, gap = 4;
  const segH = (H - gap * (n - 1)) / n;

  const segs = data.map((d, i) => {
    const topW = width(d.pct);
    const botW = i < n - 1 ? width(data[i + 1].pct) : topW;
    const col = segColor(i);
    const clip = `polygon(${(50 - topW / 2).toFixed(2)}% 0, ${(50 + topW / 2).toFixed(2)}% 0, ${(50 + botW / 2).toFixed(2)}% 100%, ${(50 - botW / 2).toFixed(2)}% 100%)`;
    return `<div style="position:relative;height:${segH.toFixed(1)}px">
        <div style="position:absolute;inset:0;background:${col};clip-path:${clip}"></div>
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none">
          <span style="font-size:12px;font-weight:600;color:${ink(col)};white-space:nowrap;font-family:${theme.fontSans}">${d.name} ${Math.round(d.pct)}</span>
        </div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100%;min-height:${H + 56}px">
      <div style="width:74%;display:flex;flex-direction:column;gap:${gap}px">${segs}</div>
    </div>`;
  return () => { /* pure DOM */ };
}

export interface TableColumn {
  id: string;
  label: string;
  format?: 'pct' | 'pill' | 'text' | 'link';
  /** For 'pill' cells: map a raw cell VALUE → a status token (good/watch/alert/
   *  info/neutral), restoring domain-label colours (e.g. active→alert,
   *  contained→good, High→alert). Falls back to the literal-token match when a
   *  value has no tone entry — so existing pill callers are unaffected. */
  tone?: Record<string, string>;
  /** Conditional per-cell styling — returns an inline-style fragment (e.g.
   *  `color:#EF4444;font-weight:700`) merged into the <td>'s style attribute.
   *  Receives the cell value, its full row, and the row's absolute index in the
   *  current (sorted, pre-pagination) view — for red-on-negative, top-N
   *  highlight, band colour. Return '' for no extra styling. */
  cellClass?: (value: any, row: Record<string, any>, index: number) => string;
  /** For 'link' cells: id of a companion row field holding the href. When
   *  omitted the cell value itself is the href. Only http(s) URLs render as an
   *  <a> — anything else falls back to a muted dash (scheme validation). */
  href?: string;
}

/** Client-paginated / searchable / sortable table. Owns its own view state in a
 *  closure (search, sort, page). Returns a no-op cleanup. */
export function paginatedTable(
  el: HTMLElement,
  rows: Record<string, any>[],
  columns: TableColumn[],
  theme: Theme,
  opts: { pageSize?: number; search?: boolean; sort?: boolean } = {},
): () => void {
  const state = { search: '', sort: null as string | null, sortDir: -1 as 1 | -1, page: 0, pageSize: opts.pageSize ?? 15 };
  const pillClass = (v: any) => {
    const known = ['good', 'watch', 'alert', 'info', 'neutral'];
    const s = String(v ?? '').toLowerCase();
    return known.includes(s) ? s : 'neutral';
  };
  const escAttr = (s: any) =>
    String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  const cell = (r: Record<string, any>, col: TableColumn, index: number) => {
    const v = r[col.id];
    // Optional conditional styling → merged into the <td>'s style attribute.
    const extra = col.cellClass ? col.cellClass(v, r, index) : '';
    const sa = extra ? ` style="${extra}"` : '';
    if (col.format === 'pct') return `<td class="num"${sa}>${v != null ? v + '%' : '-'}</td>`;
    if (col.format === 'pill') {
      const tok = col.tone?.[String(v)] ?? pillClass(v);
      return `<td${sa}><span class="pill ${tok}">${v != null ? v : '-'}</span></td>`;
    }
    if (col.format === 'link') {
      const raw = col.href ? r[col.href] : v;
      const ok = typeof raw === 'string' && /^https?:\/\//i.test(raw);
      const label = v != null && v !== '' ? String(v) : 'Open';
      return ok
        ? `<td${sa}><a href="${escAttr(raw)}" target="_blank" rel="noopener" style="color:${theme.navy['700'] || '#1d3557'};font-weight:600;text-decoration:none">${label}</a></td>`
        : `<td${sa}><span style="color:${theme.ink[3]}">—</span></td>`;
    }
    return `<td${sa}>${v != null ? v : '-'}</td>`;
  };
  const draw = () => {
    let view = rows.slice();
    if (state.search) {
      const q = state.search.toLowerCase();
      view = view.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q)));
    }
    if (state.sort) view.sort((a, b) => {
      const va = a[state.sort!], vb = b[state.sort!];
      const cmp = typeof va === 'number' ? (va as number) - (vb as number) : String(va).localeCompare(String(vb));
      return cmp * state.sortDir;
    });
    const totalPages = Math.max(1, Math.ceil(view.length / state.pageSize));
    if (state.page >= totalPages) state.page = totalPages - 1;
    const startIdx = state.page * state.pageSize;
    const pageRows = view.slice(startIdx, startIdx + state.pageSize);

    el.innerHTML = '';
    if (opts.search || opts.sort) {
      const ctrls = document.createElement('div');
      ctrls.className = 'local-controls';
      ctrls.innerHTML = [
        opts.search ? `<span class="search-row" style="max-width:220px"><span class="search-ico"><svg class="ico ico-sm"><use href="#i-search"/></svg></span><input type="text" class="search-input" placeholder="Search..." value="${state.search}"></span>` : '',
        opts.sort ? `<span class="lc-spacer"></span><select class="tbl-sort">${columns.map(c => `<option value="${c.id}"${state.sort === c.id ? ' selected' : ''}>Sort: ${c.label}</option>`).join('')}</select>` : '',
      ].join('');
      el.appendChild(ctrls);
      const si = ctrls.querySelector<HTMLInputElement>('.search-input');
      if (si) si.oninput = () => { state.search = si.value; state.page = 0; draw(); };
      const so = ctrls.querySelector<HTMLSelectElement>('.tbl-sort');
      if (so) so.onchange = () => { state.sort = so.value; draw(); };
    }
    const wrap = document.createElement('div');
    wrap.className = 'scrollable';
    wrap.style.maxHeight = '380px';   // X5: fixed height — rows scroll under a sticky header
    wrap.style.overflow = 'auto';
    const stickyTh = `position:sticky;top:0;z-index:1;background:var(--surface,#fff)${opts.sort ? ';cursor:pointer;user-select:none' : ''}`;
    const arrow = (c: TableColumn) => state.sort === c.id ? (state.sortDir < 0 ? ' ↓' : ' ↑') : '';
    wrap.innerHTML = `<table class="dash">
      <thead><tr>${columns.map(c => `<th data-col="${c.id}" style="${stickyTh}">${c.label}${opts.sort ? arrow(c) : ''}</th>`).join('')}</tr></thead>
      <tbody>${pageRows.map((r, i) => `<tr>${columns.map(c => cell(r, c, startIdx + i)).join('')}</tr>`).join('')}</tbody>
    </table>`;
    el.appendChild(wrap);
    if (opts.sort) wrap.querySelectorAll<HTMLElement>('th[data-col]').forEach(th => {
      th.onclick = () => {
        const col = th.dataset.col!;
        if (state.sort === col) state.sortDir = (state.sortDir === -1 ? 1 : -1);
        else { state.sort = col; state.sortDir = -1; }
        draw();
      };
    });

    if (view.length > state.pageSize) {
      const pager = document.createElement('div');
      pager.className = 'pager';
      pager.innerHTML = `<span class="pg-info">${view.length} rows</span><span class="pg-spacer"></span>
        <button class="pg-btn prev"${state.page === 0 ? ' disabled' : ''}><svg class="ico ico-sm" style="transform:rotate(180deg)"><use href="#i-chevron-right"/></svg></button>
        <span style="padding:0 .4rem">${state.page + 1} / ${totalPages}</span>
        <button class="pg-btn next"${state.page >= totalPages - 1 ? ' disabled' : ''}><svg class="ico ico-sm"><use href="#i-chevron-right"/></svg></button>`;
      el.appendChild(pager);
      pager.querySelector<HTMLButtonElement>('.prev')!.onclick = () => { if (state.page > 0) { state.page--; draw(); } };
      pager.querySelector<HTMLButtonElement>('.next')!.onclick = () => { if (state.page < totalPages - 1) { state.page++; draw(); } };
    }
  };
  draw();
  return () => { /* pure DOM, nothing to dispose */ };
}

// ── KPI strip (DOM tiles) ──────────────────────────────────────────────
export interface KpiCell {
  label: string; value: string;
  sub?: string;                    // subtitle line under the value
  delta?: string; deltaDir?: 'up' | 'down';
  foot?: string;                   // bottom footnote, e.g. "Reporting completeness 94%"
  note?: string;                   // legacy alias for foot (existing callers)
  status?: 'good' | 'watch' | 'alert' | 'info';
  icon?: string;                   // optional sprite id (e.g. 'i-shield-check') → colored chip + label row
  iconColor?: string;              // accent for the chip (defaults to a slate navy)
}
export function kpiStrip(el: HTMLElement, cells: KpiCell[], theme: Theme, cols = 3): () => void {
  const tint = (hex: string, a: number) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return hex;
    const n = parseInt(m[1], 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
  const clamp = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
  const escAttr = (v: string) => String(v).replace(/"/g, '&quot;');
  // Track count follows the ACTUAL card count (capped at `cols`) so a strip that
  // renders fewer tiles than its target still fills the row symmetrically instead
  // of left-aligning with empty columns on the right.
  const trackCols = Math.min(cols, Math.max(1, cells.length));
  // Row symmetry across the WHOLE strip (owner 2026-07-07): if ANY tile carries a
  // sub / delta / foot row, EVERY tile renders that row (empty where absent) so
  // labels, values and captions all fall on the same horizontal line.
  const hasSub = cells.some(c => c.sub);
  const hasDelta = cells.some(c => c.delta);
  const hasFoot = cells.some(c => c.foot || c.note);
  el.innerHTML =
    `<div style="display:grid;grid-template-columns:repeat(${trackCols},1fr);gap:.7rem;height:100%">` +
    cells.map(c => {
      const ic = c.iconColor || theme.navy['600'];
      const head = c.icon
        ? `<div style="height:30px;display:flex;align-items:center;gap:.5rem">
             <span style="display:inline-grid;place-items:center;width:30px;height:30px;border-radius:8px;background:${tint(ic, 0.13)};color:${ic};flex-shrink:0"><svg class="ico" aria-hidden="true"><use href="#${c.icon}"/></svg></span>
             <span style="font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:${theme.ink[3]};${clamp}" title="${escAttr(c.label)}">${c.label}</span>
           </div>`
        : `<div class="kpi-lbl" style="height:16px;${clamp}" title="${escAttr(c.label)}">${c.label}</div>`;
      // Normalised value row: numbers keep the large kpi-val size; long TEXT values
      // (e.g. a woreda name) step down and clamp to one line — no giant wrapping text.
      const isText = !/^[0-9.,\s%+\-/]+[KMB%]?$/.test(String(c.value).trim());
      const valStyle = isText
        ? `font-size:1.12rem;font-weight:700;line-height:34px;${clamp}`
        : 'line-height:34px';
      return `
      <div class="kpi kpi-${c.status || 'info'}" style="gap:.25rem">
        ${head}
        <div class="kpi-val" style="height:34px;${valStyle}" title="${escAttr(String(c.value))}">${c.value}</div>
        ${hasSub ? `<div style="height:16px;font-size:.73rem;color:${theme.ink[2]};${clamp}" title="${escAttr(c.sub || '')}">${c.sub || ''}</div>` : ''}
        ${hasDelta ? `<div class="kpi-delta ${c.deltaDir || ''}" style="height:16px;${clamp}">${c.delta || ''}</div>` : ''}
        ${hasFoot ? `<div class="kpi-tgt" style="margin-top:auto;height:24px;${clamp}" title="${escAttr(c.foot || c.note || '')}">${c.foot || c.note || ''}</div>` : ''}
      </div>`;
    }).join('') + `</div>`;
  return () => {};
}

// ── Banded donut (ring of category counts) ─────────────────────────────
export function donut(el: HTMLElement, segments: { name: string; value: number; color: string }[], theme: Theme): () => void {
  const host = document.createElement('div'); host.style.width = '100%'; host.style.height = '240px'; el.appendChild(host);
  const chart = echarts.init(host);
  chart.setOption({
    textStyle: { fontFamily: theme.fontSans },
    tooltip: { trigger: 'item', formatter: '{b}<br/><b>{c}</b> ({d}%)' },
    legend: {
      orient: 'vertical', right: 4, top: 'center', icon: 'circle', itemWidth: 8, itemHeight: 8, itemGap: 8,
      textStyle: { fontSize: 11, color: theme.ink[1] },
      formatter: (name: string) => {
        const d = (chart.getOption() as any).series[0].data.find((x: any) => x.name === name);
        return name.split(' ')[0] + '  ' + (d ? d.value : 0);
      },
    },
    series: [{
      type: 'pie', radius: ['52%', '78%'], center: ['32%', '50%'], avoidLabelOverlap: true,
      label: { show: false }, labelLine: { show: false },
      data: segments.map(s => ({ value: s.value, name: s.name, itemStyle: { color: s.color } })),
    }],
  });
  return bindResize(chart);
}

// ── Heatmap (category × category). Default = 0..1 alarm ramp; opts override
//    the scale/ramp/format (e.g. months-of-stock 0..max with the stock ramp). ─
export function heatmap(
  el: HTMLElement, rows: { name: string; probs: (number | null)[] }[], cols: string[], theme: Theme,
  opts: { min?: number; max?: number; ramp?: string[]; fmt?: (v: number) => string; label?: string; cellH?: number; gridLeft?: number } = {},
): () => void {
  const min = opts.min ?? 0;
  const max = opts.max ?? 1;
  const ramp = opts.ramp ?? ALARM_RAMP;
  const fmt = opts.fmt ?? ((v: number) => `${Math.round(v * 100)}%`);
  const label = opts.label ?? 'P(alarm)';
  const cellH = opts.cellH ?? 26;
  const gridLeft = opts.gridLeft ?? 200;
  const host = document.createElement('div'); host.style.width = '100%'; host.style.height = `${Math.max(180, rows.length * cellH + 80)}px`; el.appendChild(host);
  const chart = echarts.init(host);
  const data: [number, number, number][] = [];
  rows.forEach((d, di) => d.probs.forEach((p, wi) => { if (p != null) data.push([wi, di, +(+p).toFixed(2)]); }));
  // Dynamic in-cell label ink: interpolate the cell's ramp colour for a value, then pick black or
  // white by its relative luminance (WCAG crossover ≈0.21) so every label stays legible.
  const rampRgb = ramp.map(h => { const m = /^#?([0-9a-f]{6})$/i.exec(h); const n = m ? parseInt(m[1], 16) : 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; });
  const relLum = (rgb: number[]) => { const s = rgb.map(c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }); return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]; };
  const labelInk = (v: number) => {
    const tt = max > min ? Math.max(0, Math.min(1, (v - min) / (max - min))) : 0;
    const x = tt * (rampRgb.length - 1), i = Math.floor(x), f = x - i;
    const a = rampRgb[i], b = rampRgb[Math.min(rampRgb.length - 1, i + 1)];
    return relLum([0, 1, 2].map(k => a[k] + (b[k] - a[k]) * f)) > 0.21 ? theme.ink[0] : '#ffffff';
  };
  chart.setOption({
    textStyle: { fontFamily: theme.fontSans },
    tooltip: { position: 'top', formatter: (p: any) => `<b>${rows[p.value[1]].name}</b><br/>${cols[p.value[0]]}<br/>${label} ${fmt(p.value[2])}` },
    grid: { left: gridLeft, right: 24, top: 12, bottom: 34 },
    xAxis: { type: 'category', data: cols, axisLabel: { fontSize: 10, color: theme.ink[2], interval: Math.max(0, Math.floor(cols.length / 14)), rotate: -25 }, axisTick: { show: false } },
    yAxis: { type: 'category', data: rows.map(d => d.name), axisLabel: { fontSize: 10.5, color: theme.ink[1] }, axisLine: { show: false }, axisTick: { show: false } },
    visualMap: { min, max, calculable: true, orient: 'vertical', left: 12, top: 'middle', itemWidth: 10, itemHeight: 160, textStyle: { fontSize: 10, color: theme.ink[2] }, inRange: { color: ramp }, precision: max <= 1 ? 1 : 0, text: [fmt(max), fmt(min)] },
    series: [{
      type: 'heatmap', data, itemStyle: { borderColor: theme.paper, borderWidth: 2, borderRadius: 3 },
      // In-cell values, page font. Dynamic black/white ink per cell (see labelInk) + an adaptive
      // halo so mid-tone slate cells (where neither pure ink is high-contrast) stay legible.
      label: {
        show: true, fontFamily: theme.fontSans, fontSize: 10.5, fontWeight: 700,
        formatter: (p: any) => fmt(p.value[2]),
        color: (p: any) => labelInk(p.value[2]),
        textBorderColor: (p: any) => (labelInk(p.value[2]) === '#ffffff' ? 'rgba(15,23,42,0.55)' : 'rgba(255,255,255,0.8)'),
        textBorderWidth: 2.5,
      },
    }],
  });
  return bindResize(chart);
}

// ── Horizontal stacked bar (e.g. facility tiers per region) ────────────
export function stackedBar(
  el: HTMLElement,
  spec: { categories: string[]; series: { name: string; data: number[]; color: string }[] },
  theme: Theme,
): () => void {
  const host = document.createElement('div'); host.style.width = '100%'; host.style.height = `${Math.max(340, spec.categories.length * 40 + 90)}px`; el.appendChild(host);
  const chart = echarts.init(host);
  chart.setOption({
    textStyle: { fontFamily: theme.fontSans },
    legend: { bottom: 2, left: 'center', icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 10.5, color: theme.ink[1] } },
    grid: { left: 110, right: 28, top: 12, bottom: 40 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'value', axisLabel: { fontSize: 9, color: theme.ink[3] }, splitLine: { show: false } },
    yAxis: { type: 'category', data: spec.categories, axisLabel: { fontSize: 10.5, color: theme.ink[1] }, axisLine: { show: false }, axisTick: { show: false } },
    series: spec.series.map(s => ({ name: s.name, type: 'bar', stack: 'total', data: s.data, itemStyle: { color: s.color }, barWidth: 20 })),
  });
  return bindResize(chart);
}

// ── Dual-axis bars + lines (cases + climate drivers) ───────────────────
export function dualAxisBarLine(
  el: HTMLElement,
  spec: { weeks: string[]; cases: number[]; lines: { name: string; data: number[]; color: string; dashed?: boolean }[] },
  theme: Theme,
  opts: { fill?: boolean } = {},
): () => void {
  // fill: grow with the mount (flex column cards) instead of a fixed 280px —
  // avoids a dead zone under the chart when a taller neighbour stretches the row.
  const host = document.createElement('div'); host.style.width = '100%';
  if (opts.fill) { host.style.height = '100%'; host.style.minHeight = '280px'; } else { host.style.height = '280px'; }
  el.appendChild(host);
  const chart = echarts.init(host);
  chart.setOption({
    textStyle: { fontFamily: theme.fontSans },
    legend: { top: 0, textStyle: { fontSize: 11, color: theme.ink[1] } },
    grid: { left: 48, right: 52, top: 32, bottom: 34 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: spec.weeks, axisLabel: { fontSize: 9, color: theme.ink[3], interval: Math.max(0, Math.floor(spec.weeks.length / 12) - 1), rotate: 0 } },
    yAxis: [
      { type: 'value', name: 'cases', axisLabel: { fontSize: 9, color: theme.ink[3] }, splitLine: { show: false } },
      { type: 'value', name: 'rain / temp / hum', position: 'right', axisLabel: { fontSize: 9, color: theme.ink[3] }, splitLine: { show: false } },
    ],
    series: [
      { name: 'Cases', type: 'bar', data: spec.cases, itemStyle: { color: theme.navy['700'] }, barWidth: '50%' },
      // `color` (series-level) drives the LEGEND swatch; without it echarts falls
      // back to its default palette and the legend disagrees with the drawn line.
      ...spec.lines.map(l => ({ name: l.name, type: 'line', yAxisIndex: 1, smooth: true, symbol: 'none', data: l.data, color: l.color, itemStyle: { color: l.color }, lineStyle: { color: l.color, width: 1.6, type: l.dashed ? 'dashed' : 'solid' } })),
    ],
  });
  return bindResize(chart);
}

// ── Diverging horizontal bar (signed values, e.g. correlation r) ───────
export function divergingBar(el: HTMLElement, data: { name: string; value: number; note?: string }[], theme: Theme, opts: { height?: number; barWidth?: number } = {}): () => void {
  const host = document.createElement('div'); host.style.width = '100%'; host.style.height = `${opts.height ?? Math.max(200, data.length * 32 + 40)}px`; el.appendChild(host);
  const chart = echarts.init(host);
  chart.setOption({
    textStyle: { fontFamily: theme.fontSans },
    grid: { left: 180, right: 60, top: 10, bottom: 34 },
    tooltip: { trigger: 'item', formatter: (p: any) => `${p.name}<br/><b>r = ${(+p.value).toFixed(2)}</b>${data[p.dataIndex].note ? ` · ${data[p.dataIndex].note}` : ''}` },
    xAxis: { type: 'value', min: -1, max: 1, axisLabel: { fontSize: 9, color: theme.ink[3] }, splitLine: { show: false } },
    yAxis: { type: 'category', data: data.map(d => d.name), axisLabel: { fontSize: 10.5, color: theme.ink[1] }, axisLine: { show: false }, axisTick: { show: false } },
    series: [{
      type: 'bar', barWidth: opts.barWidth ?? 12,
      data: data.map(d => ({ value: d.value, itemStyle: { color: d.value >= 0 ? theme.navy['700'] : theme.navy['500'], borderRadius: d.value >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] } })),
      label: { show: true, position: 'right', fontSize: 10, color: theme.ink[2], formatter: (p: any) => (+p.value).toFixed(2) },
    }],
  });
  return bindResize(chart);
}

// ── Time-series with prediction band + alarm threshold (EWARS signal) ──
export interface SignalSeries {
  weeks: string[]; observed: number[];
  predicted: (number | null)[]; lwr: (number | null)[]; upr: (number | null)[];
  threshold: (number | null)[]; alarm: boolean[];
}
export function timeSeriesBand(el: HTMLElement, s: SignalSeries, theme: Theme, opts: { showCI?: boolean; showAlarms?: boolean } = {}): () => void {
  const host = document.createElement('div'); host.style.width = '100%'; host.style.height = '430px'; el.appendChild(host);
  const chart = echarts.init(host);
  const w = s.weeks;
  const bandLo = s.lwr.map(v => (v == null ? null : v));
  const bandSpread = s.upr.map((v, i) => (v == null || s.lwr[i] == null ? null : v - (s.lwr[i] as number)));
  const alarmPoints = s.alarm.map((a, i) => (a ? [i, s.observed[i]] : null)).filter(Boolean) as [number, number][];
  const intervals: [number, number][] = []; let s0 = -1;
  for (let i = 0; i < s.alarm.length; i++) { if (s.alarm[i] && s0 < 0) s0 = i; else if (!s.alarm[i] && s0 >= 0) { intervals.push([s0, i - 1]); s0 = -1; } }
  if (s0 >= 0) intervals.push([s0, s.alarm.length - 1]);
  const markAreaData = intervals.map(([a, b]) => [{ xAxis: w[a] }, { xAxis: w[b] }]);
  const legendNames = ['Observed', 'Expected', 'Alarm threshold'];
  if (opts.showCI) legendNames.push('95% CI');
  if (opts.showAlarms) legendNames.push('Alarm-flagged week');
  const ci = opts.showCI ? [
    { name: 'CI lo', type: 'line', symbol: 'none', data: bandLo, lineStyle: { opacity: 0 }, stack: 'ci', tooltip: { show: false } },
    { name: '95% CI', type: 'line', symbol: 'none', data: bandSpread, lineStyle: { opacity: 0 }, stack: 'ci', areaStyle: { color: 'rgba(71,85,105,0.16)' }, itemStyle: { color: 'rgba(71,85,105,0.45)' }, tooltip: { show: false } },
  ] : [];
  const al = opts.showAlarms ? [{ name: 'Alarm-flagged week', type: 'scatter', data: alarmPoints, symbolSize: 8, itemStyle: { color: '#9F1239', borderColor: theme.paper, borderWidth: 1 }, z: 12 }] : [];
  chart.setOption({
    textStyle: { fontFamily: theme.fontSans },
    grid: { left: 50, right: 18, top: 30, bottom: 40 },
    tooltip: { trigger: 'axis' },
    legend: { top: 0, left: 'center', itemWidth: 18, textStyle: { fontSize: 11, color: theme.ink[1] }, data: legendNames },
    xAxis: { type: 'category', data: w, axisLabel: { fontSize: 9, color: theme.ink[3], interval: Math.max(0, Math.floor(w.length / 12) - 1), rotate: -20 } },
    yAxis: { type: 'value', axisLabel: { fontSize: 9, color: theme.ink[3] }, splitLine: { show: false } },
    series: [
      ...ci,
      { name: 'Alarm threshold', type: 'line', symbol: 'none', data: s.threshold, lineStyle: { color: '#B45309', width: 1.3, type: 'dashed' }, itemStyle: { color: '#B45309' }, z: 4 },
      { name: 'Expected', type: 'line', symbol: 'none', smooth: true, data: s.predicted, lineStyle: { color: theme.navy['600'], width: 1.5, type: 'dashed' }, itemStyle: { color: theme.navy['600'] } },
      { name: 'Observed', type: 'line', symbol: 'none', smooth: true, data: s.observed, lineStyle: { color: '#1E293B', width: 2.2 }, itemStyle: { color: '#1E293B' }, z: 6, markArea: markAreaData.length ? { silent: true, itemStyle: { color: 'rgba(159,18,57,0.06)' }, data: markAreaData } : undefined },
      ...al,
    ],
  });
  return bindResize(chart);
}

// ── Choropleth (Ethiopia regions), click-to-select ─────────────────────
/** Piecewise interpolator over a ramp of hex stops (0..1 → rgb string). */
function rampInterp(stops: string[]): (t: number) => string {
  const hex = (c: string) => {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(c.replace('#', ''));
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [148, 163, 184];
  };
  const rgb = stops.map(hex);
  return (t: number) => {
    const k = Math.max(0, Math.min(1, t)) * (rgb.length - 1);
    const i = Math.floor(k), f = k - i, a = rgb[i], b = rgb[Math.min(rgb.length - 1, i + 1)];
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
  };
}

export function choropleth(
  el: HTMLElement,
  opts: { valuesByRegion: Record<string, number>; fmt: (v: number) => string; selected?: string; onSelect: (region: string) => void; ramp?: string[]; tooltip?: (region: string) => string },
  theme: Theme, geo: any,
): () => void {
  const host = document.createElement('div'); host.className = 'map-graticule'; host.style.width = '100%'; host.style.height = '440px'; host.style.position = 'relative'; el.appendChild(host);
  const chart = echarts.init(host);
  const vals = opts.valuesByRegion;
  // A custom ramp (e.g. diseaseBurden, supplyStress) overrides the default amber scale.
  const interp = opts.ramp && opts.ramp.length ? rampInterp(opts.ramp) : theme.amber;
  let max = 0; for (const k in vals) if (vals[k] > max) max = vals[k];
  const valFor = (spaOrGeoName: string) => {
    const key = Object.keys(vals).find(r => normRegion(r) === normRegion(spaOrGeoName));
    return key != null ? vals[key] : 0;
  };
  // Soften fills ~30% (alpha over the off-white host) so the map reads gentler; full colour on hover.
  const soft = (c: string) => c.replace('rgb(', 'rgba(').replace(')', ',0.72)');
  const seriesData = geo.features.map((f: any) => {
    const name = f.properties.name; const value = valFor(name);
    const col = interp(max > 0 ? value / max : 0);
    return {
      name, value,
      itemStyle: { areaColor: soft(col), borderColor: '#fff', borderWidth: 0.8 },
      emphasis: { itemStyle: { areaColor: col, borderColor: '#334155', borderWidth: 1.6 }, label: { show: true } },
      select: { itemStyle: { areaColor: col, borderColor: '#111827', borderWidth: 2.5 }, label: { show: true } },
    };
  });
  chart.setOption({
    textStyle: { fontFamily: theme.fontSans },
    tooltip: opts.tooltip
      ? { trigger: 'item', backgroundColor: '#fff', borderColor: theme.line, textStyle: { color: theme.ink[1], fontSize: 11 }, formatter: (p: any) => opts.tooltip!(p.name) }
      : { show: false },
    visualMap: { type: 'continuous', min: 0, max: Math.max(1, max), calculable: false, orient: 'vertical', right: 8, bottom: 18, itemWidth: 9, itemHeight: 110, textStyle: { fontSize: 10, color: theme.ink[2] }, inRange: { color: [interp(0), interp(0.5), interp(1)] }, seriesIndex: -1, text: [opts.fmt(Math.max(1, max)), opts.fmt(0)] },
    series: [{
      // roam:'move' = drag-to-pan only. Scroll-wheel zoom is intentionally OFF so scrolling the
      // PAGE over the map never hijacks into a zoom; deliberate zoom is via the +/− buttons below.
      type: 'map', map: 'ethiopia', roam: 'move', zoom: 1, aspectScale: 0.85,
      layoutCenter: ['50%', '50%'], layoutSize: '100%', scaleLimit: { min: 1, max: 6 },
      label: { show: true, fontSize: 9, color: theme.ink[1], textBorderColor: '#fff', textBorderWidth: 2.5 },
      selectedMode: 'single', data: seriesData,
    }],
  });

  // Deliberate zoom controls (no scroll-hijack).
  let zoom = 1;
  const zc = document.createElement('div');
  zc.style.cssText = 'position:absolute;top:8px;left:8px;display:flex;flex-direction:column;gap:4px;z-index:5';
  const mkBtn = (label: string) => {
    const b = document.createElement('button');
    b.textContent = label; b.type = 'button';
    b.style.cssText = `width:26px;height:26px;border:1px solid ${theme.line};background:${theme.paper};color:${theme.ink[1]};border-radius:6px;font-size:15px;line-height:1;cursor:pointer;box-shadow:0 1px 2px rgba(15,23,42,.06)`;
    return b;
  };
  const zin = mkBtn('+'), zout = mkBtn('−');
  const applyZoom = (z: number) => { zoom = Math.max(1, Math.min(6, z)); chart.setOption({ series: [{ zoom }] }); };
  zin.onclick = () => applyZoom(zoom * 1.4);
  zout.onclick = () => applyZoom(zoom / 1.4);
  zc.appendChild(zin); zc.appendChild(zout); host.appendChild(zc);
  const allNames = geo.features.map((f: any) => f.properties.name);
  const selectByName = (region: string) => {
    chart.dispatchAction({ type: 'unselect', seriesIndex: 0, name: allNames });
    chart.dispatchAction({ type: 'select', seriesIndex: 0, name: geoNameFor(geo, region) });
  };
  let top: string | null = null, topV = -Infinity;
  for (const r in vals) { if (vals[r] > topV) { topV = vals[r]; top = r; } }
  const initSel = opts.selected || top;
  if (initSel) { selectByName(initSel); opts.onSelect(initSel); }
  chart.on('click', (p: any) => {
    if (!p || !p.name) return;
    const reg = Object.keys(vals).find(r => normRegion(r) === normRegion(p.name)) || p.name;
    selectByName(reg); opts.onSelect(reg);
  });
  // Grow the map to fill its (tall) card: height driven from measured width.
  // Max clamp is generous (was 560) so a reflow='ratio' card that absorbed a
  // scope-hidden neighbour's tracks gets a map that follows the card's growth
  // instead of stranding blank space (choropleth's only consumers are the two
  // reflow='ratio' map widgets: dz-region-map, rm-map).
  return bindAspect(el, host, chart, 0.72, 380, 920);
}

// ── Sparkline (tiny inline-SVG trend line) ─────────────────────────────
/** A compact trend line for stat cards. Pure SVG string, theme-coloured. */
export function sparklineSvg(values: number[], theme: Theme, opts: { color?: string; w?: number; h?: number } = {}): string {
  const w = opts.w ?? 116, h = opts.h ?? 34, pad = 3;
  if (!values || values.length < 2) return '';
  const min = Math.min(...values), max = Math.max(...values), span = (max - min) || 1;
  const stepX = (w - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => [pad + i * stepX, pad + (h - pad * 2) * (1 - (v - min) / span)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `M${pad},${h - pad} ` + pts.map(p => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ` L${(w - pad).toFixed(1)},${h - pad} Z`;
  const color = opts.color ?? theme.navy['500'];
  const last = pts[pts.length - 1];
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block">
    <path d="${area}" fill="${color}" opacity="0.08"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.2" fill="${color}"/>
  </svg>`;
}

// ── Stat card body (value + delta + target + sparkline) ────────────────
export interface StatCardSpec {
  value: string;            // pre-formatted, e.g. "86%" / "124"
  subtitle?: string;        // small descriptor under the card title
  note?: string;            // footer target line, e.g. "Target ≥ 85%"
  delta?: string;           // e.g. "▲ 4 pp vs last month"
  deltaGood?: boolean;      // colour delta good vs alert (SEMANTIC, not arrow-based)
  spark?: number[];
  sparkColor?: string;
  /** Optional flexible HTML block between note and delta (e.g. a compact list)
   *  — occupies the stretch zone so the fixed rows still align across cards. */
  body?: string;
}
/** Renders a stat-card BODY into `el` (the card title/chrome is drawn by the host).
 *  Reference-golden layout: subtitle wraps naturally (goldens show 2-line
 *  descriptors), value(+spark) row, target note, optional body block, ▲/▼ delta
 *  pinned to the card bottom — note/delta rows render only when present. */
export function statCard(el: HTMLElement, s: StatCardSpec, theme: Theme): () => void {
  const deltaColor = s.delta ? (s.deltaGood === false ? theme.status.alert : theme.status.good) : '';
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;gap:.3rem">
      ${s.subtitle ? `<div style="font-size:.76rem;color:${theme.ink[2]};line-height:1.35">${s.subtitle}</div>` : ''}
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:.6rem;margin-top:.25rem">
        <div style="font-size:1.95rem;font-weight:800;letter-spacing:-.025em;color:${theme.ink[0]};font-variant-numeric:tabular-nums;line-height:1">${s.value}</div>
        ${s.spark ? `<div style="flex-shrink:0">${sparklineSvg(s.spark, theme, { color: s.sparkColor })}</div>` : ''}
      </div>
      ${s.note ? `<div style="font-size:.72rem;color:${theme.ink[3]}">${s.note}</div>` : ''}
      ${s.body ? `<div style="flex:1;min-height:0;margin-top:.3rem">${s.body}</div>` : ''}
      ${s.delta ? `<div style="margin-top:auto;padding-top:.5rem;font-size:.76rem;font-weight:600;color:${deltaColor}">${s.delta}</div>` : ''}
    </div>`;
  return () => {};
}
