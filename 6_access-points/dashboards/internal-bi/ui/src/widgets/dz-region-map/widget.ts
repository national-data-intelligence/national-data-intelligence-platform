/**
 * Burden & Readiness Map (Disease §2) — redesigned reference layout (DS-D3).
 * answers.md Q3-dz-region-map · insight-notes: KEEP AND EXTEND — a burden-only map is something
 * DHIS2/IDSR already draw; the warehouse edge is overlaying RESPONSE CAPACITY. Toggle Burden /
 * Readiness / Reliability so "hot and unready" areas pop. Guardrail: keep burden & readiness
 * visually separable — do NOT blend into one index that hides which factor drives the colour.
 * Rendered at admin-1 REGION level (no woreda GeoJSON — DECISIONS §M1).
 * Source: bi_idsr.mart_idsr_disease_weekly + Supply (readiness) + DQ (reliability) + MFR.
 *
 * LAYOUT (reference ChatGPT Image Jul 13 02:55):
 *   · header      — subtitle + Burden/Readiness/Reliability segmented toggle (top-right)
 *   · LEFT        — choropleth map (+/- zoom controls from _shared/charts)
 *   · RIGHT side  — "Selected region" card (name + burden-level badge, P(alarm)·Cases 7d·CFR,
 *                   weekly-case sparkline) · "Top 5" ranked bars · gradient legend
 *   · BOTTOM      — highest region · national median · data freshness
 *
 * REGION ADAPTATION (Task 1): the map ALWAYS loads the national dataset (geography:'all';
 * OPA still row-filters to the caller's scope). When the global region filter names a region
 * the map ZOOMS to it (choropleth focusRegion) and the sidebar/summary scope to it; the Top-5
 * + national summary stay national. 'all' → full national map, click-to-select.
 *
 * DATA CONTRACT (dz-region-map fetcher) — one row per region:
 *   region:str(id) · burden_incidence_100k:num · readiness_pct:int · reliability_pct:int ·
 *   p_alarm:int(%) · cases_7d:int · cfr_pct:num · data_through:date
 * Sparkline uses the SAME fetcher with ?spark=1 → weekly {week, cases} for the scoped region.
 * reactsTo: geography · programme.
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import { choropleth, sparklineSvg } from '../_shared/charts';
import { loadEthGeo } from '../_shared/geo';
import { regionName } from '../_shared/reference';

type Metric = 'burden' | 'readiness' | 'reliability';
const META: Record<Metric, { col: string; label: string; icon: string; higherWorse: boolean; fmt: (v: number) => string; bands: string[] }> = {
  burden:      { col: 'burden_incidence_100k', label: 'Burden',      icon: 'i-chart-bar',    higherWorse: true,  fmt: v => `${Math.round(v)}`,      bands: ['Low', 'Moderate', 'Elevated', 'High', 'Very high'] },
  readiness:   { col: 'readiness_pct',         label: 'Readiness',   icon: 'i-shield-check', higherWorse: false, fmt: v => `${Math.round(v)}%`,     bands: ['Critical', 'Low', 'Fair', 'Good', 'Strong'] },
  reliability: { col: 'reliability_pct',       label: 'Reliability', icon: 'i-check-circle', higherWorse: false, fmt: v => `${Math.round(v)}%`,     bands: ['Critical', 'Low', 'Fair', 'Good', 'Strong'] },
};

const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
/** hex OR rgb()/rgba() → rgba tint (badge / bar backgrounds that must follow the
 *  palette). theme.amber returns rgb() strings, so both forms must be handled —
 *  a hex-only parse left amber tints opaque (invisible badge text). */
