# Palladium Demo Console — functional specification

Everything a designer needs about *what this does*. Nothing about how it should
look: no colours, type, spacing, layout or visual treatment. Those are the
designer's calls.

---

## 1. What the product is

An internal web app for Palladium. One place to find every project the company
demos to clients, check whether it is running right now, change what data it is
showing, fire scripted demo actions, and see who did what.

It controls projects but is not part of any of them. Each project it drives is a
separate system on a separate host; the console reaches them over HTTP only.

**It is an app, not a website.** People keep it open during a working day, it
shows live state that changes while they watch, and long operations run inside
it. Nothing about it is a marketing page or a document.

## 2. Who uses it and what they can do

Four roles, granted **per project** — someone can present one client's work
without being able to see another's.

| Role | Can |
|---|---|
| **Viewer** | See the project and open its resources |
| **Presenter** | + open the live demo, run demo actions, place a hold |
| **Maintainer** | + add/remove resources, switch the project's profile |
| **Admin** | + grant other people access to that project |

Separately there is a **console admin** flag: can create projects and see all of
them and everyone. The first person ever to sign in becomes one, otherwise
nobody could grant anything.

A person with no grant on a project does not see the project at all. Controls
above a person's role are visible but inert, with the reason stated — hiding
them makes people think the app is broken.

## 3. The real content it shows today

Three projects exist right now:

- **National Health Data Warehouse** — Ministry of Health · Ethiopia — 3
  resources — live demo + controllable
- **Public Open Data Portal** — Ministry of Health · public — 0 resources —
  live demo, not controllable
- **Supply Control Tower** — EPSS · logistics — 0 resources — live demo, not
  controllable

Each project has a 2-letter code (NH, PO, SC) and a colour, used as a compact
visual identifier so a project is recognisable without a logo upload.

## 4. Concepts the interface has to express

### 4.1 A project's live status

Polled continuously; changes while someone is looking. Four states:

- **Live** — everything healthy
- **Degraded** — reachable but a component is failing
- **Not reachable** — the project is down or unreachable
- **Folder only** — the project has material but no controllable environment.
  This is a legitimate, permanent state for many projects and must not read as
  an error.

