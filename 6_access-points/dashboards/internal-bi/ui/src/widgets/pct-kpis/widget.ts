/**
 * PCT · Supply KPIs (PCT — Supply Chain Control Tower, Zambia eLMIS).
 * Source: bi_supply.mart_pct_kpi via fetcher pct-kpis — national numerator /
 * denominator per KPI, category and month. Values are pooled here exactly as
 * bi_supply.pct_kpi_definitions defines them (S8: a disease score pools its
 * categories; the MOS band is a share per band). "Today" is the latest month in
 * the data, never the clock. Order fill is not shown: a few outlier calculated
 * order quantities dominate its national ratio (1.4%–99.1% month to month).
 */
import * as echarts from 'echarts';
import type { WidgetDef, Theme } from '../../runtime/types';
import { kpiStrip, type KpiCell } from '../_shared/charts';

type Row = { kpi_code: string; category: string; month_id: string; numerator: number; denominator: number; target: number | null };

const pct = (n: number, d: number) => (d > 0 ? (100 * n) / d : NaN);
const fmt = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : '—');
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
};

function pooled(rows: Row[], kpi: string, month: string, category?: string): number {
  let n = 0, d = 0;
  for (const r of rows) {
    if (r.kpi_code !== kpi || r.month_id !== month) continue;
    if (category !== undefined && r.category !== category) continue;
    n += Number(r.numerator) || 0; d += Number(r.denominator) || 0;
  }
  return pct(n, d);
}

function delta(now: number, prev: number, higherIsBetter: boolean, prevMonth: string): Pick<KpiCell, 'delta' | 'deltaDir'> {
  if (!Number.isFinite(now) || !Number.isFinite(prev)) return {};
  const d = now - prev;
  const good = higherIsBetter ? d >= 0 : d <= 0;
  return { delta: `${d >= 0 ? '+' : ''}${d.toFixed(1)} pts vs ${monthLabel(prevMonth)}`, deltaDir: good ? 'up' : 'down' };
}

function trend(el: HTMLElement, rows: Row[], months: string[], categories: string[], target: number, theme: Theme): () => void {
  const host = document.createElement('div');
  host.style.width = '100%'; host.style.height = '220px';
  el.appendChild(host);
  const chart = echarts.init(host);
  const palette = [theme.navy['700'] || '#1d3557', theme.status.info, theme.status.watch, theme.navy['400'] || '#6b7fa3'];
  const series: any[] = [{
    name: 'All tracer categories', type: 'line', smooth: false, symbolSize: 5, z: 5,
    lineStyle: { width: 2.5, color: palette[0] }, itemStyle: { color: palette[0] },
    data: months.map(m => +pooled(rows, 'osa_s8', m).toFixed(1)),
    markLine: {
      symbol: 'none', silent: true,
      lineStyle: { type: 'dashed', color: theme.status.alert, width: 1.4 },
      label: { formatter: `Global Fund target ${target}%`, position: 'insideEndTop', color: theme.status.alert, fontSize: 11 },
      data: [{ yAxis: target }],
    },
  }];
  categories.forEach((c, i) => series.push({
    name: c, type: 'line', smooth: false, symbol: 'none',
    lineStyle: { width: 1.3, color: palette[(i + 1) % palette.length], type: 'dotted' },
    itemStyle: { color: palette[(i + 1) % palette.length] },
    data: months.map(m => +pooled(rows, 'osa_s8', m, c).toFixed(1)),
  }));
  chart.setOption({
    textStyle: { fontFamily: theme.fontSans },
    grid: { left: 42, right: 16, top: 34, bottom: 28 },
    legend: { top: 0, left: 0, itemWidth: 14, textStyle: { color: theme.ink[2], fontSize: 11 } },
    tooltip: { trigger: 'axis', valueFormatter: (v: any) => (v == null ? '—' : `${v}%`) },
    xAxis: { type: 'category', data: months.map(monthLabel), axisLabel: { color: theme.ink[2], fontSize: 10 } },
    yAxis: { type: 'value', min: (v: any) => Math.max(0, Math.floor((Math.min(v.min, target) - 5) / 5) * 5), max: 100,
             axisLabel: { formatter: '{value}%', color: theme.ink[2], fontSize: 10 }, splitLine: { lineStyle: { color: theme.line } } },
    series,
  });
  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(host);
  return () => { ro.disconnect(); chart.dispose(); };
}

const def: WidgetDef = {
  id: 'pct-kpis',
  reactsTo: ['geography'],
  async render(ctx) {
    const data = await ctx.fetchData();
    const rows = (data || []) as Row[];
    if (!rows.length) { ctx.empty('No PCT supply KPIs for the selected scope.'); return; }
    const months = [...new Set(rows.map(r => r.month_id))].sort();
    const now = months[months.length - 1];
    const prev = months[months.length - 2];
    const s8Cats = [...new Set(rows.filter(r => r.kpi_code === 'osa_s8').map(r => r.category))].filter(Boolean).sort();
    const target = Number(rows.find(r => r.kpi_code === 'osa_s8' && r.target != null)?.target ?? 90);

    const s8 = pooled(rows, 'osa_s8', now);
    const exposure = pooled(rows, 'stockout_exposure', now);
    const days = pooled(rows, 'stockout_days_rate', now);
    const within = pooled(rows, 'mos_band', now, 'within_policy');
    const out = pooled(rows, 'mos_band', now, 'stocked_out');

    const cells: KpiCell[] = [
      { label: 'On-shelf availability (Global Fund S8)', value: fmt(s8),
        sub: s8Cats.map(c => `${c} ${fmt(pooled(rows, 'osa_s8', now, c))}`).join(' · '),
        ...delta(s8, pooled(rows, 'osa_s8', prev), true, prev),
        foot: `Target ${target}% · ${monthLabel(now)}`,
        status: s8 >= target ? 'good' : s8 >= target - 10 ? 'watch' : 'alert' },
      { label: 'Stockout exposure', value: fmt(exposure), sub: 'Tracer facility-products with a stockout in the month',
        ...delta(exposure, pooled(rows, 'stockout_exposure', prev), false, prev), status: 'info' },
      { label: 'Stockout days', value: Number.isFinite(days) ? days.toFixed(1) : '—', sub: 'Per 100 reporting days, tracer products',
        ...delta(days, pooled(rows, 'stockout_days_rate', prev), false, prev), status: 'info' },
      { label: 'Stock within policy', value: fmt(within), sub: `Max/min band · ${fmt(out)} stocked out at month end`,
        ...delta(within, pooled(rows, 'mos_band', prev, 'within_policy'), true, prev), status: 'info' },
    ];
    const tiles = document.createElement('div');
    const chartBox = document.createElement('div');
    chartBox.style.marginTop = '.75rem';
    ctx.el.append(tiles, chartBox);
    const cleanTiles = kpiStrip(tiles, cells, ctx.theme, 4);
    const lead = document.createElement('p');
    lead.className = 'widget-lead';
    lead.style.cssText = 'margin:0 0 .25rem;font-size:.8rem;color:var(--ink-3)';
    lead.textContent = `On-shelf availability by month, Global Fund S8 method (eLMIS source), ${monthLabel(months[0])} – ${monthLabel(now)}.`;
    chartBox.appendChild(lead);
    const cleanTrend = trend(chartBox, rows, months, s8Cats, target, ctx.theme);
    return () => { cleanTiles(); cleanTrend(); };
  },
};
export default def;
