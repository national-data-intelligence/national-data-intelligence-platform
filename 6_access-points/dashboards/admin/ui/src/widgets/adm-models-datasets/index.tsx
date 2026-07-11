/**
 * Models and datasets (page id admin/models-datasets) — the admin's model &
 * dataset console. Owner 2026-07-07 MERGED the former "Models" (model-fleet
 * health) and "Review Queue" (graduation review) pages into this one surface:
 *
 *   · Model fleet (rendered by MLHealth) — drift +
 *     performance monitoring of the deployed models.
 *   · Graduation review queue (rendered by Review) —
 *     submissions (models AND datasets) awaiting peer-review sign-off before
 *     they publish to BI.
 *
 * Both sections are reused AS-IS (no internal changes); this composes them under
 * one page + one nav entry. The old admin/ml-health + admin/review pages are
 * retired from the catalog.
 */
import MLHealth from './MLHealth';
import Review from './Review';

function ModelsDatasets() {
  return (
    <>
      <MLHealth />
      <div className="md-divider" />
      <Review />
    </>
  );
}

/* ── widget-module registration (admin catalog runtime) ─────────────────
   Catalog-collapse (owner 2026-07-07): one organism = ONE grantable widget; this page's single catalog widget id is this module. */
import type { AdminWidget } from '../../runtime/types';
const widget: AdminWidget = {
  id: 'adm-models-datasets',
  Component: ModelsDatasets,
};
export default widget;
