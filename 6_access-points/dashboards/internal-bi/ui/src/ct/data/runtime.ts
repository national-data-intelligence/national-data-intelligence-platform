/**
 * Runtime data holder for the Supply Control Tower.
 *
 * Initialised from the bundled static plan (`plan.ts`, the offline fallback), then
 * repopulated from the REAL marts via the gateway route `/gw/ct/plan` on first
 * mount. Every CT module imports the plan symbols from HERE instead of `plan.ts`,
 * so ES live-bindings propagate the swap to all importers with zero component
 * changes — `filterMovements`, the map, the rail and the dispatch table all read
 * the mart-backed data once it arrives, and the static bundle keeps the page alive
 * if the gateway is unreachable.
 */
import * as STATIC from './plan';
import { authFetch } from '../../api/useAuth';

// Re-export the (unchanging) type surface + helper so importers need nothing from plan.ts.
export type { Warehouse, DeliveryNode, Why, Movement, StopLine, VehicleStop, VehicleRun, Period } from './plan';
export { byId } from './plan';

// Mutable data bindings — start from the static plan, reassigned by applyPlan().
export let REGIONS = STATIC.REGIONS;
export let REGION_NAMES = STATIC.REGION_NAMES;
export let PERIODS = STATIC.PERIODS;
export let CURRENT_PERIOD = STATIC.CURRENT_PERIOD;
export let COMMODITIES = STATIC.COMMODITIES;
export let WAREHOUSES = STATIC.WAREHOUSES;
export let NODES = STATIC.NODES;
export let MOVEMENTS = STATIC.MOVEMENTS;
export let VEHICLE_RUNS = STATIC.VEHICLE_RUNS;
export let SELECTED_ID = STATIC.SELECTED_ID;
export let PERIOD_STATS = STATIC.PERIOD_STATS;
export let SUMMARY = STATIC.SUMMARY;
export let BASELINE = STATIC.BASELINE;
export let WH_BY_ID = STATIC.WH_BY_ID;
export let NODE_BY_ID = STATIC.NODE_BY_ID;
export let RUN_BY_ID = STATIC.RUN_BY_ID;

const _byId = (xs: any[]): Record<string, any> =>
  Object.fromEntries((xs || []).map((x: any) => [x.id, x]));

/** Reassign the live bindings from a `/gw/ct/plan` payload (shape mirrors plan.ts). */
export function applyPlan(p: any): void {
  if (!p || typeof p !== 'object') return;
  if (p.regions) REGIONS = p.regions;
  if (p.regionNames) REGION_NAMES = p.regionNames;
  if (p.periods) PERIODS = p.periods;
  if (p.currentPeriod) CURRENT_PERIOD = p.currentPeriod;
  if (p.commodities) COMMODITIES = p.commodities;
  if (p.warehouses) { WAREHOUSES = p.warehouses; WH_BY_ID = _byId(WAREHOUSES); }
  if (p.nodes) { NODES = p.nodes; NODE_BY_ID = _byId(NODES); }
  if (p.movements) MOVEMENTS = p.movements;
  if (p.vehicleRuns) { VEHICLE_RUNS = p.vehicleRuns; RUN_BY_ID = _byId(VEHICLE_RUNS); }
  if (p.selectedId) SELECTED_ID = p.selectedId;
  if (p.periodStats) PERIOD_STATS = p.periodStats;
  if (p.summary) SUMMARY = p.summary;
  if (p.baseline) BASELINE = p.baseline;
}

let _loaded = false;
/** Fetch the mart-backed plan once. Returns true if real data replaced the static fallback. */
export async function ensurePlanLoaded(): Promise<boolean> {
  if (_loaded) return true;
  _loaded = true;
  try {
    const r = await authFetch('/gw/ct/plan');
    if (!r.ok) return false;
    const p = await r.json();
    applyPlan(p);
    return true;
  } catch {
    return false;   // keep the static bundle
  }
}
