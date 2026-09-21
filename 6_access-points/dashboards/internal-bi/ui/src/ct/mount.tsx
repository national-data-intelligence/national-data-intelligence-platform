/** Wrapper components that connect the shared CT store to the migrated standalone
 *  components, so each internal-BI widget mounts one cohesive block exactly as the
 *  original App.tsx laid them out (filters · KPIs · movement network + rail · dispatch).
 *  Each block is wrapped in `.ct-scope` so the CT design tokens apply locally only. */
import FilterBar from './components/FilterBar';
import KpiCards from './components/KpiCards';
import MapView from './components/MapView';
import FlowView from './components/FlowView';
import MovementPanel from './components/MovementPanel';
import DispatchRoutes from './components/DispatchRoutes';
import { useEffect } from 'react';
import { filterMovements, rankedShipments } from './lib/select';
import { MOVEMENTS, ensurePlanLoaded } from './data/runtime';
import { IconRoute, IconHubSpoke, IconSankey, IconFocus } from './icons';
import { useCT, setCT, setSlice, resetSlice, bumpFocus, bumpData, type CTView } from './store';
import './styles/base.css';
import './styles/control-tower.css';

/** Fetch the mart-backed plan once from /gw/ct/plan (idempotent); on success bump
 *  the store so the mounted islands re-render with real data. If the gateway is
 *  unreachable the bundled static plan stays and the page still works. */
function useCTLoad(): void {
  useEffect(() => { ensurePlanLoaded().then(ok => { if (ok) bumpData(); }); }, []);
}

const Scope = ({ children }: { children: any }) => (
  <div className="ct-scope" style={{ width: '100%' }}>{children}</div>
);

export function CTFilters() {
  const { slicer } = useCT();
  return <Scope><FilterBar slicer={slicer} setSlice={setSlice} reset={resetSlice} /></Scope>;
}

export function CTKpis() {
  const { slicer } = useCT();
  return <Scope><KpiCards slicer={slicer} /></Scope>;
}

export function CTDispatch() {
  const { slicer } = useCT();
  return <Scope><DispatchRoutes slicer={slicer} /></Scope>;
}

const VIEWS: { id: CTView; label: string; Icon: (p: any) => JSX.Element }[] = [
  { id: 'routes', label: 'Optimized routes', Icon: IconRoute },
  { id: 'network', label: 'Distribution network', Icon: IconHubSpoke },
  { id: 'flow', label: 'Flow volumes', Icon: IconSankey },
];

/** The centrepiece: the movement-network map card (three views) + the right rail —
 *  reproduces App.tsx's `#sec-network` block verbatim, driven by the shared store. */
export function CTMovement() {
  const { slicer, selectedId, view, focusNonce } = useCT();
  useCTLoad();   // fetch mart-backed plan once; re-renders all CT widgets when it lands
  const filtered = filterMovements(slicer);
  const selected = filtered.find(m => m.id === selectedId) || rankedShipments(slicer)[0]
    || MOVEMENTS.find(m => m.planned);
  const setView = (v: CTView) => setCT({ view: v });
  const onSelect = (id: string) => setCT({ selectedId: id });

  if (!selected) {
    return <Scope><section id="sec-network" className="ct-grid"><div className="ct-empty">No plan data available.</div></section></Scope>;
  }
  return (
    <Scope>
      <section id="sec-network" className="ct-grid">
        <section className="ct-mapcard">
          <div className="ct-mapcard-hdr">
            <div className="ttl"><h3>Movement network</h3></div>
            <div className="ct-mapctrls">
              <div className="ct-seg">
                {VIEWS.map(v => (
                  <button key={v.id} className={view === v.id ? 'active' : ''} onClick={() => setView(v.id)}>
                    <v.Icon /> {v.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="ct-legend">
            {view === 'routes' && (<>
              <span className="lg"><span className="ln" /> Delivery run</span>
              <span className="lg"><span className="wh" /> District store</span>
              <span className="lg"><span className="dn" /> Facility</span>
              <span className="spacer" />
              <button className="ct-focusbtn" onClick={() => bumpFocus()}><IconFocus /> Focus view</button>
            </>)}
            {view === 'network' && (<>
              <span className="lg"><span className="ln" /> Supply lane (width is units)</span>
              <span className="lg"><span className="wh" /> District store</span>
              <span className="lg"><span className="dn" /> Facility</span>
              <span className="spacer" />
              <span className="ct-frame">Direct lanes, not road routes</span>
              <button className="ct-focusbtn" onClick={() => bumpFocus()}><IconFocus /> Focus view</button>
            </>)}
            {view === 'flow' && (<>
              <span className="lg"><span className="dn" style={{ background: 'var(--ink-2)' }} /> District store</span>
              <span className="lg"><span className="dn" /> Destination region</span>
              <span className="spacer" />
              <span className="ct-frame">Band width is units shipped</span>
            </>)}
          </div>
          <div className="ct-mapwrap">
            {view === 'flow'
              ? <FlowView slicer={slicer} />
              : <MapView layer={view as any} slicer={slicer} selectedId={selected.id} onSelect={onSelect} focusNonce={focusNonce} />}
          </div>
        </section>
        <MovementPanel movement={selected} slicer={slicer} onSelect={onSelect} />
      </section>
    </Scope>
  );
}
