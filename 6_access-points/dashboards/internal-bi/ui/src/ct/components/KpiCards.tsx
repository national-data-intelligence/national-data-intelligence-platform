import { summarize, filterMovements, type Slicer } from '../lib/select';
import { IconCoverBar, IconPallet, IconDepotFan, IconTruckFill } from '../icons';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

// Slop-filtered: no chips (all were S6/S7 filler), each card carries ONE informative
// count as its secondary line, not a buzzword restatement of the value.
export default function KpiCards({ slicer }: { slicer: Slicer }) {
  const movs = filterMovements(slicer);
  const s = summarize(movs);
  const cards = [
    { key: 'cover', tint: 'green', Icon: IconCoverBar, label: 'Shortages covered',
      value: s.legs > 0 ? '100%' : 'no data', sub: `${s.uncovered} uncovered` },
    { key: 'units', tint: 'blue', Icon: IconPallet, label: 'Units to ship',
      value: fmt(s.units), sub: `${fmt(s.legs)} deliveries` },
    { key: 'runs', tint: 'amber', Icon: IconDepotFan, label: 'Vehicle runs',
      value: fmt(s.runCount), sub: `${s.origins} dispatch origins` },
    { key: 'fill', tint: 'violet', Icon: IconTruckFill, label: 'Avg vehicle fill',
      value: `${Math.round(s.avgFill * 100)}%`, sub: `${fmt(s.units)} units loaded` },
  ];

  return (
    <div className="pct-kpis">
      {cards.map(c => (
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
