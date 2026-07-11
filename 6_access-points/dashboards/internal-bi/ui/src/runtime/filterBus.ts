/**
 * Filter bus — the single owner of global-filter state, and the ONLY channel
 * for cross-widget interaction. Widgets publish on named dimensions (a map
 * click sets `geography`) and subscribe via their `reactsTo` list; there are no
 * free-form widget-to-widget messages (plan §B6.7 — one state owner, auditable).
 *
 * It bridges to the legacy biApp filter state so the existing GlobalFilter chrome
 * keeps working during the migration: biApp.setFilter is the writer of record;
 * this bus mirrors reads and forwards writes to it.
 */
import type { FilterState, FilterBus } from './types';
import { getBiApp } from '../biApp';

type Listener = { dims: string[]; cb: (s: FilterState) => void };
const listeners = new Set<Listener>();

function snapshot(): FilterState {
  const f = getBiApp()?.filters || {};
  return { geography: f.geography ?? 'all', programme: f.programme ?? 'all', period: f.period ?? 'all', ...f };
}

/** Fire subscribers whose declared dims intersect `changed` (or all, if the
 *  change set is unknown). Called by the shell after the GlobalFilter mutates. */
export function emitFilterChange(changed?: string[]): void {
  const s = snapshot();
  for (const l of listeners) {
    if (!changed || l.dims.length === 0 || l.dims.some(d => changed.includes(d))) l.cb(s);
  }
}

export const filterBus: FilterBus = {
  get: snapshot,
  set(dim, value) {
    const app = getBiApp();
    if (app?.setFilter) app.setFilter(dim, value);   // biApp mirrors + re-renders
    emitFilterChange([dim]);
  },
  subscribe(dims, cb) {
    const l: Listener = { dims, cb };
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
