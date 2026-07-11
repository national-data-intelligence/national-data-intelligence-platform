/**
 * Chart helpers — verbatim port of publicApp.regionChart()/trendChart()
 * from _mockups/01-public.html. Each takes a container element and
 * mounts the ECharts instance.
 *
 * COLOUR POLICY (PUBLIC-DESIGN-PRINCIPLES §D1): categorical series use the
 * neutral qualitative ramp from base.css (--c-slate/-bronze/-plum/-teal),
 * NEVER the status tokens (--good/--watch/--alert) — a red bar must not read
 * as "alert" on a neutral indicator chart. Chart chrome (axes/grid/legend)
 * pulls from the ink/border tokens. Values mirrored here as constants because
 * this is TS, not CSS; keep them in sync with base.css.
 */
import * as echarts from 'echarts';

/** Categorical viz ramp — COPIES the internal-BI cool-slate chart language
 *  (their charts step slate value: navy-700 → navy-500 → ink-4, with red
 *  reserved for alarms only). Penta3/ANC4/SBA take three slate steps for a
 *  calm monochrome read that harmonises with the slate chrome; mCPR (4th,
 *  line-only) takes one muted cool-teal accent. No warm/status hues. */
const PALETTE = ['#334155', '#64748B', '#94A3B8', '#4E7C87'];
/** Chart chrome tokens (base.css). */
const AXIS = {
  label:  '#374151', // --ink-2  : legend + category labels
  tick:   '#9ca3af', // --ink-4  : numeric tick labels
  grid:   '#e5e7eb', // --border : split/grid lines
  line:   '#d1d5db', // --border-2 : axis lines
};

/** ECharts-shaped live data adapted from a gateway widget-data payload
 *  ({columns, rows}) by the calling section. Undefined → static mockup. */
export type ChartData = { x: string[]; series: { name: string; data: (number | null)[] }[] };

/** Reuse the instance when the mount effect re-runs (live data arriving,
 *  StrictMode double-invoke) instead of double-initialising the DOM node. */
function mount(el: HTMLElement) {
  return echarts.getInstanceByDom(el) ?? echarts.init(el);
}

/** `live` (from the pub-region widget-data seam: region × coverage indicator,
 *  latest month) replaces the static mockup bars when present. */
export function regionChart(el: HTMLElement, live?: ChartData): void {
  const c = mount(el);
  const regions = live ? live.x
    : ['Addis Ababa','Sidama','Harari','Dire Dawa','Amhara','Oromia','South Ethiopia','Central','S.West','Tigray','Benishangul','Gambella','Afar','Somali'];
  const series = live
    ? live.series.map((s, i) => ({
        name: s.name, type: 'bar' as const, data: s.data,
        itemStyle: { color: PALETTE[i % PALETTE.length] }, barWidth: 8,
      }))
    : [
        { name: 'Penta3', type: 'bar' as const, data: [96,93,94,92,89,90,86,84,81,75,68,62,54,48], itemStyle: { color: PALETTE[0] }, barWidth: 8 },
        { name: 'ANC4',   type: 'bar' as const, data: [78,71,73,70,65,64,60,57,53,50,45,38,32,27], itemStyle: { color: PALETTE[1] }, barWidth: 8 },
        { name: 'SBA',    type: 'bar' as const, data: [92,76,77,72,58,56,52,48,44,42,35,30,24,21], itemStyle: { color: PALETTE[2] }, barWidth: 8 },
      ];
  c.setOption({
    grid: { left: 90, right: 12, top: 30, bottom: 40 },
    legend: { data: series.map(s => s.name), top: 0, textStyle: { fontSize: 11, color: AXIS.label } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%', fontSize: 11, color: AXIS.tick }, splitLine: { lineStyle: { color: AXIS.grid } } },
    yAxis: { type: 'category', data: regions, axisTick: { show: false }, axisLine: { show: false }, axisLabel: { fontSize: 11, color: AXIS.label } },
    series,
  }, true);
}

/** Radial gauge — reporting-completeness "data confidence". Slate progress arc
 *  on a light track, centred % readout. Themed to the chrome (no status hues). */
export function gaugeChart(el: HTMLElement, value: number): void {
  const c = mount(el);
  c.setOption({
    series: [{
      type: 'gauge',
      startAngle: 210, endAngle: -30, min: 0, max: 100,
      radius: '96%', center: ['50%', '62%'],
      progress: { show: true, width: 11, itemStyle: { color: PALETTE[0] } }, // #334155 slate
      axisLine: { lineStyle: { width: 11, color: [[1, AXIS.grid]] } },
      pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false },
      axisLabel: { show: false }, anchor: { show: false }, title: { show: false },
      detail: {
        valueAnimation: true, offsetCenter: [0, '-2%'],
        fontSize: 26, fontWeight: 700, color: AXIS.label,
        fontFamily: 'Inter, system-ui, sans-serif', formatter: '{value}%',
      },
      data: [{ value }],
    }],
  }, true);
}

/** `live` (from the pub-insights widget-data seam) replaces the static
 *  mockup series when present; undefined keeps the mockup rendering. */
export function trendChart(el: HTMLElement, live?: ChartData): void {
  const c = mount(el);
  const staticMonths = ['Jun 24','Jul','Aug','Sep','Oct','Nov','Dec','Jan 25','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan 26','Feb','Mar','Apr','May','Jun'];
  const fn = (b: number, amp: number) =>
    staticMonths.map((_, i) => b + amp * Math.cos(2 * Math.PI * (i - 3) / 12) + (Math.random() - 0.5) * 1.5);
  const months = live ? live.x : staticMonths;
  const series = live
    ? live.series.map((s, i) => ({
        name: s.name, type: 'line' as const, smooth: true, symbol: 'none', data: s.data,
        lineStyle: { color: PALETTE[i % PALETTE.length], width: 2.2 },
        // legend swatch follows the line colour
        itemStyle: { color: PALETTE[i % PALETTE.length] },
      }))
    : [
        { name: 'Penta3', type: 'line' as const, smooth: true, symbol: 'none', data: fn(89, 3), lineStyle: { color: PALETTE[0], width: 2.2 }, itemStyle: { color: PALETTE[0] } },
        { name: 'ANC4',   type: 'line' as const, smooth: true, symbol: 'none', data: fn(60, 3), lineStyle: { color: PALETTE[1], width: 2.2 }, itemStyle: { color: PALETTE[1] } },
        { name: 'SBA',    type: 'line' as const, smooth: true, symbol: 'none', data: fn(52, 3), lineStyle: { color: PALETTE[2], width: 2.2 }, itemStyle: { color: PALETTE[2] } },
        { name: 'mCPR',   type: 'line' as const, smooth: true, symbol: 'none', data: fn(40, 2), lineStyle: { color: PALETTE[3], width: 2.2 }, itemStyle: { color: PALETTE[3] } },
      ];
  c.setOption({
    grid: { left: 40, right: 12, top: 30, bottom: 32 },
    legend: { data: series.map(s => s.name), top: 0, textStyle: { fontSize: 11, color: AXIS.label } },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: months, axisLabel: { fontSize: 11, color: AXIS.tick }, axisLine: { lineStyle: { color: AXIS.line } } },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%', fontSize: 11, color: AXIS.tick }, splitLine: { lineStyle: { color: AXIS.grid } } },
    series,
  }, true);
}
