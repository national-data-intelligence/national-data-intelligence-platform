/**
 * Widget · pub-insights — KPI tiles + region equity bar + 24-month trend.
 * Re-homed verbatim from sections/PublicInsights.tsx.
 *
 * ALL live: the tiles, region bar and trend read the k-anonymised public
 * marts through the widget-data seam — nothing hardcoded when the gateway
 * responds:
 *   - `pub-insights`  → bi_public.mart_public_indicator_kpis rolled to national
 *      × indicator × month (rate_pct + HSDIP target + definition). Drives the
 *      KPI tiles (latest + prior month) and the indicator trend.
 *   - `pub-region`    → the same mart at region × coverage-indicator (latest
 *      month) for the equity bar.
 * Every value traces mean_value → DHIS2. Reporting completeness is rendered as
 * a distinct TRUST tile, not among the coverage KPIs (a data-quality measure
 * must never read as coverage). The mockup arrays remain ONLY as the offline
 * fallback when the gateway returns nothing usable. This widget takes nothing
 * from the host — it is fully self-contained on the widget-data seam.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { regionChart, trendChart, type ChartData } from '../../hooks/charts';
import { useWidgetData, type WidgetData, type WidgetRow } from '../../hooks/widgetData';
import type { PublicWidget } from '../../runtime/types';

type Tone = 'good' | 'watch' | 'alert' | 'info';
type Trend = 'up' | 'down' | 'flat';
type KPI = {
  key: string; kind: string; order: number; tone: Tone; lbl: string; val: string;
  deltaTrend: Trend; deltaText: string; target: string; conf?: string; def?: string;
};

function toneFor(val: number, target: number | null, dir: string): Tone {
  if (target == null) return 'info';
  if (dir === 'lower_better') {
    if (val <= target) return 'good';
    if (val <= target * 1.15) return 'watch';
    return 'alert';
  }
  const r = val / target;
  if (r >= 0.98) return 'good';
  if (r >= 0.85) return 'watch';
  return 'alert';
}

/** pub-insights rows (national × indicator × month) → KPI tiles. */
function adaptKpis(d: WidgetData | null): KPI[] | undefined {
  const need = ['indicator_id', 'kpi_label', 'kpi_order', 'kpi_kind', 'month_id', 'rate_pct'];
  if (!d || !need.every(c => d.columns.includes(c))) return undefined;
  const byInd = new Map<string, WidgetRow[]>();
  for (const r of d.rows) {
    const id = String(r.indicator_id);
    (byInd.get(id) ?? byInd.set(id, []).get(id)!).push(r);
  }
  const tiles: KPI[] = [];
  for (const [id, rows] of byInd) {
    const sorted = rows.filter(r => r.rate_pct != null)
      .sort((a, b) => String(a.month_id).localeCompare(String(b.month_id)));
    if (!sorted.length) continue;
    const latest = sorted[sorted.length - 1];
    const prev = sorted.length > 1 ? sorted[sorted.length - 2] : undefined;
    const val = Number(latest.rate_pct);
    const target = latest.hsdip_target != null && latest.hsdip_target !== ''
      ? Number(latest.hsdip_target) : null;
    const dir = String(latest.target_direction || 'higher_better');
    const kind = String(latest.kpi_kind || 'outcome');
    const delta = prev && prev.rate_pct != null ? val - Number(prev.rate_pct) : null;
    tiles.push({
      key: id, kind, order: Number(latest.kpi_order || 99),
      tone: kind === 'trust' ? 'info' : toneFor(val, target, dir),
      lbl: String(latest.kpi_label || id),
      val: `${Math.round(val)}%`,
      deltaTrend: delta == null ? 'flat' : delta > 0.05 ? 'up' : delta < -0.05 ? 'down' : 'flat',
      deltaText: delta == null ? 'no prior month'
        : `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}pp MoM`,
      target: target == null ? ''
        : `${String(latest.target_source || 'HSDIP')} target ${dir === 'lower_better' ? '≤' : ''}${target}%`,
      conf: latest.facilities_reporting != null
        ? `${Number(latest.facilities_reporting).toLocaleString('en-US')} facilities reporting` : undefined,
      def: latest.definition ? String(latest.definition) : undefined,
    });
  }
  tiles.sort((a, b) => a.order - b.order);
  return tiles.length ? tiles : undefined;
}

/** pub-insights rows → trend ChartData (coverage indicators over months). */
function adaptTrend(d: WidgetData | null): ChartData | undefined {
  const need = ['indicator_id', 'kpi_label', 'kpi_kind', 'month_id', 'rate_pct'];
  if (!d || !need.every(c => d.columns.includes(c))) return undefined;
  const cov = d.rows.filter(r => String(r.kpi_kind) === 'coverage');
  const months = Array.from(new Set(cov.map(r => String(r.month_id))
    .filter(m => m && m !== 'null'))).sort().slice(-24);
  const inds = Array.from(new Set(cov.map(r => String(r.kpi_label)).filter(x => x && x !== 'null')));
  if (!months.length || !inds.length) return undefined;
  const series = inds.map(ind => ({
    name: ind,
    data: months.map(m => {
      const row = cov.find(r => String(r.kpi_label) === ind && String(r.month_id) === m);
      return row?.rate_pct == null ? null : Number(row.rate_pct);
    }),
  }));
  return { x: months, series };
}

