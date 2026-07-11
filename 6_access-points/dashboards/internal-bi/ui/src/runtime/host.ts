/**
 * Host API — the surface a widget (notably the cross-page assistant) uses to
 * drive the shell: navigate to a page, focus/scroll to a widget, open the alert
 * subscribe modal. Bridges to the legacy biApp so navigation stays coherent
 * during the migration.
 *
 * Widget cards carry `data-widget-id`, so focusWidget can find any rendered
 * widget on the current page and highlight it — this is what lets the assistant
 * "take me to the TB cascade" actually land on it.
 */
import type { HostAPI, DetailRoute, ModalRequest } from './types';
import { getBiApp } from '../biApp';

/** Catalog page ids are namespaced ('internal-bi/service'); biApp nav ids are
 *  short ('service'). Accept either. */
function shortPageId(pageId: string): string {
  return pageId.replace(/^internal-bi\//, '');
}

/* ──────────────────────────────────────────────────────────────────────────
 * App-shell routing store — the single owner of the master-detail route and the
 * open-modal request. Small pub/sub (one state owner, like filterBus): the host
 * methods below mutate it; renderAppShell subscribes and swaps the page/detail
 * and fills the modal slot. Inert until a widget calls openDetail/openModal, so
 * a plain grid page (renderPage) is unaffected. Decoupled from biApp → copies
 * cleanly into workshop/ui with the rest of the runtime.
 * ──────────────────────────────────────────────────────────────────────────*/
type ShellState = { detail: DetailRoute | null; modal: ModalRequest | null };
const shell: ShellState = { detail: null, modal: null };
const shellSubs = new Set<(s: ShellState) => void>();

function emitShell(): void {
  for (const cb of shellSubs) { try { cb(shell); } catch { /* noop */ } }
}

/** Subscribe to detail/modal route changes. Returns an unsubscribe fn. Used by
 *  renderAppShell; widgets never need this (they call the host open/close fns). */
export function subscribeShell(cb: (s: ShellState) => void): () => void {
  shellSubs.add(cb);
  return () => { shellSubs.delete(cb); };
}

export const host: HostAPI = {
  navigateToPage(pageId) {
    const app = getBiApp();
    const short = shortPageId(pageId);
    if (app) { app.active = short; app.$nextTick?.(() => app.renderActive?.()); }
    // Tell React (useBiApp store) to re-gate the page frame.
    import('../biApp').then(m => m.notify?.());
  },
  focusWidget(widgetId) {
    const tryFocus = () => {
      const el = document.querySelector<HTMLElement>(`[data-widget-id="${widgetId}"]`);
      if (!el) return false;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('widget-focus');
      setTimeout(() => el.classList.remove('widget-focus'), 2200);
      return true;
    };
    // If the widget isn't on the current page yet (navigation just fired),
    // retry briefly while the new page renders.
    if (tryFocus()) return;
    let n = 0;
    const iv = setInterval(() => { if (tryFocus() || ++n > 12) clearInterval(iv); }, 150);
  },
  openSubscribe(programme, geography) {
    getBiApp()?.openSubscribe?.(programme, geography);
  },

  // ── Master-detail routing ────────────────────────────────────────────────
  openDetail(kind, id, props) {
    // A NEW object each time so renderAppShell detects the change by reference.
    shell.detail = { kind, id, ...(props ? { props } : {}) };
    emitShell();
  },
  closeDetail() {
    if (shell.detail === null) return;
    shell.detail = null;
    emitShell();
  },
  get currentDetail() { return shell.detail; },

  // ── Modal host ───────────────────────────────────────────────────────────
  openModal(id, props) {
    shell.modal = { id, ...(props ? { props } : {}) };
    emitShell();
  },
  closeModal() {
    if (shell.modal === null) return;
    shell.modal = null;
    emitShell();
  },
  get currentModal() { return shell.modal; },
};
