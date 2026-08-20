import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import T from '../theme';
import { WH_BY_ID, NODE_BY_ID } from '../data/runtime';
import { filterMovements, type Slicer } from '../lib/select';

// Network-flow view: ZAMMSA zonal store → zone → region, link width = units.
function flowOption(slicer: Slicer): echarts.EChartsOption {
  const movs = filterMovements(slicer);
  const agg: Record<string, number> = {};
  for (const m of movs) {
    const w = WH_BY_ID[m.fromId], n = NODE_BY_ID[m.toId];
    const key = `${w.name}||${n.region}`;
    agg[key] = (agg[key] || 0) + m.units;
  }
  const whNames = Array.from(new Set(movs.map(m => WH_BY_ID[m.fromId].name)));
  const regionSet = Array.from(new Set(movs.map(m => NODE_BY_ID[m.toId].region)));
  const nodes = [
    ...whNames.map(n => ({ name: n, itemStyle: { color: T.ink2 } })),
    ...regionSet.map(n => ({ name: n, itemStyle: { color: T.route } })),
  ];
  const links = Object.entries(agg).map(([k, v]) => {
    const [source, target] = k.split('||');
    return { source, target, value: v };
  });
  return {
    tooltip: {
      trigger: 'item', triggerOn: 'mousemove',
      backgroundColor: '#fff', borderColor: T.border, textStyle: { color: T.ink, fontSize: 12 },
      extraCssText: 'box-shadow:0 8px 24px rgba(15,23,42,.14);border-radius:8px;',
    },
    series: [{
      type: 'sankey', left: 14, right: 150, top: 18, bottom: 18,
      nodeGap: 7, nodeWidth: 13, draggable: false,
      emphasis: { focus: 'adjacency' },
      data: nodes, links,
      lineStyle: { color: 'gradient', opacity: 0.34, curveness: 0.5 },
      label: { color: T.ink2, fontSize: 10.5, fontWeight: 500 },
      itemStyle: { borderWidth: 0 },
    }],
  };
}

export default function FlowView({ slicer }: { slicer: Slicer }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.dispose(); chartRef.current = null; };
  }, []);

  useEffect(() => { chartRef.current?.setOption(flowOption(slicer), true); }, [slicer]);

  return <div className="ct-map" ref={ref} />;
}