/** pub-region rows (region × coverage indicator, latest month) → bar ChartData. */
function adaptRegion(d: WidgetData | null): ChartData | undefined {
  const need = ['region_name', 'kpi_label', 'rate_pct'];
  if (!d || !need.every(c => d.columns.includes(c))) return undefined;
  const inds = Array.from(new Set(d.rows.map(r => String(r.kpi_label)).filter(x => x && x !== 'null')));
  // sort regions ascending by the first indicator so the worst-served are visible
  const regions = Array.from(new Set(d.rows.map(r => String(r.region_name)).filter(x => x && x !== 'null')));
  const firstInd = inds[0];
  regions.sort((a, b) => {
    const va = Number(d.rows.find(r => String(r.region_name) === a && String(r.kpi_label) === firstInd)?.rate_pct ?? 0);
    const vb = Number(d.rows.find(r => String(r.region_name) === b && String(r.kpi_label) === firstInd)?.rate_pct ?? 0);
    return va - vb;
  });
  if (!regions.length || !inds.length) return undefined;
  const series = inds.map(ind => ({
    name: ind,
    data: regions.map(rg => {
      const row = d.rows.find(r => String(r.region_name) === rg && String(r.kpi_label) === ind);
      return row?.rate_pct == null ? null : Number(row.rate_pct);
    }),
  }));
  return { x: regions, series };
}

type Supply = { stockedPct: number; hubs: number; stocked: number; totalFacilities: number; totalRegions: number };
/** pub-supply row → national service-readiness summary. */
function adaptSupply(d: WidgetData | null): Supply | null {
  if (!d || !d.columns.includes('stocked_pct') || !d.rows.length) return null;
  const r = d.rows[0];
  const totalFacilities = Number(r.total_facilities) || 0;
  if (!totalFacilities) return null;
  return {
    stockedPct: Number(r.stocked_pct), hubs: Number(r.n_facilities),
    stocked: Number(r.n_stocked), totalFacilities,
    totalRegions: Number(r.total_regions) || 0,
  };
}

// ── Offline fallback — used ONLY when the gateway returns nothing. Values are
// REAL published figures (Ethiopia DHS 2024-25 key indicators; TB/ART/completeness
// from routine-programme estimates), NOT fabricated deltas — honesty guardrail:
// a fallback must never invent month-on-month movement the warehouse hasn't measured.
const KPIS_FALLBACK: KPI[] = [
  { key: 'PENTA3-COV', kind: 'coverage', order: 1, tone: 'alert', lbl: 'Penta3 coverage', val: '40%', deltaTrend: 'flat', deltaText: 'EDHS 2024-25', target: 'HSDIP target 95%' },
  { key: 'ANC4-COV', kind: 'coverage', order: 2, tone: 'alert', lbl: 'ANC4 coverage', val: '53%', deltaTrend: 'up', deltaText: 'EDHS 2024-25', target: 'HSDIP target 81%' },
  { key: 'SBA-COV', kind: 'coverage', order: 3, tone: 'watch', lbl: 'Skilled birth attendance', val: '64%', deltaTrend: 'up', deltaText: 'up from 12% in 2011', target: 'HSDIP target 76%' },
  { key: 'FP-MCPR', kind: 'coverage', order: 4, tone: 'alert', lbl: 'Modern contraceptive use', val: '35%', deltaTrend: 'flat', deltaText: 'unchanged since 2016', target: 'HSDIP target 50%' },
  { key: 'TB-TX-SUCC', kind: 'outcome', order: 5, tone: 'watch', lbl: 'TB treatment success', val: '89%', deltaTrend: 'flat', deltaText: 'programme data', target: 'HSDIP target 90%' },
  { key: 'HIV-VL-SUPP', kind: 'outcome', order: 6, tone: 'watch', lbl: 'ART viral suppression', val: '90%', deltaTrend: 'up', deltaText: 'programme data', target: '95-95-95 third 95' },
  { key: 'NUT-STUNT', kind: 'outcome', order: 7, tone: 'alert', lbl: 'Under-5 stunting', val: '40%', deltaTrend: 'flat', deltaText: 'EDHS 2024-25', target: 'SDG target ≤25%' },
  { key: 'PHEM-COMPL', kind: 'trust', order: 8, tone: 'info', lbl: 'Reporting completeness', val: '92%', deltaTrend: 'up', deltaText: 'routine reporting', target: 'HSDIP target 95%' },
];

