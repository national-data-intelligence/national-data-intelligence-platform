/**
 * Global-filter reactivity — the ONE definition of scope visibility + reflow
 * arithmetic (owner-approved design, 2026-07-07). Consumed by:
 *
 *   · PageRenderer   — hides/shows widget cards + reflows the section grid on
 *                      every filter-bus change;
 *   · widgets/_shared/localFilters.ts — pins widget-local dim controls to an
 *                      ACTIVE global value (same "active" definition, so a
 *                      widget can never contradict the scope that hides its
 *                      neighbours).
 *
 * THE CONTRACT (gateway ⇄ UI, fixed):
 *   · The resolved spec's bound widgets carry `supports: {geography, programme,
 *     period}` (api/spec.ts WidgetSupports).
 *   · A widget is hidden IFF some global dim is ACTIVE (value ≠ 'all') AND the
 *     widget declares supports[dim] === false.
 *   · A widget WITHOUT a supports key is NEVER hidden — the safety fallback
 *     that preserves behaviour until (and wherever) the gateway ships supports.
 *   · Period is NOT special: supports.period === false hides the widget while
 *     a period is active, exactly like geography/programme. ('all' is reachable
 *     for period via the global filter's Reset.)
 */
import type { FilterState } from './types';
import type { ResolvedWidget } from '../api/spec';

/** The named global dimensions the reactivity contract covers. */
export const GLOBAL_DIMS = ['geography', 'programme', 'period'] as const;

/** A dim is ACTIVE when it holds a real value — i.e. anything but 'all'. */
export function isDimActive(state: FilterState, dim: string): boolean {
  const v = state[dim];
  return v != null && v !== '' && v !== 'all';
}

/** The subset of GLOBAL_DIMS currently active. */
export function activeDims(state: FilterState): string[] {
  return GLOBAL_DIMS.filter(d => isDimActive(state, d));
}

/** Scope visibility: hidden iff ∃ an active dim the widget declares it cannot
 *  honour (supports[dim] === false). No supports key → never hidden. */
export function isWidgetHiddenAtScope(w: ResolvedWidget, state: FilterState): boolean {
  const sup = w.supports;
  if (!sup || typeof sup !== 'object') return false;   // safety fallback
  return GLOBAL_DIMS.some(d => sup[d] === false && isDimActive(state, d));
}

/**
 * Grid redistribution — pack widgets greedily into rows by their DECLARED
 * col_span (a widget that would overflow the row starts the next one), then
 * grow each underfilled row's widgets PROPORTIONALLY to their declared spans
 * so the row fills all `cols` tracks (largest-remainder rounding keeps the
 * sum exact). Rows that already sum to `cols` come back unchanged, so the
 * at-rest layout is identical to the catalog's declared spans.
 *
 * Returns the effective span per input index. Pure — used for the initial
 * paint AND every scope reflow, so there is exactly one layout algorithm.
 */
export function packRows(declared: number[], cols: number): number[] {
  const out = declared.slice();
  let row: number[] = [];
  let sum = 0;
  const flush = () => {
    if (row.length && sum < cols) {
      const exact = row.map(i => (declared[i] * cols) / sum);
      const base = exact.map(Math.floor);
      let used = base.reduce((a, b) => a + b, 0);
      // Hand the remaining tracks to the largest fractional remainders.
      const order = row.map((_, k) => k)
        .sort((a, b) => (exact[b] - base[b]) - (exact[a] - base[a]));
      for (let k = 0; used < cols && order.length; k++, used++) base[order[k % order.length]]++;
      row.forEach((i, k) => { out[i] = base[k]; });
    }
    row = []; sum = 0;
  };
  declared.forEach((s, i) => {
    if (sum + s > cols && row.length) flush();
    row.push(i); sum += s;
  });
  flush();
  return out;
}
