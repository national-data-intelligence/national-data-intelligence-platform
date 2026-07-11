/**
 * Filter bus — the single owner of cross-widget selection state, and the ONLY
 * channel for cross-widget interaction. Widgets publish on named dimensions
 * (the models table sets `ws_model`, the projects table sets `ws_project`)
 * and subscribe via their `reactsTo` list; there are no free-form
 * widget-to-widget messages (one state owner, auditable interactions).
 *
 * Workshop adaptation of the internal-bi bus: internal-bi bridged to its
 * legacy biApp filter store; the workshop shell has no legacy store, so this
 * bus OWNS the state. The classic global dims keep their defaults for
 * contract parity with the runtime types; the workshop's own dims are the
 * master-detail selections (`ws_model`, `ws_project`) plus refresh pokes.
 */
import type { FilterState, FilterBus } from './types';

const state: FilterState = {
  geography: 'all',
  programme: 'all',
  period: 'last_12wk',
  ws_model: '',
  ws_project: '',
};

type Listener = { dims: string[]; cb: (s: FilterState) => void };
const listeners = new Set<Listener>();

function snapshot(): FilterState {
  return { ...state };
}

/** Fire subscribers whose declared dims intersect `changed` (or all, if the
 *  change set is unknown). */
export function emitFilterChange(changed?: string[]): void {
  const s = snapshot();
  for (const l of listeners) {
    if (!changed || l.dims.length === 0 || l.dims.some(d => changed.includes(d))) {
      try { l.cb(s); } catch { /* one bad subscriber never breaks the bus */ }
    }
  }
}

export const filterBus: FilterBus = {
  get: snapshot,
  set(dim, value) {
    if (state[dim] === value) return;   // idempotent — same value, no redraw storm
    state[dim] = value;
    emitFilterChange([dim]);
  },
  subscribe(dims, cb) {
    const l: Listener = { dims, cb };
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