const tint = (c: string, a: number): string => {
  const h = /^#?([0-9a-f]{6})$/i.exec(c);
  if (h) { const n = parseInt(h[1], 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
  const r = /rgba?\(([^)]+)\)/i.exec(c);
  if (r) { const [rr, gg, bb] = r[1].split(',').map(x => parseInt(x.trim(), 10) || 0); return `rgba(${rr},${gg},${bb},${a})`; }
  return c;
};
/** "2026-06-02" (or a Date) → "Jun 2, 2026" / "Jun 2" (short). */
const fmtDate = (v: any, short = false): string => {
  const d = new Date(String(v).length <= 10 ? String(v) + 'T00:00:00' : String(v));
  if (isNaN(d.getTime())) return String(v ?? '—');
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return short ? `${mo} ${d.getDate()}` : `${mo} ${d.getDate()}, ${d.getFullYear()}`;
};

const def: WidgetDef = {
  id: 'dz-region-map',
  reactsTo: ['geography', 'programme'],
  // Map-like: when a scope reflow grows this card, preserve its aspect —
  // the renderer scales the card height with the width growth (owner rule 2).
  reflow: 'ratio',
  render(ctx: WidgetCtx) {
    const t = ctx.theme;
    let metric: Metric = 'burden';
    let chartCleanup: (() => void) | undefined;
    let rows: any[] = [];
    let rowsByName: Record<string, any> = {};
    let idByName: Record<string, string> = {};
    let dataThrough: any = null;
    let geo: any = null;
    let selectedName: string | null = null;
    let lastSparkRegion: string | null = null;

    // The global region filter drives the map focus + initial selection (Task 1).
    const focusId = ctx.filters.geography;
    const focusName = focusId && focusId !== 'all' ? regionName(String(focusId)) : null;

    // Colour stops (low→high) per metric — the map ramp, the legend gradient and
    // the burden-level badge all read from these so the card speaks one scale.
    const stopsFor = (m: Metric): string[] =>
      m === 'burden'
        ? [...t.ramps.diseaseBurden].slice(0, 5).reverse()          // pale → deep orange
        : [t.amber(0), t.amber(0.34), t.amber(0.67), t.amber(1)];
    const colorAt = (stops: string[], f: number): string =>
      stops[Math.min(stops.length - 1, Math.max(0, Math.round(f * (stops.length - 1))))];
    // Severity tone for the selected-region badge — always vivid + readable
    // (the pale end of a ramp makes near-white badge text). Burden higher = worse
    // (green→amber→red); readiness/reliability higher = better (red→amber→green).
    const bandTone = (m: typeof META[Metric], idx: number): string => {
      const tones = m.higherWorse
        ? [t.status.good, t.status.info, t.status.watch, t.status.watch, t.status.alert]
        : [t.status.alert, t.status.watch, t.status.watch, t.status.good, t.status.good];
      return tones[Math.min(tones.length - 1, Math.max(0, idx))];
    };

    ctx.el.innerHTML = `
      <style>
        .dzm{display:flex;flex-direction:column;height:100%;gap:.7rem;font-family:${t.fontSans}}
        .dzm-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}
        .dzm-sub{font-size:.82rem;color:${t.ink[2]};line-height:1.35;max-width:60ch}
        .dzm-seg .ico{margin-right:.32rem}
        .dzm-main{display:grid;grid-template-columns:minmax(0,1fr) 306px;gap:1rem;flex:1;min-height:0}
        .dzm-mapwrap{position:relative;min-width:0;border:1px solid ${t.line};border-radius:14px;overflow:hidden;background:${t.paper}}
        .dz-map-mount{width:100%;height:100%;min-height:360px}
        .dzm-side{display:flex;flex-direction:column;gap:.7rem;min-width:0}
        .dzm-side-lbl{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:${t.ink[3]}}
        .dzm-card{border:1px solid ${t.line};border-radius:14px;background:${t.paper};padding:.85rem .95rem;box-shadow:0 1px 2px rgba(15,23,42,.04)}
        .dzm-sel-top{display:flex;align-items:center;justify-content:space-between;gap:.5rem}
        .dzm-sel-name{display:flex;align-items:center;gap:.45rem;font-size:1.06rem;font-weight:700;color:${t.ink[0]};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .dzm-sel-name .ico{color:${t.status.alert}}
        .dzm-badge{flex-shrink:0;font-size:.7rem;font-weight:600;padding:.2rem .55rem;border-radius:999px;white-space:nowrap}
        .dzm-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:.3rem;margin-top:.8rem;text-align:center}
        .dzm-stat .k{font-size:.66rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:${t.ink[3]}}
        .dzm-stat .v{font-size:1.12rem;font-weight:700;color:${t.ink[0]};font-variant-numeric:tabular-nums;line-height:1.4}
        .dzm-spark{margin-top:.7rem;padding-top:.65rem;border-top:1px solid ${t.line}}
        .dzm-spark-cap{display:flex;align-items:center;justify-content:space-between;font-size:.66rem;color:${t.ink[3]};margin-top:.2rem}
        .dzm-top5-hd{font-size:.78rem;font-weight:600;color:${t.ink[1]};margin-bottom:.55rem;display:flex;align-items:center;justify-content:space-between;gap:.4rem}
        .dzm-top5-hd .u{font-size:.66rem;font-weight:500;color:${t.ink[3]}}
        .dzm-row{display:grid;grid-template-columns:74px 1fr 38px;align-items:center;gap:.5rem;padding:.2rem .35rem;border-radius:7px;font-size:.76rem}
        .dzm-row.sel{background:${tint(t.status.alert, 0.08)}}
        .dzm-row .n{color:${t.ink[1]};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .dzm-row.sel .n{color:${t.status.alert};font-weight:600}
        .dzm-row .track{height:9px;border-radius:5px;background:${t.navy['50']};overflow:hidden}
        .dzm-row .track > span{display:block;height:100%;border-radius:5px}
        .dzm-row .val{text-align:right;font-weight:700;color:${t.ink[0]};font-variant-numeric:tabular-nums}
        .dzm-legend-ttl{font-size:.74rem;font-weight:600;color:${t.ink[1]};margin-bottom:.5rem}
        .dzm-legbar{height:11px;border-radius:6px}
        .dzm-legends{display:flex;justify-content:space-between;font-size:.68rem;color:${t.ink[3]};margin-top:.35rem}
        .dzm-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:0;border:1px solid ${t.line};border-radius:14px;background:${t.paper};box-shadow:0 1px 2px rgba(15,23,42,.04)}
        .dzm-sumcell{display:flex;align-items:center;gap:.7rem;padding:.75rem .95rem}
        .dzm-sumcell + .dzm-sumcell{border-left:1px solid ${t.line}}
        .dzm-sumchip{width:38px;height:38px;border-radius:10px;display:inline-grid;place-items:center;flex-shrink:0}
        .dzm-sumchip .ico{width:1.15rem;height:1.15rem}
        .dzm-sumcell .l{font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:${t.ink[3]}}
        .dzm-sumcell .m{font-size:1.02rem;font-weight:700;color:${t.ink[0]};display:flex;align-items:center;gap:.4rem}
        .dzm-sumcell .s{font-size:.68rem;color:${t.ink[3]}}
        .dzm-sumbadge{font-size:.66rem;font-weight:600;padding:.1rem .45rem;border-radius:999px}
        @media (max-width:960px){.dzm-main{grid-template-columns:1fr}.dzm-summary{grid-template-columns:1fr}.dzm-sumcell + .dzm-sumcell{border-left:none;border-top:1px solid ${t.line}}}
      </style>
      <div class="dzm">
        <div class="dzm-head">
          <div class="dzm-sub">Explore health burden and system readiness across Ethiopia's regions${focusName ? ` — focused on <b>${esc(focusName)}</b>` : ''}.</div>
          <div class="seg dzm-seg">
            <button data-metric="burden" class="active"><svg class="ico ico-sm"><use href="#i-chart-bar"/></svg>Burden</button>
            <button data-metric="readiness"><svg class="ico ico-sm"><use href="#i-shield-check"/></svg>Readiness</button>
            <button data-metric="reliability"><svg class="ico ico-sm"><use href="#i-check-circle"/></svg>Reliability</button>
          </div>
        </div>
        <div class="dzm-main">
          <div class="dzm-mapwrap"><div class="dz-map-mount"></div></div>
          <div class="dzm-side">
            <div>
              <div class="dzm-side-lbl">Selected region</div>
              <div class="dzm-card dzm-sel" style="margin-top:.4rem">
                <div class="dzm-sel-top">
                  <span class="dzm-sel-name"><svg class="ico ico-sm"><use href="#i-pin"/></svg><span class="dzm-sel-nm">—</span></span>
                  <span class="dzm-badge dzm-sel-badge"></span>
                </div>
                <div class="dzm-stats">
                  <div class="dzm-stat"><div class="k">P(alarm)</div><div class="v dzm-s-alarm">—</div></div>
                  <div class="dzm-stat"><div class="k">Cases 7d</div><div class="v dzm-s-cases">—</div></div>
                  <div class="dzm-stat"><div class="k">CFR</div><div class="v dzm-s-cfr">—</div></div>
                </div>
                <div class="dzm-spark"><div class="dzm-spark-svg"></div><div class="dzm-spark-cap"></div></div>
              </div>
            </div>
            <div class="dzm-card dzm-top5">
              <div class="dzm-top5-hd"><span class="dzm-top5-lbl">Top 5</span><span class="u dzm-top5-unit"></span></div>
              <div class="dzm-top5-list"></div>
            </div>
            <div class="dzm-card dzm-legend">
              <div class="dzm-legend-ttl dzm-legend-lbl">Burden level</div>
              <div class="dzm-legbar"></div>
              <div class="dzm-legends"><span>Low</span><span>High</span></div>
            </div>
          </div>
        </div>
        <div class="dzm-summary">
          <div class="dzm-sumcell dzm-sum-high"></div>
          <div class="dzm-sumcell dzm-sum-median"></div>
          <div class="dzm-sumcell dzm-sum-fresh"></div>
        </div>
      </div>`;

    const q = <T extends HTMLElement>(sel: string) => ctx.el.querySelector(sel) as T;
    const mapMount = q<HTMLElement>('.dz-map-mount');

    // ── Selected-region card ────────────────────────────────────────────
    const updateSelected = () => {
      const nm = q<HTMLElement>('.dzm-sel-nm');
      const badge = q<HTMLElement>('.dzm-sel-badge');
      if (!selectedName) { nm.textContent = '—'; badge.style.display = 'none'; return; }
      nm.textContent = selectedName;
      const r = rowsByName[selectedName];
      const m = META[metric];
      const vals = rows.map(x => Number(x[m.col] ?? 0));
      const max = Math.max(1, ...vals);
      const v = Number(r?.[m.col] ?? 0);
      const f = Math.max(0, Math.min(1, v / max));
      // For "higher is better" metrics the band reads from the value's own height;
      // for burden a higher fraction is a worse band — bands[] is already ordered
      // low→high so f maps directly either way (label semantics differ, colour matches map).
      const bandIdx = Math.min(m.bands.length - 1, Math.floor(f * m.bands.length));
      const badgeCol = bandTone(m, bandIdx);
      badge.style.display = '';
      badge.style.background = tint(badgeCol, 0.16);
      badge.style.color = badgeCol;
      badge.textContent = `${m.bands[bandIdx]} ${m.label.toLowerCase()}`;
      q<HTMLElement>('.dzm-s-alarm').textContent = `${Math.round(Number(r?.p_alarm ?? 0))}%`;
      q<HTMLElement>('.dzm-s-cases').textContent = Number(r?.cases_7d ?? 0).toLocaleString();
      q<HTMLElement>('.dzm-s-cfr').textContent = `${Number(r?.cfr_pct ?? 0).toFixed(1)}%`;
    };

    // ── Weekly-case sparkline (REAL series via ?spark=1) ────────────────
    const loadSpark = async (name: string | null) => {
      if (!name || name === lastSparkRegion) return;
      lastSparkRegion = name;
      const svgHost = q<HTMLElement>('.dzm-spark-svg');
      const cap = q<HTMLElement>('.dzm-spark-cap');
      const id = idByName[name];
      if (!id) { svgHost.innerHTML = ''; cap.textContent = ''; return; }
      const series = await ctx.fetchData({ geography: id, spark: '1' });
      if (name !== lastSparkRegion) return;                 // a newer selection won the race
      const pts = (series || []).slice(-10);
      const nums = pts.map((p: any) => Number(p.cases ?? 0));
      if (nums.length < 2) { svgHost.innerHTML = ''; cap.innerHTML = `<span style="color:${t.ink[4]}">Weekly series unavailable</span>`; return; }
      svgHost.innerHTML = sparklineSvg(nums, t, { color: t.status.alert, w: 274, h: 44 });
      const peak = Math.max(...nums);
      cap.innerHTML = `<span>${esc(fmtDate((pts[0] as any).week, true))} – ${esc(fmtDate((pts[pts.length - 1] as any).week, true))}</span><span>peak ${peak.toLocaleString()} cases/wk</span>`;
    };

    const selectRegion = (name: string) => {
      selectedName = name;
      updateSelected();
      // highlight the matching Top-5 row (if present)
      ctx.el.querySelectorAll<HTMLElement>('.dzm-row').forEach(el => el.classList.toggle('sel', el.dataset.region === name));
      loadSpark(name);
    };

    // ── Metric-dependent parts: map, Top-5, legend, summary ─────────────
    const renderMetricParts = () => {
      const m = META[metric];
      const stops = stopsFor(metric);
      const valuesByRegion: Record<string, number> = {};
      for (const r of rows) valuesByRegion[regionName(String(r.region))] = Number(r[m.col] ?? 0);
      const vals = rows.map(r => Number(r[m.col] ?? 0));
      const max = Math.max(1, ...vals);

      // MAP — always national geometry; zoom+focus when a region is globally selected.
      if (chartCleanup) { chartCleanup(); chartCleanup = undefined; }
      mapMount.innerHTML = '';   // choropleth's cleanup disposes the chart but leaves its host div — clear so metric toggles don't stack maps
      const ramp = metric === 'burden' ? stops : undefined;   // undefined → choropleth's amber (matches `stops`)
      const tooltip = (name: string) => {
        const r = rowsByName[name];
        if (!r) return `<b>${esc(name)}</b><br/>No data`;
        return `<b>${esc(name)}</b><br/>Burden ${Math.round(Number(r.burden_incidence_100k ?? 0))}/100k · Readiness ${Number(r.readiness_pct ?? 0)}%<br/>P(alarm) ${Number(r.p_alarm ?? 0)}% · Cases 7d ${Number(r.cases_7d ?? 0).toLocaleString()}`;
      };
      chartCleanup = choropleth(mapMount, {
        valuesByRegion, fmt: m.fmt, onSelect: selectRegion, ramp, tooltip,
        showScale: false,                                     // we draw our own sidebar legend
        focusRegion: focusName || undefined,
        selected: selectedName || focusName || undefined,
      }, t, geo);

      // TOP 5 (metric-ranked; higher-is-better metrics rank ascending so the
      // "weakest" surface, matching the reference's attention framing for burden).
      const ranked = [...rows].sort((a, b) => {
        const av = Number(a[m.col] ?? 0), bv = Number(b[m.col] ?? 0);
        return m.higherWorse ? bv - av : av - bv;
      }).slice(0, 5);
      const listMax = Math.max(1, ...ranked.map(r => Number(r[m.col] ?? 0)));
      q<HTMLElement>('.dzm-top5-lbl').textContent = m.higherWorse ? `Top 5 ${m.label.toLowerCase()} regions` : `Lowest 5 ${m.label.toLowerCase()} regions`;
      q<HTMLElement>('.dzm-top5-unit').textContent = metric === 'burden' ? 'cases/100k' : '%';
      q<HTMLElement>('.dzm-top5-list').innerHTML = ranked.map(r => {
        const name = regionName(String(r.region));
        const v = Number(r[m.col] ?? 0);
        const w = Math.max(4, Math.round((v / listMax) * 100));
        const col = colorAt(stops, Math.max(0, Math.min(1, v / max)));
        return `<div class="dzm-row${name === selectedName ? ' sel' : ''}" data-region="${esc(name)}">
          <span class="n" title="${esc(name)}">${esc(name)}</span>
          <span class="track"><span style="width:${w}%;background:${col}"></span></span>
          <span class="val">${esc(m.fmt(v))}</span></div>`;
      }).join('');
      ctx.el.querySelectorAll<HTMLElement>('.dzm-row').forEach(el => {
        el.style.cursor = 'pointer';
        el.onclick = () => { const n = el.dataset.region!; if (rowsByName[n]) selectRegion(n); };
      });

      // LEGEND
      q<HTMLElement>('.dzm-legend-lbl').textContent = `${m.label} level`;
      q<HTMLElement>('.dzm-legbar').style.background = `linear-gradient(90deg, ${stops.join(',')})`;

      // SUMMARY strip
      const sorted = [...rows].sort((a, b) => Number(b[m.col] ?? 0) - Number(a[m.col] ?? 0));
      const highest = sorted[0];
      const highName = highest ? regionName(String(highest.region)) : '—';
      const highVal = highest ? Number(highest[m.col] ?? 0) : 0;
      const highCol = colorAt(stops, Math.max(0, Math.min(1, highVal / max)));
      const med = (() => {
        const s = [...vals].sort((a, b) => a - b); const n = s.length;
        return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0;
      })();
      q<HTMLElement>('.dzm-sum-high').innerHTML =
        `<span class="dzm-sumchip" style="background:${tint(t.status.alert, 0.13)};color:${t.status.alert}"><svg class="ico"><use href="#i-star"/></svg></span>
         <span><span class="l">Highest ${esc(m.label.toLowerCase())} region</span>
         <span class="m">${esc(highName)}<span class="dzm-sumbadge" style="background:${tint(highCol, 0.16)};color:${highCol}">${esc(m.fmt(highVal))}</span></span></span>`;
      q<HTMLElement>('.dzm-sum-median').innerHTML =
        `<span class="dzm-sumchip" style="background:${tint(t.navy['600'], 0.12)};color:${t.navy['600']}"><svg class="ico"><use href="#i-chart-bar"/></svg></span>
         <span><span class="l">National median</span><span class="m">${esc(m.fmt(med))}</span>
         <span class="s">across ${rows.length} region${rows.length === 1 ? '' : 's'} in scope</span></span>`;
      q<HTMLElement>('.dzm-sum-fresh').innerHTML =
        `<span class="dzm-sumchip" style="background:${tint(t.navy['500'], 0.12)};color:${t.navy['500']}"><svg class="ico"><use href="#i-clock"/></svg></span>
         <span><span class="l">Data freshness</span><span class="m">${dataThrough ? esc(fmtDate(dataThrough)) : '—'}</span>
         <span class="s">latest reported week</span></span>`;

      updateSelected();
    };

    const boot = async () => {
      mapMount.innerHTML = '<p class="muted" style="padding:1rem">Loading…</p>';
      try {
        // ALWAYS national — OPA still row-filters to the caller's scope. This keeps
        // the national context, Top-5 and summary intact while the global filter
        // only drives the map ZOOM + selection (Task 1), never hides the map.
        rows = (await ctx.fetchData({ geography: 'all' })) || [];
        if (!rows.length) {
          mapMount.innerHTML = '<div class="widget-empty">No geographic surveillance data for the selected filters.</div>';
          return;
        }
        rowsByName = {}; idByName = {};
        for (const r of rows) {
          const name = regionName(String(r.region));
          rowsByName[name] = r; idByName[name] = String(r.region);
        }
        dataThrough = rows[0]?.data_through ?? null;
        geo = await loadEthGeo();
        mapMount.innerHTML = '';

        // Initial selection: the globally-focused region, else the top-burden region.
        const topBurden = [...rows].sort((a, b) => Number(b.burden_incidence_100k ?? 0) - Number(a.burden_incidence_100k ?? 0))[0];
        selectedName = focusName || (topBurden ? regionName(String(topBurden.region)) : null);

        renderMetricParts();                // draws the map (fires onSelect → sidebar + spark)
        if (selectedName) selectRegion(selectedName);
      } catch {
        mapMount.innerHTML = '<div class="widget-empty">Could not load the burden &amp; readiness map. Please try again.</div>';
      }
    };

    ctx.el.querySelectorAll<HTMLElement>('[data-metric]').forEach(b => {
      b.onclick = () => {
        metric = b.dataset.metric as Metric;
        ctx.el.querySelectorAll<HTMLElement>('[data-metric]').forEach(x => x.classList.toggle('active', x.dataset.metric === metric));
        if (rows.length && geo) renderMetricParts();          // no refetch — all metrics are in `rows`
      };
    });

    boot();
    return () => { if (chartCleanup) chartCleanup(); };
  },
};
export default def;