Status is never a bare word: it comes with the components that were checked. For
NHDW today those are *operations database*, *marts* ("the numbers every
dashboard reads"), and *country profiles* ("2 installed") — each with ok/not-ok
and a short detail string.

### 4.2 Profiles — what the project is showing

A project can be pointed at different content sets. NHDW currently has two:

- `et-v3` — Ethiopia (active)
- `zm-v1` — Zambia

A profile has **three layers with very different costs**, and the interface must
not let someone confuse them:

| Layer | What changes | Cost |
|---|---|---|
| Presentation | wording, maps, branding, which widgets apply | **seconds** |
| People & policy | demo users, roles, permissions | **about a minute** |
| Source data | the underlying records | **a full pipeline run** |

Switching presentation is safe mid-day. Switching source data is scheduled work,
not something to start before a meeting. A switch returns a **job** (below).

### 4.3 Demo actions

Named, scripted things a presenter can fire at a live project. Each declares:

- a **label** and a **description** of what it does
- a **blast radius** — what it writes, in plain words
- whether it is **reversible**
- a **deep link** — the page in the live demo where the effect is visible

NHDW exposes two today:

- *Reset to the default profile* — "Switches presentation back to the profile
  this deployment ships with." Blast: *presentation only — no data is written.*
  Reversible.
- *Re-run quality detection* — "Runs the data-quality detector so the incident
  queue reflects the warehouse as it stands right now." Blast: *writes incident
  rows; deduped by fingerprint, so a re-run updates rather than accumulates.*
  Reversible.

Running one should offer to take the person to the deep link, because the whole
point is showing the effect.

### 4.4 Jobs — long-running operations

A profile switch or an action returns a job with **named stages**, each
`waiting → running → done` (or `failed`/`skipped`), each with elapsed time and
an optional note. A job can take seconds or many minutes.

Two requirements:

- **A running job stays visible while the user navigates elsewhere.** They
  started it and remain responsible for it.
- **Skipped stages are as important as done ones.** A profile switch reports the
  heavy layers as *not applied here, an operator path must run them* — the app
  must never imply a green result it did not achieve.

### 4.5 Holds — avoiding collisions

One environment per project, so two colleagues can collide: a rebuild that
starts mid-demo breaks the demo. A person can **hold** a project for a period,
with an optional reason. While held, others attempting a change are refused and
told who holds it and until when. Advisory, not a lock — it turns a collision
into a conversation.

### 4.6 Resources

Per-project material: slide decks, documents, videos, images, links to code. Each
has a title, a kind, an optional note, and either a URL or a stored file. They
are ordered. Maintainers add and remove them.

### 4.7 Activity

An append-only log, never edited or deleted. Every sign-in, project creation,
profile switch, action run, resource change and access grant. Each entry records
who, what, which project, when, and whether it succeeded, failed or was denied.
Viewable org-wide (admins) or per project.

## 5. Screens

### 5.1 Sign in

Two possible ways in, depending on configuration: single sign-on with a
Palladium account, or a development sign-in that only exists on non-production
instances. The app asks which is available and shows only that. Signed-out is a
normal state, not an error.

### 5.2 Projects — the home screen

The one collection view. Shows every project the person can see.

**Two view modes with a toggle, and the choice persists:**

- **Grid** — one tile per project, optimised for recognition and for pressing.
- **List** — one row per project, optimised for scanning and comparison, with
  more columns than a tile can carry.

Both views must carry, per project: identity (name, client, 2-letter code and
colour), **live status**, **active profile**, the person's role, resource count,
and whether it is held.

**Controls over the collection:**

- **Search** — free text across name and client. Filters as you type.
- **Sort** — by name, status, most recently active, client. Ascending and
  descending.
- **Filter** — by status (live / degraded / not reachable / folder only), by the
  person's role, and by whether it is currently held. Multiple filters combine.
  It must be obvious when a filter is active and how to clear it.
- **New project** — console admins only.

States: loading, empty (no projects yet — explain what a project is and offer to
create one), and no-results-after-filtering (distinct from empty, and offers to
clear the filters).

### 5.3 Project detail

Opened from either view. Carries, always visible: identity, live status, active
profile, hold state, an **Open demo** action that leaves for the live system, and
a **Hold / Release** control.

Six areas. They may be tabs, panes, or something better — that is a design
decision:

1. **Overview** — the default. Answers what a nervous presenter needs ten
   minutes before a meeting: is it up, what is it showing, what do I open, what
   can I press. The **demo actions** are the most important thing here; they are
   what people come to press.
2. **Resources** — the material, with add/remove for maintainers.
3. **Profiles** — what is installed, which is active, switch controls, and the
   three-layer cost explanation. Switching is maintainer-only.
4. **Access** — who can reach this project and at what role; what each role
   means. Granting is admin-only.
5. **Activity** — everything that happened to this project.
6. **Settings** — name, client, code, colour, demo URL, and the connection
   details for controlling it. Admin-only, and the shared secret is never
   displayed back.

### 5.4 Activity (org-wide)

The full log, newest first, filterable by person, project and outcome.

### 5.5 People & access

Console admins only. Everyone who has signed in, their console role, how many
projects they can reach, when they were last seen. From here an admin grants
someone a role on a project.

## 6. Cross-cutting behaviour

- **A command palette**, opened by keyboard, to jump to any project or screen
  without the mouse. This is a keyboard-first app for people who use it daily.
- **Feedback for every action** — success and failure both say what happened in
  plain words. Errors explain what went wrong and what to do.
- **Destructive or shared-impact actions confirm first**, and the confirmation
  states who else is affected. Switching a profile changes what everyone
  currently looking at that project sees.
- **Live data updates without a reload.**
- **The browser console stays clean.** Expected states such as "not signed in
  yet" must not surface as errors.
- **Keyboard reachable throughout**, with a visible focus state.
- **Works down to a narrow window.** People check status on a phone between
  meetings. No sideways scrolling at any width.
- **Light and dark**, following the system preference with a manual override.

## 7. Technical constraints the design must respect

- **No build step.** Hand-written HTML, CSS and JavaScript served by a small
  Python service. No framework, no bundler, no npm. The design must be
  achievable in plain CSS and vanilla JS.
- **Web fonts may be linked from Google Fonts.** Everything else — icons,
  images, illustration — must be inline SVG, CSS or canvas. No icon-font or
  asset CDNs.
- **Self-contained.** It runs on an isolated host and cannot depend on external
  services at runtime.
- Modern browsers only; no legacy support required.

## 8. What the app must never do

- Show a green result for an operation that did not fully succeed.
- Present a fabricated number. If a figure is unavailable, say so.
- Hide a control someone lacks permission for without saying why.
- Let a profile switch happen silently while someone else is demoing.
- Display a stored secret back to a user.
