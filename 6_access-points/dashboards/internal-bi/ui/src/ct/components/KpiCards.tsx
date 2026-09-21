import { summarize, filterMovements, type Slicer } from '../lib/select';
import { KPIS, NODES, WH_BY_ID } from '../data/runtime';
import { IconCoverBar, IconPallet, IconDepotFan, IconStockShort, IconShieldCheck, IconAlertTriangle, IconRunout, IconGauge } from '../icons';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

// Slop-filtered: no chips (all were S6/S7 filler), each card carries ONE informative
// count as its secondary line, not a buzzword restatement of the value.
export default function KpiCards({ slicer }: { slicer: Slicer }) {
  const movs = filterMovements(slicer);
  const s = summarize(movs);
  const cards = [
    { key: 'cover', tint: 'green', Icon: IconCoverBar, label: 'Needs covered',
      value: s.coveredPct != null ? `${Math.round(s.coveredPct)}%` : 'no data', sub: `${fmt(s.uncovered)} at-risk needs open` },
    { key: 'units', tint: 'blue', Icon: IconPallet, label: 'Units to ship',
      value: fmt(s.units), sub: `${fmt(s.legs)} deliveries` },
    { key: 'runs', tint: 'amber', Icon: IconDepotFan, label: 'Delivery runs',
      value: fmt(s.runCount), sub: `${fmt(s.stops)} facilities served` },
    { key: 'risk', tint: 'violet', Icon: IconStockShort, label: 'Facilities at risk',
      value: fmt(s.facilitiesAtRisk), sub: `of ${fmt(s.facilities)} facilities` },
  ];

  // Stock-health row: the same card anatomy, pooled from numerator/denominator as the
  // KPI definitions say (availability pools its tracer categories). Region scope
  // follows the Region filter, or the selected district store's region.
  const regionName = slicer.region !== 'all' ? slicer.region
    : slicer.hub !== 'all' ? WH_BY_ID[slicer.hub]?.zone : null;
  const regionId = regionName ? NODES.find(n => n.region === regionName)?.regionId ?? null : null;
  const pooled = (kpi: string, category?: string) => {
    let n = 0, d = 0;
    for (const k of KPIS) {
      if (k.kpi !== kpi || (category !== undefined && k.category !== category)) continue;
      if (regionId && k.regionId !== regionId) continue;
      n += k.numerator || 0; d += k.denominator || 0;
    }
    return d > 0 ? (100 * n) / d : null;
  };
  const pct = (v: number | null) => (v == null ? 'no data' : `${v.toFixed(1)}%`);
  const target = KPIS.find(k => k.kpi === 'osa_s8' && k.target != null)?.target ?? null;
  const days = pooled('stockout_days_rate');
  const health = [
    { key: 'osa', tint: 'green', Icon: IconShieldCheck, label: 'On-shelf availability',
      value: pct(pooled('osa_s8')), sub: target != null ? `Target ${target}%` : 'Tracer products' },
    { key: 'exp', tint: 'blue', Icon: IconAlertTriangle, label: 'Stockout exposure',
      value: pct(pooled('stockout_exposure')), sub: 'Tracer facility-products' },
    { key: 'days', tint: 'amber', Icon: IconRunout, label: 'Stockout days',
      value: days == null ? 'no data' : days.toFixed(1), sub: 'Per 100 days' },
    { key: 'pol', tint: 'violet', Icon: IconGauge, label: 'Stock within policy',
      value: pct(pooled('mos_band', 'within_policy')), sub: 'Max-min band' },
  ];

  return (
    <div className="pct-kpis">
      {[...cards, ...health].map(c => (
        <div key={c.key} className="pct-kpi">
          <span className={`pct-kpi-ico ${c.tint}`}><c.Icon /></span>
          <div className="pct-kpi-body">
            <span className="pct-kpi-lbl">{c.label}</span>
            <span className="pct-kpi-val">{c.value}</span>
            <span className="pct-kpi-sub">{c.sub}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
