/**
 * Admin dashboard · modular widget runtime — shared types.
 *
 * Same React-idiom catalog-widget pattern as the public dashboard's
 * runtime/types.ts: the page is NOT a tree of hand-imported sections; it is a
 * composition of self-contained widget modules discovered from the filesystem
 * (runtime/registry.ts) and composed FROM THE CALLER'S RESOLVED CATALOG SPEC
 * (/gw/permissions/dashboard/admin/spec — see runtime/PageRenderer.tsx).
 * App.tsx imports no widget directly; the shell keeps only true furniture
 * (Sidebar, Topbar, Toast, AuthSplash).
 *
 * One module = ONE catalog widget (owner 2026-07-07 catalog-collapse): a
 * complex surface that works as one organism IS exactly one grantable widget
 * in the catalog — same dashboard→page→widget model as every other dashboard,
 * no admin special-casing. (The interim "module claims sibling ids" scheme was
 * retired with the collapse; ids are 1:1 with ops_perm.widget rows.)
 */
import type { FC } from 'react';

/**
 * The single surface a widget module is given. Deliberately thin: the migrated
 * sections keep their original hooks (useAdminApp, useAuth, api/*) verbatim —
 * the host exists for PageRenderer plumbing and future widgets, not to rewire
 * the existing internals.
 */
export interface AdminHost {
  /** Active page id — the adminApp store's `active` (e.g. 'infra', 'dq'). */
  active: string;
  /** Navigate to a page (same setter the Sidebar uses). */
  setActive: (id: string) => void;
}

/** A self-contained widget module (default export of widgets/<id>/index.tsx). */
export type AdminWidget = {
  /** Catalog widget id — MUST equal the folder name (e.g. 'adm-topology'). */
  id: string;
  /** The React component; receives the shared host and nothing else. */
  Component: FC<{ host: AdminHost }>;
};