const trendIcon = (t: Trend) =>
  t === 'up' ? 'i-trend-up' : t === 'down' ? 'i-trend-down' : 'i-trend-flat';

function Tile({ k }: { k: KPI }) {
  return (
    <div className={`kpi kpi-${k.tone}`} title={k.def}>
      <div className="kpi-lbl">{k.lbl}</div>
      <div className="kpi-val">{k.val}</div>
      <div className={`kpi-delta ${k.deltaTrend === 'flat' ? '' : k.deltaTrend}`}>
        <svg className="ico"><use href={`#${trendIcon(k.deltaTrend)}`} /></svg> {k.deltaText}
      </div>
      {k.target && <div className="kpi-tgt">{k.target}</div>}
      {k.conf && <div className="kpi-conf">{k.conf}</div>}
    </div>
  );
}

function PublicInsights() {
  const regionRef = useRef<HTMLDivElement>(null);
  const trendRef = useRef<HTMLDivElement>(null);
  const insightsData = useWidgetData('pub-insights');
  const regionData = useWidgetData('pub-region');
  const supplyData = useWidgetData('pub-supply');

  const kpis = useMemo(() => adaptKpis(insightsData) ?? KPIS_FALLBACK, [insightsData]);
  const trendLive = useMemo(() => adaptTrend(insightsData), [insightsData]);
  const regionLive = useMemo(() => adaptRegion(regionData), [regionData]);
  const supply = useMemo(() => adaptSupply(supplyData), [supplyData]);

  const coverage = kpis.filter(k => k.kind !== 'trust');
  const trust = kpis.filter(k => k.kind === 'trust');
  const confidence = trust[0];
  const confidenceVal = confidence ? parseInt(confidence.val, 10) : null;
  const [meterW, setMeterW] = useState(0);

  useEffect(() => {
    if (regionRef.current) regionChart(regionRef.current, regionLive);
  }, [regionLive]);
  useEffect(() => {
    if (trendRef.current) trendChart(trendRef.current, trendLive);
  }, [trendLive]);
  // Animate the confidence meter fill left→right once the value is known.
  useEffect(() => {
    const id = setTimeout(() => setMeterW(confidenceVal ?? 0), 120);
    return () => clearTimeout(id);
  }, [confidenceVal]);

  return (
    <section id="headline" className="page-section page-section--insights">
      <div className="ins-hdr">
        <div>
          <p className="ins-eyebrow"><span className="ins-rule"></span> Health of the nation, in numbers</p>
          <h2 className="ins-h2">Public insights</h2>
          <p className="ins-sub">National coverage figures from the 2024-25 Ethiopia DHS, with programme indicators from the warehouse marts. Aggregated to national and regional level, k-anonymity ≥ 5.</p>
        </div>
      </div>

      <div className="grid grid-4">
        {coverage.map(k => <Tile key={k.key} k={k} />)}
        {confidenceVal != null && (
          <div className="kpi kpi-info pi-conf-tile" title={confidence.def}>
            <div className="kpi-lbl">Data confidence</div>
            <div className="kpi-val">{confidence.val}</div>
            <div className="conf-meter"><span className="conf-fill" style={{ width: `${meterW}%` }} /></div>
            <div className="kpi-tgt">Reporting completeness, not a coverage rate</div>
          </div>
        )}
      </div>

      {supply && (
        <div className="trust-strip readiness-strip">
          <span className="trust-strip-lbl">Service readiness</span>
          <div className="trust-tile">
            <span className="trust-tile-val">{supply.totalFacilities.toLocaleString('en-US')}</span>
            <span className="trust-tile-lbl">health facilities · {supply.totalRegions} regions</span>
          </div>
          <div className="trust-tile">
            <span className="trust-tile-val">{Math.round(supply.stockedPct)}%</span>
            <span className="trust-tile-lbl">commodity availability · {supply.stocked}/{supply.hubs} supply hubs stocked</span>
          </div>
          <span className="trust-strip-note">Facility coverage and commodity availability, aggregate and k-anonymity-protected.</span>
        </div>
      )}

      <div className="grid grid-2 mt-lg">
        <div className="card card-elev">
          <div className="card-hdr">
            <h4>Coverage by region, latest period</h4>
            <span className="meta">{regionLive ? `${regionLive.series.length} indicators · all 14 regions` : 'Penta3 / ANC4 / SBA · all 14 regions'}</span>
          </div>
          <div id="region-chart" ref={regionRef} className="ch-lg"></div>
        </div>
        <div className="card card-elev">
          <div className="card-hdr">
            <h4>National headline trends, last 24 months</h4>
            <span className="meta">
              {trendLive ? `Monthly · ${trendLive.series.length} indicators` : 'Monthly · 4 indicators'}
            </span>
          </div>
          <div id="trend-chart" ref={trendRef} className="ch-lg"></div>
        </div>
      </div>
    </section>
  );
}

const widget: PublicWidget = { id: 'pub-insights', Component: PublicInsights };
export default widget;
