/**
 * Local-filter pinning — the MANDATED seam for any widget-local control that
 * shares a dimension with the GLOBAL filter (owner rule 4, 2026-07-07):
 *
 *   When a global dim is ACTIVE (value ≠ 'all'), a widget-local control on the
 *   SAME dim must PIN to the global value: it renders as a locked chip (the
 *   exact visual language of the global-filter widget's role-locked state), is
 *   excluded from user interaction, and the widget fetches/filters with the
 *   global value. When the global returns to 'all', the local control unlocks.
 *
 * The "active" definition is shared with the scope-visibility logic
 * (runtime/reactivity.ts) so hiding and pinning can never disagree.
 *
 * AUDIT 2026-07-07: no in-tree widget currently renders a local
 * region/programme/period control (every local control today is a model /
 * metric / format / preference selector on a NON-global dimension — swept all
 * widget folders). This helper is therefore applied by CONTRACT, not retrofit:
 * any widget that adds a local control on geography/programme/period MUST
 * route it through pinnedDims()/effectiveDimValue() and render lockedChipHtml()
 * while pinned. The st-display "default period" select is deliberately NOT
 * pinned — it edits a saved preference (the default for future sessions), not
 * the live filter state, so pinning it would not protect scope consistency.
 */
import type { FilterBus } from '../../runtime/types';
import { GLOBAL_DIMS, isDimActive } from '../../runtime/reactivity';

/** Pin state for one global dimension. */
export interface DimPin {
  /** true ⇔ the global dim is ACTIVE — the local control must lock to it. */
  pinned: boolean;
  /** The global value while pinned; 'all' (or the bus value) otherwise. */
  value: string;
}

/** Per-dim pin state from the live bus: {geography, programme, period}. */
export function pinnedDims(bus: FilterBus): Record<string, DimPin> {
  const s = bus.get();
  const out: Record<string, DimPin> = {};
  for (const d of GLOBAL_DIMS) out[d] = { pinned: isDimActive(s, d), value: s[d] ?? 'all' };
  return out;
}

/** The value a widget must fetch/filter with for `dim`: the GLOBAL value while
 *  the dim is pinned (the user may not contradict the scope), else the
 *  widget's own local choice. */
export function effectiveDimValue(bus: FilterBus, dim: string, localChoice: string): string {
  const s = bus.get();
  return isDimActive(s, dim) ? s[dim] : localChoice;
}

const esc = (v: string) => String(v).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** Locked-chip markup — identical classes/icon to the global-filter widget's
 *  role-locked chip, so a pinned LOCAL control reads as the same concept:
 *  "this dimension is decided elsewhere". Render this INSTEAD of the widget's
 *  interactive control while the dim is pinned. */
export function lockedChipHtml(label: string, valueLabel: string): string {
  return `<span class="dropdown">
    <span class="filter-chip locked" title="Pinned to the global ${esc(label)} scope">
      <span class="key">${esc(label)}</span>
      <span class="val">${esc(valueLabel)}</span>
      <svg class="ico ico-sm"><use href="#i-lock"/></svg>
    </span></span>`;
}

/**
 * One-call helper for a widget's local dim control:
 *   returns null while the dim is NOT pinned (draw your interactive control),
 *   or the locked-chip HTML to draw instead (and fetch with pin.value).
 *
 *   const pin = pinnedDims(ctx.bus).geography;
 *   const chip = pinnedControlHtml(ctx.bus, 'geography', 'Region', labelFor);
 *   controls.innerHTML = chip ?? renderMyRegionSelect();
 */
export function pinnedControlHtml(
  bus: FilterBus,
  dim: string,
  label: string,
  labelFor?: (value: string) => string,
): string | null {
  const s = bus.get();
  if (!isDimActive(s, dim)) return null;
  const v = s[dim];
  return lockedChipHtml(label, labelFor ? labelFor(v) : v);
}
