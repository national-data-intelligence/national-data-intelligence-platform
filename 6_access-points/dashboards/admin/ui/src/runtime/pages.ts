/**
 * Admin dashboard · FALLBACK page composition.
 *
 * The PRIMARY composition source is the caller's resolved catalog spec
 * (/gw/permissions/dashboard/admin/spec) — PageRenderer renders the active
 * page's granted widget ids from it. This static map exists ONLY for the
 * degraded modes where the spec is not usable (still loading on first paint,
 * network/5xx failure, or the gateway denying the spec outright): in those
 * modes the pre-migration admin rendered every page unconditionally (the spec
 * gated nothing but two nav items), so falling back to the FULL catalog
 * composition preserves that behavior exactly — no blank first frame, no
 * blank pages when the gateway is unreachable (each widget then degrades to
 * its own data-fetch error state, same as before the migration).
 *
 * Keys are adminApp `active` ids; values mirror bundle/seed-pack/app/security/
 * page_widget.yaml for dashboard `admin` (page id = `admin/<key>`) — the
 * COLLAPSED one-widget-per-page catalog (owner 2026-07-07). If the catalog
 * gains a widget, add it here too (one line) so degraded mode stays faithful.
 */
export const FALLBACK_PAGE_WIDGETS: Record<string, string[]> = {
  infra:               ['adm-topology'],
  alerts:              ['adm-alerts-routing'],
  dq:                  ['adm-dq'],
  mdm:                 ['adm-mdm-review'],
  'models-datasets':   ['adm-models-datasets'],
  'users-access':      ['adm-users-access'],
  'roles-permissions': ['adm-roles-permissions'],
  sso:                 ['adm-sso-cards'],
  documentation:       ['adm-documentation'],
};
