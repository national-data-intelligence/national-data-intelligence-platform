# App-shell runtime — master-detail + modals + entity data

The widget runtime renders a **grid of cards over governed mart data**
(`renderPage` → sections → `WidgetDef.render`). The workshop dashboard is the
opposite shape: **entity-CRUD + master-detail + modals over an ops REST store**.

These three additions give the runtime that shape **without changing the grid
path**. A plain grid page (`CatalogPage` → `renderPage`) is byte-for-byte
unchanged; the app-shell is opt-in via `renderAppShell`. Everything here lives in
`runtime/*` (+ two sibling folders), so it copies cleanly into `workshop/ui`.

## The three contracts (all in `runtime/types.ts`)

### 1. Entity data seam — `ctx.fetchEntity(path, params)`

Non-mart data. Mart widgets use `ctx.fetchData()` (the OPA `widget_data` path,
which returns empty stubs for anything that isn't a governed mart). Entity data
comes from ops REST routes that are **already authz-gated at their own gateway
route** (`/gw/projects`, `/gw/artifacts`, `/gw/ml`, …):

```ts
const rows = await ctx.fetchEntity('/gw/projects');   // real rows or null
if (!rows) { ctx.empty('No projects for your role.'); return; }
```

Same **real-or-empty invariant** as `fetchData`: real rows or `null` (empty /
denied / error → `null` → draw an empty state; never a fabricated row). Session
cache keyed by path+params (`dataHook.ts`); `invalidateEntityData()` after a
create/update/delete. Available on `WidgetCtx`, `DetailCtx`, and `ModalCtx`.

### 2. Master-detail — `host.openDetail(kind, id, props?)` / `host.closeDetail()`

A widget navigates to a detail view for a selected entity; the shell swaps the
page for the registered `DetailDef` whose `kind` matches, and `closeDetail`
returns to the page. `host.currentDetail` is the active route (or `null`).

```ts
// in a list widget:
ctx.host.openDetail('project', row.id, { row });   // pass the row for instant paint
```

A **DetailDef** lives in `src/details/<kind>/detail.ts`:

```ts
import type { DetailDef, DetailCtx } from '../../runtime/types';
const def: DetailDef = {
  kind: 'project',
  async render(ctx: DetailCtx) {
    const [p] = (await ctx.fetchEntity(`/gw/projects/${ctx.route.id}`)) || [];
    if (!p) { ctx.empty('Project not found.'); return; }
    // …draw ctx.el… ; a "Back" button calls ctx.host.closeDetail()
  },
};
export default def;
```

Discovered at build time by `detailRegistry.ts` (eager glob, like widgets).

### 3. Modal host — `host.openModal(id, props?)` / `host.closeModal()`

A widget or detail opens a registered `ModalDef` in the shell's **single modal
slot**; the shell draws the backdrop + frame + title + ✕, the ModalDef fills the
body. `host.currentModal` is the open request (or `null`).

```ts
ctx.host.openModal('project-create', { onDone: () => refresh() });
```

A **ModalDef** lives in `src/modals/<id>/modal.ts`:

```ts
import type { ModalDef, ModalCtx } from '../../runtime/types';
const def: ModalDef = {
  id: 'project-create',
  title: 'New project',
  render(ctx: ModalCtx) {
    // …draw a form into ctx.el…
    // on submit: POST via authFetch → invalidateEntityData() →
    //            ctx.props.onDone?.() → ctx.close()
  },
};
export default def;
```

Discovered at build time by `modalRegistry.ts`. The **caller owns the refresh**
(pass `onDone` in props) so the modal stays decoupled from whatever opened it.
Title can be overridden per-open with `props.title`.

## Authoring a master-detail-with-modal page

1. **List widget** (`src/widgets/<id>/widget.ts`) — `ctx.fetchEntity(...)` for the
   rows; each row's action calls `ctx.host.openDetail(kind, id, { row })`; a
   toolbar button calls `ctx.host.openModal('<create>', { onDone })`.
2. **Detail view** (`src/details/<kind>/detail.ts`) — reads the entity via
   `ctx.fetchEntity`, `ctx.host.closeDetail()` to go back, may open modals.
3. **Modal(s)** (`src/modals/<id>/modal.ts`) — the create/submit/compute flow;
   POST via `authFetch`, then `invalidateEntityData()` + `props.onDone?.()` +
   `ctx.close()`.
4. **Mount with `renderAppShell(page, mount)`** instead of `renderPage` — it
   composes the grid, the detail swap, and the modal slot, all driven off the
   host shell store (`subscribeShell`).

`renderAppShell` when no route/modal is active renders the normal page exactly
like `renderPage` — so a page can adopt the app-shell and keep its grid widgets.

## Working reference (dev harness)

A runnable example ships behind the dev flag `#appshell-demo` (inert on every
live page):

- `src/widgets/demo-appshell-list/widget.ts` — entity list over real `/gw/marts`
- `src/details/demo-mart/detail.ts` — the detail view (kind `demo-mart`)
- `src/modals/demo-info/modal.ts` — the modal (id `demo-info`)
- `src/sections/DemoAppShell.tsx` — builds a synthetic page + `renderAppShell`

Open `https://internal.127.0.0.1.nip.io/#appshell-demo` (signed in) to exercise
list → Open ▸ → detail → Back, and the About / modal → Confirm → refresh loop.
