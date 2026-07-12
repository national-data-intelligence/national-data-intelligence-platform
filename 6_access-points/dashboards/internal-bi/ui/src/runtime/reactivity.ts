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

/** DIM → the query-param the gateway narrows on. geography/programme/period are
 *  accepted directly (the gateway aliases region↔geography server-side). */
const DIM_PARAM: Record<string, string> = {
  geography: 'geography', programme: 'programme', period: 'period',
  model: 'model', commodity: 'commodity',
};

/**
 * The narrowing params to inject into a widget's data fetch. For each dim the
 * widget REACTS TO, send the ACTIVE value IFF the widget's fetcher supports that
 * dim (supports[dim] !== false). This is the opt-out: a national / opted-out
 * widget (reactsTo:[] or supports[dim] === false) sends nothing for that dim and
 * never narrows. The server still caps every value against role_scope ∩
 * user_scope (gateway permissions.py), so injection can only INTERSECT a role's
 * scope — never widen it. Widget-supplied params (local selectors) win over these.
 */
export function filterParamsForWidget(
  w: ResolvedWidget, reacts: readonly string[], state: FilterState,
): Record<string, string> {
  const out: Record<string, string> = {};
  const sup = w.supports;
  for (const dim of reacts) {
    if (!isDimActive(state, dim)) continue;
    if (sup && sup[dim] === false) continue;   // fetcher can't narrow this dim → skip
    out[DIM_PARAM[dim] || dim] = String(state[dim]);
  }
  return out;
}

/**
 * The dims a widget re-fetches / re-renders on when a filter changes. An explicit
 * reactsTo (WidgetDef.reactsTo, else the catalog reacts_to) wins; otherwise DEFAULT
 * to the dims the widget's fetcher SUPPORTS. This is what makes a widget that
 * declared no reactsTo still adapt to the filters it can honour — the root fix for
 * "some widgets don't react at all". Unbound widgets (supports == null) react to
 * nothing, correctly.
 */
export function effectiveReactsTo(
  reactsTo: readonly string[] | undefined,
  catalogReacts: readonly string[] | undefined,
  supports: Record<string, boolean> | null | undefined,
): string[] {
  if (reactsTo && reactsTo.length) return [...reactsTo];
  if (catalogReacts && catalogReacts.length) return [...catalogReacts];
  return supports ? GLOBAL_DIMS.filter(d => supports[d] === true) : [];
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
