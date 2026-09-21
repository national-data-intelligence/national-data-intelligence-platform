/* ─────────────────────────────────────────────────────────────────────────
   Palladium Demo Console — client

   No framework and no build step: the app deploys as a Python image and stays
   editable in place during a demo week, which matters more here than a virtual
   DOM would. Hash routing, one render per view, delegated events.

   What makes it an instrument rather than a page: live status is polled and
   shown as form (a pulsing dot, a meter) as well as text, a running job
   survives navigation because it lives in app state and renders into the
   sidebar, and the collection has two views the operator chooses between.
   ───────────────────────────────────────────────────────────────────────── */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  user: null,
  projects: [],
  project: null,      // full detail of the open project
  tab: 'overview',
  statuses: {},       // projectId -> health payload
  job: null,          // the one running job we surface in the sidebar
  jobTimer: null,
  // collection controls
  view: localStorage.getItem('console-view') === 'list' ? 'list' : 'grid',
  q: '',
  fCat: '',           // which dimension is being filtered on
  fVal: '',           // and to what value
  sort: localStorage.getItem('console-sort') || 'name',
};

/* ── icons ──────────────────────────────────────────────────────────────── */
// Inline so the app carries no icon font and no asset host. One stroke weight
// throughout, which is what makes a hand-drawn set read as a set.
const ICON = {
  grid:   '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" fill="none"/>',
  list:   '<path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  plus:   '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/>',
  search: '<circle cx="11" cy="11" r="6.4" stroke="currentColor" stroke-width="2" fill="none"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  bolt:   '<path d="M13 3 5.5 13H11l-1 8 7.5-10H12z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>',
  out:    '<path d="M8 16 16 8m0 0H9.5M16 8v6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  deck:   '<path d="M4 5h16v10H4zM9 19h6M12 15v4" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>',
  doc:    '<path d="M6 3h8l4 4v14H6zM14 3v4h4" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>',
  video:  '<rect x="3" y="6" width="13" height="12" rx="2.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="m16 12 5-3v9z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>',
  image:  '<rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="m5 17 5-5 4 4 2-2 3 3" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>',
  link:   '<path d="M10 14a4 4 0 0 0 6 .5l2-2a4 4 0 0 0-5.7-5.7l-1 1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/><path d="M14 10a4 4 0 0 0-6-.5l-2 2a4 4 0 0 0 5.7 5.7l1-1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
  dot:    '<circle cx="12" cy="12" r="4" fill="currentColor"/>',
  check:  '<path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  warn:   '<path d="M12 8v5M12 16.5v.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="12" r="8.4" stroke="currentColor" stroke-width="1.8" fill="none"/>',
  lock:   '<rect x="5" y="10" width="14" height="10" rx="2.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" stroke="currentColor" stroke-width="1.8" fill="none"/>',
  trash:  '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  code:   '<path d="m9 8-5 4 5 4M15 8l5 4-5 4M13 5l-2 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  eye:    '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" stroke="currentColor" stroke-width="1.8" fill="none"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8" fill="none"/>',
  down:   '<path d="M12 4v12m0 0 4.5-4.5M12 16l-4.5-4.5M5 20h14" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  upload: '<path d="M12 20V8m0 0 4.5 4.5M12 8 7.5 12.5M5 4h14" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  folder: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h2.7l1.6 2H17.5A2.5 2.5 0 0 1 20 10.5v6A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>',
  close:  '<path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  back:   '<path d="M15 5.5 8.5 12l6.5 6.5" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  note:   '<path d="M6 3h9l3 3v15H6zM15 3v3h3M9 11h6M9 15h4" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" fill="none"/>',
  pencil: '<path d="M4 20h4l10-10-4-4L4 16zM14 6l4 4" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" fill="none"/>',
};
const svg = (name, cls = '') =>
  `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true">${ICON[name] || ''}</svg>`;

/* ── tiny helpers ───────────────────────────────────────────────────────── */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const initials = (s) => String(s || '?').trim().split(/\s+/).slice(0, 2)
  .map(w => w[0]).join('').toUpperCase() || '?';

function ago(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const secs = Math.max(0, (Date.now() - then) / 1000);
  if (secs < 60) return 'just now';
  const mins = secs / 60;
  if (mins < 60) return `${Math.round(mins)}m ago`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.round(hrs)}h ago`;
  const days = hrs / 24;
  if (days < 30) return `${Math.round(days)}d ago`;
  return new Date(iso).toLocaleDateString();
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  // A 401 from /api means the session went away and the app should fall back to
  // the sign-in screen. A 401 from /auth/password-login means the PASSWORD was
  // wrong — bouncing to a freshly rendered form there throws away what the
  // person typed and replaces the server's message with a useless one.
  if (res.status === 401 && path.startsWith('/api/')) {
    showSignIn();
    throw new Error('not signed in');
  }
  let payload = null;
  try { payload = await res.json(); } catch { /* empty body is fine */ }
  if (!res.ok) throw new Error(payload?.detail || `request failed (${res.status})`);
  return payload;
}

function toast(title, detail = '', kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<span class="tt">${esc(title)}</span>${detail ? `<span class="td">${esc(detail)}</span>` : ''}`;
  $('#toasts').append(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 250); }, 4600);
}

/* ── status vocabulary ──────────────────────────────────────────────────── */
// One place decides what a health payload LOOKS like, so a project is described
// identically in a card, a table row and a hero.
const STATUS = {
  live:       ['live', 'Live'],
  degraded:   ['busy', 'Degraded'],
  down:       ['bad',  'Not reachable'],
  'no-agent': ['',     'Folder only'],
};
function statusPill(st) {
  if (!st) return `<span class="pill"><span class="d"></span>Checking…</span>`;
  const [cls, label] = STATUS[st.state] || ['', st.state || 'Unknown'];
  return `<span class="pill ${cls}"><span class="d"></span>${esc(label)}</span>`;
}

/* ── routing ────────────────────────────────────────────────────────────── */

function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'projects';
  const [head, ...rest] = hash.split('/');
  // A reset link is a URL somebody follows while signed out; it has to work
  // before the app shell exists.
  if (head === 'reset' && rest[0]) { showSignIn('reset', rest[0]); return; }
  $$('.nav-i').forEach(a => a.classList.toggle('on', a.dataset.route === head));
  $('#canvas').scrollTop = 0;
  if (head === 'project' && rest[0]) return viewProject(rest[0], rest[1] || 'overview');
  if (head === 'admin') return viewAdmin(rest[0] || 'people');
  if (head === 'settings') return viewSettings();
  return viewProjects();
}

function paint(html) { $('#canvas').innerHTML = html; }

/* The content area scrolls inside a card with a hard bottom edge, so a page
 * that continues below the fold ends mid-word against that edge and reads as
 * chopped rather than as scrollable. A soft fade over the last inch says
 * "there is more" without a scrollbar having to.
 *
 * It appears ONLY when something is actually below the fold. A permanent wash
 * over the last line of a document that has ended is the same lie in reverse —
 * it would suggest more text to someone who has reached the end. */
function edgeFade() {
  const c = $('#canvas');
  if (!c) return;
  const more = c.scrollHeight - c.clientHeight - c.scrollTop > 2;
  c.classList.toggle('has-more', more);
}

/* Watched rather than called from each renderer.
 *
 * `paint()` runs BEFORE a tab fills its body — every tab paints a shell and
 * then loads into it — so measuring there measures the wrong page. Calling
 * edgeFade() at the end of each renderer would work until somebody adds the
 * eleventh renderer and forgets, and then one page has a hard edge for no
 * reason anybody can see. Watching the subtree cannot be forgotten. */
function watchEdge() {
  const c = $('#canvas');
  if (!c) return;
  new MutationObserver(() => requestAnimationFrame(edgeFade))
    .observe(c, { childList: true, subtree: true, characterData: true });
  edgeFade();
}

/** A skeleton with a caption. A bare shimmer tells the operator nothing, and a
 *  slow round trip to a project on another host is exactly when they want to
 *  know what is being waited on. */
function loading(what, h = 150) {
  return `<div class="loading"><div class="skel" style="height:${h}px"></div>
    <span class="lbl">${esc(what)}</span></div>`;
}
function skeletonGrid(n = 3) {
  return `<div class="grid">${Array.from({ length: n }, () =>
    `<div class="skel" style="height:168px;margin-top:22px"></div>`).join('')}</div>`;
}

/* ── projects: the collection ───────────────────────────────────────────── */

/** The filter is two selects: pick a dimension, then a value within it. One
 *  dimension at a time, which keeps the strip on one line and the result
 *  explainable — "Status is Live" rather than four chips in unknown states. */
const FILTERS = {
  status: { label: 'Status', values: [['live', 'Live'], ['degraded', 'Degraded'],
                                      ['down', 'Not reachable'], ['no-agent', 'Folder only']] },
  role:   { label: 'Your role', values: [['viewer', 'Viewer'], ['presenter', 'Presenter'],
                                         ['maintainer', 'Maintainer'], ['admin', 'Admin']] },
  hold:   { label: 'Hold', values: [['held', 'Held right now'], ['free', 'Not held']] },
};

async function viewProjects() {
  paint(`${headHtml()}${stripHtml()}<div id="collection">${skeletonGrid(3)}</div>`);
  let projects;
  try { ({ projects } = await api('/api/projects')); }
  catch { return; }                       // 401 already showed the sign-in
  state.projects = projects;
  renderCollection();
  projects.forEach(p => refreshStatus(p.id));
}

function headHtml() {
  return `<div class="head">
    <h1 class="ptitle">Projects</h1>
    <span class="spacer"></span>
    <div class="viewtoggle" role="group" aria-label="View">
      <button class="vt ${state.view === 'grid' ? 'on' : ''}" data-view="grid" type="button"
        title="Grid view" aria-label="Grid view" aria-pressed="${state.view === 'grid'}">${svg('grid')}</button>
      <button class="vt ${state.view === 'list' ? 'on' : ''}" data-view="list" type="button"
        title="List view" aria-label="List view" aria-pressed="${state.view === 'list'}">${svg('list')}</button>
    </div>
  </div>`;
}

function stripHtml() {
  const cat = FILTERS[state.fCat];
  return `<div class="strip">
    <label class="field">
      ${svg('search')}
      <input id="q" type="search" placeholder="Search by name or client"
             value="${esc(state.q)}" autocomplete="off">
    </label>
    <div class="selpill ${state.fCat ? 'set' : ''}">
      <select id="f-cat" aria-label="Filter by">
        <option value="">Filter by…</option>
        ${Object.entries(FILTERS).map(([k, f]) =>
          `<option value="${k}" ${state.fCat === k ? 'selected' : ''}>${f.label}</option>`).join('')}
      </select>
    </div>
    <div class="selpill ${state.fVal ? 'set' : ''}">
      <select id="f-val" aria-label="Filter value" ${cat ? '' : 'disabled'}>
        <option value="">${cat ? 'Any ' + cat.label.toLowerCase() : 'Pick a filter first'}</option>
        ${(cat?.values || []).map(([v, l]) =>
          `<option value="${v}" ${state.fVal === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="selpill">
      <select id="sort" aria-label="Sort">
        ${[['name', 'Name A–Z'], ['name-desc', 'Name Z–A'], ['status', 'Status'],
           ['recent', 'Recently active'], ['client', 'Client']].map(([v, l]) =>
          `<option value="${v}" ${state.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    ${filtersActive() ? `<button class="linkbtn" data-act="clear-filters" type="button">Clear</button>` : ''}
  </div>`;
}

const filtersActive = () => !!(state.q || (state.fCat && state.fVal));

function visibleProjects() {
  const q = state.q.trim().toLowerCase();
  const list = state.projects.filter(p => {
    if (q && !`${p.name} ${p.client || ''} ${p.slug}`.toLowerCase().includes(q)) return false;
    if (state.fCat && state.fVal) {
      if (state.fCat === 'role' && (p.my_role || 'viewer') !== state.fVal) return false;
      if (state.fCat === 'hold' && (state.fVal === 'held') !== !!p.hold) return false;
      if (state.fCat === 'status') {
        // A project whose probe has not landed yet is not claimed to match a
        // status filter — it is simply not shown under that filter.
        const st = state.statuses[p.id];
        if (!st || st.state !== state.fVal) return false;
      }
    }
    return true;
  });
  const byName = (a, b) => a.name.localeCompare(b.name);
  const rank = p => ({ down: 0, degraded: 1, live: 2, 'no-agent': 3 })[state.statuses[p.id]?.state] ?? 4;
  ({
    name:        () => list.sort(byName),
    'name-desc': () => list.sort((a, b) => byName(b, a)),
    status:      () => list.sort((a, b) => rank(a) - rank(b) || byName(a, b)),
    client:      () => list.sort((a, b) => (a.client || '~').localeCompare(b.client || '~') || byName(a, b)),
    recent:      () => list.sort((a, b) =>
                    new Date(b.last_activity || 0) - new Date(a.last_activity || 0) || byName(a, b)),
  }[state.sort] || (() => list.sort(byName)))();
  return list;
}

function renderCollection() {
  const box = $('#collection');
  if (!box) return;
  if (!state.projects.length) {
    // An admin sees every project, so an empty list means there genuinely are
    // none. A member sees only what they have been granted, so an empty list
    // means nobody has granted them anything yet — a different sentence, and
    // the difference is the whole point of saying it.
    const admin = state.user?.org_role === 'admin';
    box.innerHTML = `<div class="empty">
      <div class="eh">${admin ? 'No projects yet' : 'Nothing has been shared with you yet'}</div>
      <div class="ed">${admin
        ? `A project is a folder of demo material and, where one exists, a live environment
           this console can drive — check it is up, set what it is showing, and run the
           scripted moments.`
        : `Projects are granted one at a time. Until somebody grants you one, this console
           has nothing to show you — which is not the same as there being nothing here.`}</div>
      <div class="dim">${admin
        ? 'Use <b>New project</b> in the sidebar to add the first one.'
        : 'Ask a console admin for access to the project you need.'}</div>
    </div>`;
    return;
  }
  const list = visibleProjects();
  if (!list.length) {
    box.innerHTML = `<div class="empty">
      <div class="eh">Nothing matches</div>
      <div class="ed">${state.projects.length} project${state.projects.length === 1 ? '' : 's'}
        ${state.projects.length === 1 ? 'is' : 'are'} available — none of them match what you
        have narrowed to.</div>
      <button class="linkbtn" data-act="clear-filters" type="button">Clear the filters</button>
    </div>`;
    return;
  }
  // Creating a project belongs among the projects, shaped like one: an empty
  // folder at the end of the shelf. It only appears when the collection is
  // showing everything — an "add" tile sitting inside a filtered result would
  // claim to be part of that result.
  const canCreate = state.user?.org_role === 'admin' && !filtersActive();
  const count = `<div class="rowlabel"><span class="lbl">${list.length} of
    ${state.projects.length} project${state.projects.length === 1 ? '' : 's'}</span><i></i></div>`;
  box.innerHTML = count + (state.view === 'grid'
    ? `<div class="grid">${list.map(cardHtml).join('')}${canCreate ? addCardHtml() : ''}</div>`
    : `<div class="tablewrap"><table>
        <thead><tr>
          <th>Project</th><th>Client</th><th>Status</th><th>Showing</th>
          <th>Your role</th><th class="num">Resources</th><th>Last active</th>
        </tr></thead>
        <tbody>${list.map(rowHtml).join('')}${canCreate ? addRowHtml() : ''}</tbody>
      </table></div>`);
}

/** A card identifies a project and says whether it is up. Everything else —
 *  roles, counts, timestamps — is a column in the list view or a line on the
 *  project itself. A wall of labels on a card is a wall you cannot scan. */
function cardHtml(p) {
  const showing = state.statuses[p.id]?.active_profile;
  const meta = p.hold
    ? `Held by ${p.hold.by}`
    : [showing, `${p.resource_count} resource${p.resource_count === 1 ? '' : 's'}`]
        .filter(Boolean).join(' · ');
  return `<a class="pcard${p.hold ? ' held' : ''}" href="#/project/${p.id}">
    <span class="tab" style="--tabc:${esc(p.colour)}">${esc(p.chip)}</span>
    <div>
      <h3 class="pname">${esc(p.name)}</h3>
      <p class="pclient">${esc(p.client || 'Internal')}</p>
    </div>
    <div class="pfoot">
      <span data-status="${p.id}">${statusPill(state.statuses[p.id])}</span>
      <span class="pmeta" data-meta="${p.id}">${esc(meta)}</span>
    </div>
  </a>`;
}

/** An empty folder at the end of the shelf. Same silhouette as a project —
 *  tab, body, rounded corners — drawn as an outline so it reads as a place for
 *  one rather than as one. */
function addCardHtml() {
  return `<button class="pcard add" data-act="new-project" type="button">
    <span class="tab">NEW</span>
    <span class="add-mark">${svg('plus')}</span>
    <span class="add-t">New project</span>
    <span class="add-d">A folder of demo material, and the environment behind it</span>
  </button>`;
}

function addRowHtml() {
  return `<tr class="addrow" data-act="new-project">
    <td colspan="7"><span class="addrow-in">${svg('plus')} New project</span></td>
  </tr>`;
}

function rowHtml(p) {
  return `<tr data-href="#/project/${p.id}">
    <td><div class="cellname">
      <span class="dot2" style="--tabc:${esc(p.colour)}">${esc(p.chip)}</span>
      <strong>${esc(p.name)}</strong>
      ${p.hold ? `<span class="pill busy"><span class="d"></span>Held</span>` : ''}
    </div></td>
    <td>${esc(p.client || 'Internal')}</td>
    <td data-status="${p.id}">${statusPill(state.statuses[p.id])}</td>
    <td><span class="mono" data-profile="${p.id}">${
      esc(state.statuses[p.id]?.active_profile || '—')}</span></td>
    <td><span class="tag">${esc(p.my_role || 'viewer')}</span></td>
    <td class="num">${p.resource_count}</td>
    <td>${p.last_activity ? ago(p.last_activity) : '—'}</td>
  </tr>`;
}

/** Health is per project and slow-ish, so it lands after the list rather than
 *  holding it back. Each cell updates in place wherever it appears. */
async function refreshStatus(id) {
  try {
    const st = await api(`/api/projects/${id}/status`);
    state.statuses[id] = st;
    $$(`[data-status="${id}"]`).forEach(el => { el.innerHTML = statusPill(st); });
    if (st.active_profile) {
      $$(`[data-profile="${id}"]`).forEach(el => { el.textContent = st.active_profile; });
      $$(`[data-meta="${id}"]`).forEach(el => {
        const p = state.projects.find(x => x.id === id);
        if (!p || p.hold) return;
        el.textContent = [st.active_profile,
          `${p.resource_count} resource${p.resource_count === 1 ? '' : 's'}`].join(' · ');
      });
    }
    renderFleet();
    // A status-dependent filter or sort can only be correct once the probe has
    // landed, so re-lay the collection when one is in play.
    if ($('#collection') && (state.fCat === 'status' || state.sort === 'status')) renderCollection();
  } catch { /* leave the checking state — a failed probe is not a page error */ }
}

/* ── the sidebar meters ─────────────────────────────────────────────────── */

/** The estate, in the topbar, on every screen. Counts only what has actually
 *  answered a probe — a project still being checked is reported as such rather
 *  than folded into a number that looks settled. */
function renderFleet() {
  const box = $('#estatebar');
  if (!box) return;
  const total = state.projects.length;
  const bits = [];

  if (!total) {
    bits.push(`<span class="est quiet">No projects yet</span>`);
  } else {
    const seen = state.projects.filter(p => state.statuses[p.id]);
    const count = (st) => seen.filter(p => state.statuses[p.id].state === st).length;
    const shown = [
      ['live', 'live', count('live')],
      ['bad', 'not reachable', count('down')],
      ['busy', 'degraded', count('degraded')],
      ['', 'folder only', count('no-agent')],
    ];
    // "0 live" is worth showing — it is the sentence an operator needs. A zero
    // in every other state is not, so those chips simply do not appear.
    for (const [cls, label, n] of shown) {
      if (n === 0 && cls !== 'live') continue;
      bits.push(`<span class="est ${cls}"><span class="d"></span><b>${n}</b> ${label}</span>`);
    }
    const waiting = total - seen.length;
    if (waiting) bits.push(`<span class="est quiet">${waiting} still checking…</span>`);
  }

  // A running job takes the space while it lasts: it is the one thing on this
  // bar that will not still be true in a minute.
  const j = state.job;
  if (j) {
    const settled = j.stages.filter(s => s.state !== 'waiting' && s.state !== 'running').length;
    const pct = Math.round((settled / Math.max(j.stages.length, 1)) * 100);
    bits.push(`<span class="est run"><span class="rbar"><i style="width:${pct}%"></i></span>
      <b>${esc(j.detail || j.kind)}</b>${j.state === 'running'
        ? ` · ${j.elapsed_s}s` : ` · ${esc(j.state)}`}</span>`);
  }
  box.innerHTML = bits.join('');
}

function renderJob() {
  const box = $('#running');
  if (!box) return;
  const j = state.job;
  if (!j) {
    box.innerHTML = `<span class="meter-quiet">Nothing running.</span>`;
    renderFleet();
    return;
  }
  const settled = j.stages.filter(s => s.state !== 'waiting' && s.state !== 'running').length;
  const pct = Math.round((settled / Math.max(j.stages.length, 1)) * 100);
  const skipped = j.stages.filter(s => s.state === 'skipped').length;
  const failed = j.stages.filter(s => s.state === 'failed').length;
  // Never imply a clean result we did not achieve: skipped and failed stages are
  // reported in the meter caption, not folded into "done".
  const caption = j.state === 'running'
    ? `stage ${Math.min(settled + 1, j.stages.length)} of ${j.stages.length} · ${j.elapsed_s}s`
    : [failed ? `${failed} failed` : '', skipped ? `${skipped} not applied here` : '',
       (!failed && !skipped) ? 'all stages done' : ''].filter(Boolean).join(' · ');
  box.innerHTML = `
    <div class="meter-t"><span>${esc(j.detail || j.kind)}</span></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <span class="meter-c">${esc(caption)}</span>`;
  renderFleet();                 // the topbar carries the job too while it runs
}

function trackJob(projectId, job) {
  state.job = job;
  renderJob();
  clearInterval(state.jobTimer);
  if (job.state !== 'running') {
    // leave the finished state visible briefly so a fast job is still seen
    setTimeout(() => { if (state.job?.id === job.id) { state.job = null; renderJob(); } }, 9000);
    return;
  }
  state.jobTimer = setInterval(async () => {
    try {
      const j = await api(`/api/projects/${projectId}/job/${job.id}`);
      state.job = j; renderJob();
      if (j.state !== 'running') { clearInterval(state.jobTimer); trackJob(projectId, j); }
    } catch { clearInterval(state.jobTimer); }
  }, 2000);
}

/* ── project detail ─────────────────────────────────────────────────────── */

/* THE TAB FRAMEWORK. Three tabs, one organising principle: LOOK, SHOW, CHANGE.
 * Each answers exactly one question and nothing appears in two places.
 *
 * Who may reach a project and what has happened to it are the CONSOLE's
 * business, not a project's — they are about people and about the estate — and
 * they already have a home in Admin. Keeping them here as well was two more
 * tabs saying what one screen already says.
 */
const TABS = [
  ['overview',  'Overview',  'What is this, and is it up?'],
  ['resources', 'Resources', 'What material do I show?'],
  ['controls',  'Controls',  'What can I change, and what can I press?'],
  ['notes',     'Notes',     'What should the next person know?'],
];

/* The documentation sections, fetched once from the server — the SAME list the
 * create form builds its fields from and the Overview builds its sections from.
 * Neither keeps its own copy: a section that existed in one and not the other
 * is exactly how a page ends up with a heading nothing can ever fill. */
let DOC_SECTIONS = [];
async function docSections() {
  if (!DOC_SECTIONS.length) {
    try { ({ sections: DOC_SECTIONS } = await api('/api/doc-sections')); }
    catch { DOC_SECTIONS = []; }
  }
  return DOC_SECTIONS;
}

/** Is the view this async answer belongs to still the one on screen? */
const stillOn = (tab, projectId) => state.tab === tab && state.project?.id === projectId;

async function viewProject(id, tab) {
  state.tab = tab;
  paint(`<div class="skel" style="height:72px"></div>${loading('opening the project', 220)}`);
  let p;
  try { p = await api(`/api/projects/${id}`); }
  catch (e) {
    paint(`<div class="empty"><div class="eh">Cannot open this project</div>
      <div class="ed">${esc(e.message)}</div>
      <a class="btn" href="#/projects">Back to projects</a></div>`);
    return;
  }
  state.project = p;

  const canHold = ['presenter', 'maintainer', 'admin'].includes(p.my_role);
  // The identity sits DIRECTLY on the page. It used to be a dark slab, which
  // gave a project a masthead it does not need — you already know which one you
  // opened, and the slab pushed everything that matters below it.
  paint(`
    <a class="backlink" href="#/projects">${svg('back')} All projects</a>
    <div class="phead">
      <span class="phead-chip" style="--tabc:${esc(p.colour)}">${esc(p.chip)}</span>
      <div style="min-width:0">
        <h1 class="phead-name">${esc(p.name)}</h1>
        <p class="phead-sub">${esc(p.client || 'Internal')}${p.summary ? ' · ' + esc(p.summary) : ''}</p>
      </div>
      <div class="phead-act">
        <button class="btn" data-act="hold" type="button" ${canHold ? '' : 'disabled'}
          title="${canHold ? '' : `Your role is ${esc(p.my_role)} — presenters and above can hold a project`}">
          ${p.hold ? 'Release hold' : 'Hold for a demo'}</button>
        ${p.demo_url
          ? `<a class="btn pri" href="${esc(p.demo_url)}" target="_blank" rel="noopener">Open demo ${svg('out')}</a>`
          : ''}
      </div>
    </div>
    <div class="phead-facts">
      <div><span class="lbl">Status</span>
        <span class="v" data-status="${p.id}">${statusPill(state.statuses[p.id])}</span>
        <!-- The component detail used to be a checklist panel filling the
             Overview. It is real information and it is kept — but beside the
             status it explains, not in front of the documentation. -->
        <button class="checks-toggle" data-act="toggle-checks" type="button"
          aria-expanded="false" hidden>what was checked</button>
        <div class="checks-pop" id="checks-pop" hidden>
          <div class="checks-body" id="checks-body"></div>
        </div>
      </div>
      <div><span class="lbl">Showing</span><span class="v mono" data-profile="${p.id}">${
        esc(state.statuses[p.id]?.active_profile || '—')}</span></div>
      ${p.hold ? `<div><span class="lbl">Held</span><span class="v">${esc(p.hold.by)} until ${
        esc(new Date(p.hold.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</span></div>` : ''}
    </div>
    <nav class="tabs">${TABS.map(([t, l]) =>
      `<a class="tab-l ${t === tab ? 'on' : ''}" href="#/project/${p.id}/${t}">${l}</a>`).join('')}</nav>
    <div id="tabbody"></div>`);

  refreshStatus(p.id);
  renderChecks(p.id);
  ({ overview: tabOverview, resources: tabResources, controls: tabControls,
     notes: tabNotes }[tab] || tabOverview)(p);
}

/** The question each tab answers, stated above its content. */
const tabQuestion = (key) =>
  `<p class="tab-q">${esc((TABS.find(t => t[0] === key) || [])[2] || '')}</p>`;

/* Overview is DOCUMENTATION. Nothing else.
 *
 * It used to carry a component checklist and an event log beside the write-up,
 * and those two lists did the damage you would expect: a page whose job is to
 * explain a project opened with two scrolling tables of machine output. The
 * status lives in the header where it was already shown, the component detail
 * hangs off it, and the event log belongs to Admin, which is where the estate's
 * history is read.
 *
 * What is left reads like a document: a column of prose at a measure a person
 * can actually read, with the sections listed down the side the way any
 * documentation page lists them. */
async function tabOverview(p) {
  const sections = await docSections();
  if (!stillOn('overview', p.id)) return;
  const canEdit = ['maintainer', 'admin'].includes(p.my_role);
  const written = sections.filter(sec => (p[sec.key] || '').trim());

  if (!written.length) {
    $('#tabbody').innerHTML = `
      <div class="docpage empty-doc">
        <div class="empty inset">
          <div class="eh">Nobody has written this one up yet</div>
          <div class="ed">Five short sections — what it is, who it is for, what to
            show, how it is built, and what to be careful about — are what somebody
            handed this project an hour before a meeting actually needs.</div>
          ${canEdit
            ? `<button class="btn pri" data-act="edit-doc" type="button">Write it now</button>`
            : `<div class="ed dim">Your role is <b>${esc(p.my_role)}</b> — maintainers
               and above can write it.</div>`}
        </div>
      </div>`;
    return;
  }

  const updated = p.updated_at
    ? new Date(p.updated_at).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  $('#tabbody').innerHTML = `
    <div class="docpage">
      <article class="doc-art">
        <header class="doc-top">
          <!-- No title here. The project's name is in the page header two
               inches above; repeating it opens the document by telling the
               reader something they have just read. The lede carries the
               opening instead, which is what a lede is for. -->
          <p class="doc-kicker">${esc(p.client || 'Internal')}${
            updated ? ` · updated ${esc(updated)}` : ''}</p>
          ${p.summary ? `<p class="doc-lede">${esc(p.summary)}</p>` : ''}
          <div class="doc-tools">
            ${p.demo_url ? `<a class="btn sm" href="${esc(p.demo_url)}" target="_blank"
              rel="noopener">Open the demo ${svg('out')}</a>` : ''}
            ${canEdit ? `<button class="btn sm" data-act="edit-doc" type="button">
              ${svg('pencil')} Edit</button>` : ''}
            <span class="dim" style="font-size:12.5px">${written.length} of ${
              sections.length} sections written</span>
          </div>
        </header>

        ${sections.map(sec => {
          const v = (p[sec.key] || '').trim();
          return v
            ? `<section class="doc-s" id="s-${sec.key}">
                 <h3 class="doc-h">${esc(sec.label)}</h3>
                 <div class="doc-b">${para(v)}</div>
               </section>`
            : `<section class="doc-s empty-s" id="s-${sec.key}">
                 <h3 class="doc-h">${esc(sec.label)}</h3>
                 <div class="doc-b">
                   <span class="doc-hint">${esc(sec.hint)}</span>
                   ${canEdit
                     ? `<button class="linkbtn" data-act="edit-doc" type="button">Write this section</button>`
                     : `<span class="doc-hint">— not written yet.</span>`}
                 </div>
               </section>`;
        }).join('')}
      </article>

      <nav class="doc-rail" aria-label="On this page">
        <p class="doc-rail-h">On this page</p>
        ${sections.map(sec => `<a href="#s-${sec.key}" class="doc-rail-l${
          (p[sec.key] || '').trim() ? '' : ' un'}"
          data-jump="s-${sec.key}">${esc(sec.label)}</a>`).join('')}
      </nav>
    </div>`;
}

/** Written text, kept as the person typed it: blank lines start paragraphs and
 *  single newlines are line breaks. No markdown — this is a notes field, and a
 *  half-rendered asterisk reads worse than the asterisk. */
const para = (text) => esc(text).trim().split(/\n\s*\n/)
  .map(b => `<p>${b.replace(/\n/g, '<br>')}</p>`).join('');

/** The health payload's component list, rendered honestly: each check says what
 *  it looked at and what it found, so "Live" is never a bare claim. */
function renderChecks(id) {
  const body = $('#checks-body'), toggle = $('[data-act="toggle-checks"]');
  const st = state.statuses[id];
  if (!body) return;
  if (!st) {
    if (state.project?.id === id) setTimeout(() => renderChecks(id), 700);
    return;
  }
  const parts = Array.isArray(st.components) ? st.components : [];
  // A project with no agent has nothing to have checked — an empty disclosure
  // saying so is worse than no disclosure.
  if (toggle) {
    toggle.hidden = !parts.length;
    toggle.textContent = parts.length
      ? `${parts.filter(c => c.ok).length}/${parts.length} checks ok` : '';
  }
  if (!parts.length) return;
  body.innerHTML = parts.map(c => `<div class="row">
    <span class="row-ic" style="background:var(--${c.ok ? 'live' : 'bad'}-soft);color:var(--${c.ok ? 'live' : 'bad'})">
      ${svg(c.ok ? 'check' : 'warn')}</span>
    <div class="row-main">
      <div class="row-t">${esc(c.name)}</div>
      <div class="row-m">${esc(c.detail || (c.ok ? 'ok' : 'not ok'))}</div>
    </div>
    ${Number.isFinite(c.ms) ? `<div class="row-act"><span class="dim mono">${c.ms} ms</span></div>` : ''}
  </div>`).join('');
}

const KIND_ICON = { deck: 'deck', doc: 'doc', video: 'video', image: 'image',
                    link: 'link', code: 'code', other: 'doc' };

const humanSize = (n) => {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
};

/** One thing on the shelf. What it OFFERS depends on what it actually is: a
 *  stored file that a browser can render gets a viewer, a link opens where it
 *  lives, and an office file with no rendition says so instead of showing an
 *  empty frame. */
function resourceRow(r) {
  const canEdit = ['maintainer', 'admin'].includes(state.project?.my_role);
  const meta = [
    r.kind,
    r.size_bytes ? humanSize(r.size_bytes) : '',
    r.note || '',
  ].filter(Boolean).join(' · ');
  const open = r.preview
    ? `<button class="btn sm" data-act="view-resource" data-id="${r.id}" type="button">
         ${svg('eye')} View</button>`
    : r.url
      ? `<a class="btn sm" href="${esc(r.url)}" target="_blank" rel="noopener">${svg('out')} Open</a>`
      : '';
  return `<div class="row res">
    <span class="row-ic">${svg(KIND_ICON[r.kind] || 'doc')}</span>
    <div class="row-main">
      <div class="row-t">${esc(r.title)}</div>
      <div class="row-m">${esc(meta)}${r.needs_rendition
        ? ' · <b>no preview on this deployment</b>' : ''}</div>
    </div>
    <div class="row-act">
      ${open}
      ${r.stored ? `<a class="btn sm ghost" href="/api/resources/${r.id}/file?download=1"
          title="Download" aria-label="Download ${esc(r.title)}">${svg('down')}</a>` : ''}
      ${canEdit ? `<button class="btn sm danger" data-act="del-resource" data-id="${r.id}"
        type="button" title="Remove" aria-label="Remove ${esc(r.title)}">${svg('trash')}</button>` : ''}
    </div>
  </div>`;
}

/** The viewer. PDFs and office renditions go in a frame, video in a player,
 *  images and text in their own element — each the browser's own, none of them
 *  a library, and every one with the download still one press away. */
function viewResource(r) {
  const src = `/api/resources/${r.id}/file${r.preview === 'pdf' ? '?preview=1' : ''}`;
  const body =
    r.preview === 'pdf'   ? `<iframe class="viewer-frame" src="${src}#view=FitH" title="${esc(r.title)}"></iframe>`
  : r.preview === 'video' ? `<video class="viewer-video" src="${src}#t=0.1" controls playsinline preload="metadata"></video>`
  : r.preview === 'image' ? `<img class="viewer-img" src="${src}" alt="${esc(r.title)}">`
  : r.preview === 'text'  ? `<iframe class="viewer-frame" src="${src}" title="${esc(r.title)}"></iframe>`
  : `<div class="viewer-none">Nothing here can render this one. The download still works.</div>`;

  $('#viewer-body').innerHTML = body;
  $('#viewer-title').textContent = r.title;
  $('#viewer-meta').textContent = [r.kind, humanSize(r.size_bytes),
    r.mime || ''].filter(Boolean).join(' · ');
  $('#viewer-dl').href = `/api/resources/${r.id}/file?download=1`;
  $('#viewer').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeViewer() {
  // Stop the video rather than leaving it playing behind a closed panel.
  $('#viewer-body').innerHTML = '';
  $('#viewer').hidden = true;
  document.body.style.overflow = '';
}

function activityRow(a) {
  const tone = a.result === 'failed' ? 'bad' : a.result === 'denied' ? 'busy' : 'live';
  return `<div class="row">
    <span class="row-ic" style="background:var(--${tone}-soft);color:var(--${tone})">
      ${svg(a.result === 'ok' ? 'check' : a.result === 'denied' ? 'lock' : 'warn')}</span>
    <div class="row-main">
      <div class="row-t">${esc(a.person_name || 'someone')} ${esc(a.verb.replace(/-/g, ' '))}${a.detail ? ` — ${esc(a.detail)}` : ''}</div>
      <div class="row-m">${ago(a.at)}${a.project_name ? ' · ' + esc(a.project_name) : ''}${a.result !== 'ok' ? ` · ${esc(a.result)}` : ''}</div>
    </div>
  </div>`;
}

/* Notes — what somebody learned and wants the next presenter to know.
 *
 * Text, a file, or both, in one composer, because the distinction is not one a
 * person holds in their head: they have something to say and sometimes a file
 * that says part of it. The file goes through the same store as every other
 * resource, so it previews and downloads like everything else. */
async function tabNotes(p) {
  const canWrite = ['presenter', 'maintainer', 'admin'].includes(p.my_role);
  $('#tabbody').innerHTML = `
    ${tabQuestion('notes')}
    ${canWrite ? `
      <div class="panel">
        <div class="panel-h"><span class="lbl">Add a note</span>
          <span class="dim" style="font-size:12px">text, a file, or both</span></div>
        <div class="panel-b">
          <textarea id="note-body" class="note-in" rows="3"
            placeholder="What went wrong, what to say, what the client asked for…"></textarea>
          <div class="note-act">
            <label class="btn sm file-btn">
              ${svg('upload')} Attach a file
              <input id="note-file" type="file" hidden>
            </label>
            <span class="dim" id="note-fname" style="font-size:12.5px"></span>
            <span style="flex:1"></span>
            <button class="btn sm pri" data-act="add-note" type="button">Add note</button>
          </div>
        </div>
      </div>`
    : `<div class="panel"><div class="panel-b"><div class="row"><div class="row-main">
        <div class="row-m">Your role is <b>${esc(p.my_role)}</b> — presenters and above
        can add notes. You can read them.</div></div></div></div></div>`}
    <div class="panel">
      <div class="panel-h"><span class="lbl">Notes</span>
        <span class="dim" style="font-size:12px" id="note-count">reading…</span></div>
      <div class="panel-b tight" id="notes-body">
        <div class="skel" style="height:44px;margin:8px"></div>
      </div>
    </div>`;

  const fi = $('#note-file');
  if (fi) fi.onchange = () => {
    const f = fi.files?.[0];
    $('#note-fname').textContent = f ? `${f.name} · ${humanSize(f.size)}` : '';
  };

  let notes = [];
  try { ({ notes } = await api(`/api/projects/${p.id}/notes`)); }
  catch (e) {
    if (!stillOn('notes', p.id)) return;
    $('#notes-body').innerHTML = `<div class="row"><div class="row-main"><div class="row-m">
      Could not read the notes — ${esc(e.message)}.</div></div></div>`;
    return;
  }
  if (!stillOn('notes', p.id)) return;
  $('#note-count').textContent = notes.length ? `${notes.length}` : 'none yet';
  $('#notes-body').innerHTML = notes.length
    ? notes.map(n => noteRow(n, p)).join('')
    : `<div class="row"><div class="row-main"><div class="row-m">No notes yet. The first
       one is usually the most useful: what surprised you.</div></div></div>`;
}

function noteRow(n, p) {
  const mine = n.author_name === (state.user?.full_name || state.user?.username);
  const canRemove = mine || ['maintainer', 'admin'].includes(p.my_role);
  const when = new Date(n.created_at);
  return `<div class="row note">
    <span class="row-ic">${svg(n.file && !n.body ? 'doc' : 'note')}</span>
    <div class="row-main">
      <div class="row-t">${esc(n.author_name)}
        <span class="dim" style="font-weight:500">· ${esc(when.toLocaleString([], {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span></div>
      ${n.body ? `<div class="note-body">${para(n.body)}</div>` : ''}
      ${n.file ? `<div class="note-file">
        <span class="row-ic sm">${svg('doc')}</span>
        <span class="nf-t">${esc(n.file.title)}</span>
        <span class="dim">${humanSize(n.file.size_bytes)}</span>
        ${n.file.previewable
          ? `<button class="btn sm" data-act="view-resource" data-id="${esc(n.file.id)}"
               type="button">${svg('eye')} View</button>` : ''}
        <a class="btn sm" href="/api/resources/${esc(n.file.id)}/file?download=1">
          ${svg('down')} Download</a>
      </div>` : ''}
    </div>
    <div class="row-act">${canRemove
      ? `<button class="iconbtn" data-act="delete-note" data-id="${esc(n.id)}"
           type="button" title="Remove this note">${svg('trash')}</button>` : ''}</div>
  </div>`;
}

function tabResources(p) {
  const canEdit = ['maintainer', 'admin'].includes(p.my_role);
  $('#tabbody').innerHTML = `
    ${tabQuestion('resources')}
    <div class="panel">
      <div class="panel-h"><span class="lbl">${p.resources.length} item${p.resources.length === 1 ? '' : 's'}</span>
        ${canEdit ? `<span class="panel-tools">
            <button class="btn sm" data-act="pick-files" type="button">${svg('upload')} Upload files</button>
            <button class="btn sm" data-act="pick-folder" type="button">${svg('folder')} Upload a folder</button>
            <button class="btn sm pri" data-act="add-resource" type="button">${svg('link')} Add a link</button>
          </span>`
          : `<span class="dim" style="font-size:12px">maintainers add and remove</span>`}</div>
      <div class="panel-b tight" id="res-list">${p.resources.length
        ? p.resources.map(resourceRow).join('')
        : `<div class="row"><div class="row-main"><div class="row-m">Nothing here yet. Slides,
           documents, walkthrough videos and links to the code all belong on this shelf.</div></div></div>`}</div>
      <div id="res-progress"></div>
    </div>`;
}

/* CONTROLS: everything that changes the project, as ONE list of controls.
 *
 * Switching what a project is showing is not a different category of thing from
 * pressing a demo action or taking a hold — it is a control with a wider blast
 * radius, which is a property of the control, not a reason to give it its own
 * panel. So they share a row shape: what it is, what it does, what it costs,
 * and the thing you operate.
 */
function controlRow({ icon, name, what, cost, reversible, control, locked }) {
  return `<div class="control${locked ? ' locked' : ''}">
    <span class="control-ic">${svg(icon)}</span>
    <div class="control-main">
      <div class="control-t">${name}</div>
      <div class="control-d">${what}</div>
      ${cost ? `<span class="blast">${esc(cost)}</span>` : ''}
      ${reversible !== undefined
        ? `<span class="rev">${reversible ? 'reversible' : 'not reversible'}</span>` : ''}
    </div>
    <div class="control-act">${control}</div>
  </div>`;
}

async function tabControls(p) {
  const canRun  = ['presenter', 'maintainer', 'admin'].includes(p.my_role);
  const canSwap = ['maintainer', 'admin'].includes(p.my_role);
  const canHold = canRun;

  $('#tabbody').innerHTML = `
    ${tabQuestion('controls')}
    <div class="panel">
      <div class="panel-h"><span class="lbl">Controls</span>
        <span class="dim" style="font-size:12px">each one says what it costs before you use it</span></div>
      <div class="panel-b tight" id="controls-body">
        ${p.has_agent ? '<div class="skel" style="height:70px;margin:8px"></div>'.repeat(2) : ''}
      </div>
    </div>`;

  const rows = [];

  // 1. the hold — the only control that needs no agent at all
  rows.push(controlRow({
    icon: 'lock',
    name: p.hold ? `Held by ${esc(p.hold.by)}` : 'Hold for a demo',
    what: p.hold
      ? 'Nobody else should change this project until the hold is released.'
      : 'Warns anyone else off changing this project while you are presenting.',
    cost: 'advisory — it does not lock anything',
    control: canHold
      ? `<button class="btn sm" data-act="hold" type="button">${p.hold ? 'Release' : 'Hold'}</button>`
      : `<span class="dim" style="font-size:12px">presenters hold</span>`,
    locked: !canHold,
  }));

  if (!p.has_agent) {
    $('#controls-body').innerHTML = rows.join('') + `<div class="row"><div class="row-main">
      <div class="row-m">Everything else is read from the running project. This one has no
      agent yet, so the hold above is the only control it has.</div></div></div>`;
    return;
  }

  // 2. what it is showing — a control like any other, with the widest blast radius
  let profiles = { active: null, installed: [] };
  try { profiles = await api(`/api/projects/${p.id}/profiles`); } catch { /* shown below */ }
  // The round trip is to another host and can outlast the operator's patience.
  // If they have moved on, this answer is stale — drop it rather than paint it
  // over whatever they are looking at now.
  if (!stillOn('controls', p.id)) return;

  const others = profiles.installed.filter(x => x.key !== profiles.active);
  rows.push(controlRow({
    icon: 'grid',
    name: 'What it is showing',
    what: profiles.installed.length
      ? `Now showing <b class="mono">${esc(profiles.active || 'unknown')}</b>${
          others.length ? ` — also installed: ${others.map(x =>
            `<span class="mono">${esc(x.key)}</span>`).join(', ')}` : ''}.
         Wording, geography, branding and which widgets apply.`
      : 'The agent reported no installed profiles.',
    cost: 'presentation only — people, policy and the warehouse data are never included here',
    reversible: true,
    control: !others.length
      ? `<span class="dim" style="font-size:12px">${profiles.installed.length ? 'nothing else installed' : '—'}</span>`
      : canSwap
        ? `<span class="control-pick">
             <span class="selpill"><select id="ctl-profile" aria-label="Profile to switch to">
               ${others.map(x => `<option value="${esc(x.key)}">${esc(x.label || x.key)}</option>`).join('')}
             </select></span>
             <button class="btn sm" data-act="swap-pick" type="button">Switch</button>
           </span>`
        : `<span class="dim" style="font-size:12px">maintainers switch</span>`,
    locked: !canSwap,
  }));

  // 3. the scripted moments
  let actions = [];
  try { ({ actions } = await api(`/api/projects/${p.id}/actions`)); }
  catch (e) {
    if (!stillOn('controls', p.id)) return;
    rows.push(`<div class="row"><div class="row-main"><div class="row-m">Could not read the
      action list — ${esc(e.message)}.</div></div></div>`);
  }
  if (!stillOn('controls', p.id)) return;

  for (const a of actions) {
    rows.push(controlRow({
      icon: 'bolt',
      name: esc(a.label),
      what: esc(a.description || ''),
      cost: a.blast_radius,
      reversible: a.reversible !== false,
      control: canRun
        ? `<button class="btn sm pri" data-act="run-action" data-id="${esc(a.id)}" type="button">Run</button>`
        : `<span class="dim" style="font-size:12px">presenters run</span>`,
      locked: !canRun,
    }));
  }
  if (!actions.length) {
    rows.push(`<div class="row"><div class="row-main"><div class="row-m">The agent reported no
      demo actions.</div></div></div>`);
  }

  $('#controls-body').innerHTML = rows.join('');
}

/* ── admin ──────────────────────────────────────────────────────────────── */

/* The same tab framework as a project: one question per tab, nothing in two
 * places. Admin is the console's own administration — who may sign in and what
 * they may reach, and what everyone has been doing. */
const ADMIN_TABS = [
  ['people',   'People & access', 'Who can sign in, and what can they reach?'],
  ['activity', 'Activity',        'What has happened across the whole estate?'],
];

function adminShell(tab, body) {
  return `<div class="head"><h1 class="ptitle">Admin</h1></div>
    <nav class="tabs">${ADMIN_TABS.map(([t, l]) =>
      `<a class="tab-l ${t === tab ? 'on' : ''}" href="#/admin/${t}">${l}</a>`).join('')}</nav>
    <p class="tab-q">${esc((ADMIN_TABS.find(t => t[0] === tab) || [])[2] || '')}</p>
    <div id="adminbody">${body}</div>`;
}

async function viewAdmin(tab) {
  if (state.user?.org_role !== 'admin') {
    paint(`<div class="head"><h1 class="ptitle">Admin</h1></div>
      <div class="empty"><div class="eh">This area is for console admins</div>
        <div class="ed">Admin holds the people who can sign in, what each of them can reach,
          and the estate-wide activity log. Your account is a member — ask a console admin
          if you need it.</div>
        <a class="btn" href="#/projects">Back to projects</a></div>`);
    return;
  }
  state.adminTab = tab;
  paint(adminShell(tab, loading(tab === 'people' ? 'reading the roster' : 'reading the log', 260)));
  if (tab === 'activity') return adminActivity();
  return adminPeople();
}

async function adminPeople() {
  let people = [];
  try { ({ people } = await api('/api/people')); }
  catch (e) {
    $('#adminbody').innerHTML = `<div class="empty"><div class="eh">Not available</div>
      <div class="ed">${esc(e.message)}</div></div>`;
    return;
  }
  if (state.adminTab !== 'people') return;
  state.people = people;
  $('#adminbody').innerHTML = `
    <div class="tablewrap"><table>
      <thead><tr><th>Person</th><th>Sign-in</th><th>Console role</th>
        <th>Account</th><th class="num">Projects</th><th>Last seen</th><th></th></tr></thead>
      <tbody>${people.map(p => `<tr>
        <td><div class="cellname">
          <span class="avatar" style="width:28px;height:28px;font-size:10px">${esc(initials(p.full_name || p.username))}</span>
          <div style="min-width:0"><strong>${esc(p.full_name || p.username)}</strong>
            <div class="row-m mono">${esc(p.username)}</div></div></div></td>
        <td>${p.local_account ? 'password'
              : p.kc_sub.startsWith('dev-') ? 'developer identity' : 'single sign-on'}</td>
        <td><span class="tag">${esc(p.org_role)}</span></td>
        <td>${p.status === 'active'
          ? '<span class="pill live"><span class="d"></span>Active</span>'
          : '<span class="pill bad"><span class="d"></span>Disabled</span>'}</td>
        <td class="num">${p.projects}</td>
        <td>${ago(p.last_seen)}</td>
        <td><button class="btn sm" data-act="manage-person" data-id="${esc(p.kc_sub)}"
          type="button">Manage</button></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
}

async function adminActivity() {
  let activity = [];
  try { ({ activity } = await api('/api/activity?limit=300')); }
  catch (e) {
    $('#adminbody').innerHTML = `<div class="empty"><div class="eh">Not available</div>
      <div class="ed">${esc(e.message)}</div></div>`;
    return;
  }
  if (state.adminTab !== 'activity') return;
  $('#adminbody').innerHTML = `
    <div class="strip" style="margin-bottom:16px">
      <div class="selpill"><select id="a-result" aria-label="Filter by outcome">
        <option value="">Every outcome</option><option value="ok">Succeeded</option>
        <option value="failed">Failed</option><option value="denied">Denied</option>
      </select></div>
      <span class="dim" style="font-size:12.5px">Append-only, newest first. Sign-ins,
        registrations, password changes, profile switches, actions, resource changes and
        access grants all land here.</span>
    </div>
    <div class="panel"><div class="panel-b tight" id="act-body">${activity.length
      ? activity.map(activityRow).join('')
      : '<div class="row"><div class="row-main"><div class="row-m">Nothing recorded yet.</div></div></div>'}</div></div>`;

  $('#a-result')?.addEventListener('change', (e) => {
    const want = e.target.value;
    const rows = want ? activity.filter(a => a.result === want) : activity;
    e.target.closest('.selpill').classList.toggle('set', !!want);
    $('#act-body').innerHTML = rows.length ? rows.map(activityRow).join('')
      : `<div class="row"><div class="row-main"><div class="row-m">No entries with that outcome.</div></div></div>`;
  });
}

/* ── settings: your own account ─────────────────────────────────────────── */

async function viewSettings() {
  paint(`<div class="head"><h1 class="ptitle">Settings</h1></div>${loading('reading your account', 220)}`);
  let acct = { local_account: false, org_role: state.user?.org_role || 'member' };
  try { acct = await api('/api/me/account'); } catch { /* shown as read-only below */ }
  let projects = state.projects;
  if (!projects.length) { try { ({ projects } = await api('/api/projects')); } catch { projects = []; } }
  const u = state.user || {};
  const theme = localStorage.getItem('console-theme') || 'system';

  paint(`
    <div class="head"><h1 class="ptitle">Settings</h1></div>
    <p class="psub">Your own account. Who can reach which project is decided in Admin by a
      console admin — this page never grants anything.</p>
    <div class="split">
      <div class="stack">
        <div class="panel">
          <div class="panel-h"><span class="lbl">Your details</span>
            <span class="dim" style="font-size:12px">${esc(u.username || '')} ·
              ${acct.local_account ? 'password account' : 'single sign-on'}</span></div>
          <div class="panel-b">
            ${fieldL('s-name', 'Full name', `value="${esc(u.full_name || '')}"`)}
            ${fieldL('s-email', 'Email', `type="email" value="${esc(u.email || '')}"`,
              'Used to address you, and to reach you if a password reset is ever emailed.')}
            <div style="display:flex;justify-content:flex-end">
              <button class="btn pri" data-act="save-profile" type="button">Save</button>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-h"><span class="lbl">Password</span></div>
          <div class="panel-b">
            ${acct.local_account ? `
              ${fieldL('s-cur', 'Current password', 'type="password" autocomplete="current-password"')}
              ${fieldL('s-new', 'New password', 'type="password" autocomplete="new-password"',
                'At least 10 characters. Changing it signs out your other sessions.')}
              <div style="display:flex;justify-content:flex-end">
                <button class="btn pri" data-act="change-password" type="button">Change password</button>
              </div>`
            : `<div class="muted">This account signs in through single sign-on, so its
                 password lives with the identity provider rather than here.</div>`}
          </div>
        </div>
      </div>

      <div class="stack">
        <div class="panel">
          <div class="panel-h"><span class="lbl">Appearance</span></div>
          <div class="panel-b tight">
            ${[['system', 'Follow the system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) =>
              `<div class="row"><div class="row-main"><div class="row-t">${l}</div></div>
                <div class="row-act">${theme === v
                  ? '<span class="pill info"><span class="d"></span>On</span>'
                  : `<button class="btn sm" data-act="set-theme" data-id="${v}" type="button">Use</button>`}</div>
              </div>`).join('')}
          </div>
        </div>

        <div class="panel">
          <div class="panel-h"><span class="lbl">What you can reach</span>
            <span class="dim" style="font-size:12px">${acct.org_role === 'admin'
              ? 'console admin — every project' : 'member'}</span></div>
          <div class="panel-b tight">
            ${projects.length ? projects.map(p => `<div class="row">
              <span class="dot2" style="--tabc:${esc(p.colour)}">${esc(p.chip)}</span>
              <div class="row-main"><div class="row-t">${esc(p.name)}</div>
                <div class="row-m">${esc(p.client || 'Internal')}</div></div>
              <div class="row-act"><span class="tag">${esc(p.my_role || 'viewer')}</span></div>
            </div>`).join('')
            : `<div class="row"><div class="row-main"><div class="row-m">No projects yet.
                A console admin grants access to one before it appears here.</div></div></div>`}
          </div>
        </div>

        <div class="panel">
          <div class="panel-h"><span class="lbl">Session</span></div>
          <div class="panel-b">
            <button class="btn" data-act="sign-out" type="button">Sign out</button>
          </div>
        </div>
      </div>
    </div>`);
}

/* ── modal ──────────────────────────────────────────────────────────────── */

function modal(html) {
  $('#modal-box').innerHTML = html;
  $('#modal').hidden = false;
  setTimeout(() => $('#modal-box input, #modal-box select')?.focus(), 30);
}
function closeModal() { $('#modal').hidden = true; $('#modal-box').innerHTML = ''; }

/** One documentation field. The create form and the editor both call this, so
 *  a section reads and behaves identically wherever it is being written. */
const docField = (sec, value) =>
  `<label class="field-l" for="doc-${sec.key}"><span class="t">${esc(sec.label)}</span>
    <textarea id="doc-${sec.key}" rows="3" placeholder="${esc(sec.hint)}">${esc(value || '')}</textarea>
   </label>`;

const fieldL = (id, label, attrs = '', hint = '') =>
  `<label class="field-l" for="${id}"><span class="t">${label}</span>
    <input id="${id}" ${attrs}>${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;

/* ── actions ────────────────────────────────────────────────────────────── */

const handlers = {
  'new-project': async () => {
    const sections = await docSections();
    modal(`
    <h3>Add a project</h3>
    <p>A project needs a name and a slug. Everything else can be filled in later —
      including the write-up, which is what its Overview shows.</p>
    ${fieldL('f-name', 'Name', 'placeholder="National Health Data Warehouse"')}
    ${fieldL('f-slug', 'Slug', 'placeholder="nhdw"', 'Lowercase, used in links. Cannot change later.')}
    ${fieldL('f-client', 'Client', 'placeholder="Ministry of Health · Ethiopia"')}
    <label class="field-l"><span class="t">Code &amp; colour</span>
      <span style="display:flex;gap:9px">
        <input id="f-chip" maxlength="3" placeholder="NH" style="width:90px">
        <input id="f-colour" type="color" value="#16181d" style="width:64px">
      </span>
      <span class="hint">Two letters and a colour identify the project without a logo upload.</span></label>
    ${fieldL('f-demo', 'Demo URL', 'placeholder="https://internal-bi.example.nip.io"')}
    ${fieldL('f-agent', 'Agent URL', 'placeholder="https://gateway.example.nip.io"',
      'Where the demo contract answers. Leave blank for a resource-folder-only project.')}
    ${fieldL('f-token', 'Agent token', 'type="password" placeholder="X-Demo-Token"',
      'Stays on the server and is never sent back to a browser.')}

    <div class="field-sep"><span>The write-up</span></div>
    <p class="hint" style="margin:-4px 0 12px">These are the Overview, section for
      section. Write what you can now; a maintainer can finish it later.</p>
    ${sections.map(sec => docField(sec, '')).join('')}

    <div class="modal-actions">
      <button class="btn" data-act="close" type="button">Cancel</button>
      <button class="btn pri" data-act="create-project" type="button">Add project</button>
    </div>`); },

  'create-project': async () => {
    const body = {
      name: $('#f-name').value.trim(), slug: $('#f-slug').value.trim(),
      client: $('#f-client').value.trim() || null,
      chip: ($('#f-chip').value.trim() || '??').toUpperCase(),
      colour: $('#f-colour').value,
      demo_url: $('#f-demo').value.trim() || null,
      agent_url: $('#f-agent').value.trim() || null,
      agent_token: $('#f-token').value.trim() || null,
      // The write-up, read from the very fields the section list built.
      ...Object.fromEntries(DOC_SECTIONS.map(sec =>
        [sec.key, $(`#doc-${sec.key}`)?.value.trim() || null])),
    };
    if (!body.name || !/^[a-z0-9][a-z0-9-]{1,48}$/.test(body.slug)) {
      toast('Check the form', 'A name and a lowercase slug are required.', 'bad'); return;
    }
    try {
      await api('/api/projects', { method: 'POST', body });
      closeModal(); toast('Project added', body.name, 'ok'); route();
    } catch (e) { toast('Could not add the project', e.message, 'bad'); }
  },

  'toggle-checks': (el) => {
    const pop = $('#checks-pop');
    if (!pop) return;
    const open = pop.hidden;
    pop.hidden = !open;
    el.setAttribute('aria-expanded', String(open));
  },

  'edit-doc': async () => {
    const p = state.project;
    if (!p) return;
    const sections = await docSections();
    modal(`
      <h3>The write-up</h3>
      <p>What the Overview shows. Leave a section empty and the Overview says so
        rather than pretending it is not there.</p>
      ${sections.map(sec => docField(sec, p[sec.key])).join('')}
      <div class="modal-actions">
        <button class="btn" data-act="close" type="button">Cancel</button>
        <button class="btn pri" data-act="save-doc" type="button">Save</button>
      </div>`);
  },

  'save-doc': async () => {
    const p = state.project;
    const body = Object.fromEntries(DOC_SECTIONS.map(sec =>
      [sec.key, $(`#doc-${sec.key}`)?.value.trim() || '']));
    try {
      const updated = await api(`/api/projects/${p.id}`, { method: 'PATCH', body });
      Object.assign(state.project, updated);
      closeModal(); toast('Saved', 'The write-up is updated.', 'ok');
      if (state.tab === 'overview') tabOverview(state.project);
    } catch (e) { toast('Could not save it', e.message, 'bad'); }
  },

  'add-note': async () => {
    const p = state.project;
    const text = $('#note-body')?.value.trim() || '';
    const file = $('#note-file')?.files?.[0] || null;
    if (!text && !file) {
      toast('Nothing to add', 'A note needs words, a file, or both.', 'bad'); return;
    }
    const btn = $('[data-act="add-note"]');
    if (btn) { btn.disabled = true; btn.textContent = file ? 'Uploading…' : 'Saving…'; }
    const fd = new FormData();
    fd.append('body', text);
    if (file) fd.append('file', file, file.name);
    try {
      const r = await fetch(`/api/projects/${p.id}/notes`, { method: 'POST', body: fd });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
      toast('Note added', file ? file.name : text.slice(0, 40), 'ok');
      if (state.tab === 'notes') tabNotes(p);
    } catch (e) { toast('Could not add the note', e.message, 'bad'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Add note'; } }
  },

  'delete-note': async (el) => {
    const id = el.dataset.id;
    if (!confirm('Remove this note?')) return;
    try {
      await api(`/api/notes/${id}`, { method: 'DELETE' });
      toast('Note removed', '', 'ok');
      if (state.tab === 'notes') tabNotes(state.project);
    } catch (e) { toast('Could not remove it', e.message, 'bad'); }
  },

  'add-resource': () => modal(`
    <h3>Add a resource</h3>
    ${fieldL('r-title', 'Title', 'placeholder="Overview deck"')}
    <label class="field-l" for="r-kind"><span class="t">Kind</span>
      <select id="r-kind">
        <option value="deck">Slide deck</option><option value="doc">Document</option>
        <option value="video">Video walkthrough</option><option value="image">Image</option>
        <option value="link">Link</option><option value="other">Other</option>
      </select></label>
    ${fieldL('r-url', 'URL', 'placeholder="https://…"', 'File upload lands in a later pass; a link works today.')}
    ${fieldL('r-note', 'Note', 'placeholder="optional"')}
    <div class="modal-actions">
      <button class="btn" data-act="close" type="button">Cancel</button>
      <button class="btn pri" data-act="create-resource" type="button">Add</button>
    </div>`),

  'create-resource': async () => {
    const p = state.project; if (!p) return;
    const body = {
      title: $('#r-title').value.trim(), kind: $('#r-kind').value,
      url: $('#r-url').value.trim() || null, note: $('#r-note').value.trim() || null,
    };
    if (!body.title || !body.url) { toast('Check the form', 'A title and a URL are required.', 'bad'); return; }
    try {
      await api(`/api/projects/${p.id}/resources`, { method: 'POST', body });
      closeModal(); toast('Resource added', body.title, 'ok');
      viewProject(p.id, 'resources');
    } catch (e) { toast('Could not add it', e.message, 'bad'); }
  },

  /* ── uploads ──────────────────────────────────────────────────────────── */

  'pick-files':  () => pickAndUpload(false),
  'pick-folder': () => pickAndUpload(true),

  'view-resource': (el) => {
    const r = (state.project?.resources || []).find(x => x.id === el.dataset.id);
    if (r) viewResource(r);
  },
  'close-viewer': closeViewer,

  'del-resource': async (el) => {
    const p = state.project; if (!p) return;
    try {
      await api(`/api/resources/${el.dataset.id}`, { method: 'DELETE' });
      toast('Resource removed', '', 'ok'); viewProject(p.id, state.tab);
    } catch (e) { toast('Could not remove it', e.message, 'bad'); }
  },

  'run-action': async (el) => {
    const p = state.project; if (!p) return;
    el.disabled = true;
    try {
      const job = await api(`/api/projects/${p.id}/action/${el.dataset.id}`, { method: 'POST' });
      trackJob(p.id, job);
      toast('Action ran', job.stages?.[0]?.note || 'Done.', 'ok');
      if (job.deep_link && p.demo_url) {
        window.open(p.demo_url.replace(/\/$/, '') + job.deep_link, '_blank', 'noopener');
      }
      setTimeout(() => viewProject(p.id, state.tab), 600);
    } catch (e) { toast('The action failed', e.message, 'bad'); }
    finally { el.disabled = false; }
  },

  'swap-pick': (el) => {
    const key = $('#ctl-profile')?.value;
    if (key) handlers.swap({ dataset: { id: key } });
  },

  swap: (el) => {
    const p = state.project; if (!p) return;
    const key = el.dataset.id;
    modal(`<h3>Switch to ${esc(key)}</h3>
      <div class="callout"><b>Everyone looking at this project right now</b> sees the change.
      Presentation switches in seconds. People, policy and the warehouse data are separate,
      heavier layers that an operator path applies — they are <b>not</b> included here.</div>
      <div class="panel"><div class="panel-b tight">
        <div class="row"><span class="row-ic" style="background:var(--live-soft);color:var(--live)">${svg('check')}</span>
          <div class="row-main"><div class="row-t">Presentation</div>
            <div class="row-m">wording, geography, branding, which widgets apply</div></div></div>
        <div class="row"><span class="row-ic">2</span>
          <div class="row-main"><div class="row-t">People and policy</div>
            <div class="row-m">not applied from here</div></div></div>
        <div class="row"><span class="row-ic">3</span>
          <div class="row-main"><div class="row-t">Source data</div>
            <div class="row-m">not applied from here</div></div></div>
      </div></div>
      <div class="modal-actions">
        <button class="btn" data-act="close" type="button">Cancel</button>
        <button class="btn pri" data-act="confirm-swap" data-id="${esc(key)}" type="button">Switch now</button>
      </div>`);
  },

  'confirm-swap': async (el) => {
    const p = state.project; if (!p) return;
    try {
      const job = await api(`/api/projects/${p.id}/profile`,
        { method: 'POST', body: { profile: el.dataset.id, layers: ['presentation'] } });
      closeModal();
      trackJob(p.id, job);
      const skipped = (job.stages || []).filter(s => s.state === 'skipped').length;
      toast('Presentation switched', skipped
        ? `Now showing ${el.dataset.id}. ${skipped} heavier layer${skipped === 1 ? '' : 's'} were not applied here.`
        : `Now showing ${el.dataset.id}.`, 'ok');
      setTimeout(() => viewProject(p.id, 'profiles'), 700);
    } catch (e) { closeModal(); toast('The switch was refused', e.message, 'bad'); }
  },

  hold: async () => {
    const p = state.project; if (!p) return;
    try {
      if (p.hold) {
        await api(`/api/projects/${p.id}/hold`, { method: 'DELETE' });
        toast('Hold released', 'Others can change this project again.', 'ok');
      } else {
        await api(`/api/projects/${p.id}/hold`, { method: 'POST', body: { minutes: 60 } });
        toast('Held for an hour', 'Others will be warned before changing it.', 'ok');
      }
      viewProject(p.id, state.tab);
    } catch (e) { toast('Could not change the hold', e.message, 'bad'); }
  },

  'clear-filters': () => { state.q = ''; state.fCat = ''; state.fVal = ''; viewProjects(); },

  /* ── settings ─────────────────────────────────────────────────────────── */

  'save-profile': async () => {
    try {
      const fresh = await api('/api/me', { method: 'PATCH', body: {
        full_name: $('#s-name').value.trim(), email: $('#s-email').value.trim() } });
      state.user = fresh;
      const who = fresh.full_name || fresh.username;
      $('#who-name').textContent = who;
      $('#btn-user').textContent = initials(who);
      toast('Saved', 'Your details are up to date.', 'ok');
    } catch (e) { toast('Could not save that', e.message, 'bad'); }
  },

  'change-password': async () => {
    const current = $('#s-cur').value, password = $('#s-new').value;
    if (!current || !password) { toast('Check the form', 'Both fields are needed.', 'bad'); return; }
    try {
      await api('/api/me/password', { method: 'POST', body: { current, password } });
      $('#s-cur').value = ''; $('#s-new').value = '';
      toast('Password changed', 'Your other sessions have been signed out.', 'ok');
    } catch (e) { toast('Could not change it', e.message, 'bad'); }
  },

  'set-theme': (el) => {
    const v = el.dataset.id;
    if (v === 'system') { document.documentElement.removeAttribute('data-theme'); localStorage.removeItem('console-theme'); }
    else { document.documentElement.dataset.theme = v; localStorage.setItem('console-theme', v); }
    viewSettings();
  },

  'sign-out': async () => { await fetch('/auth/logout', { method: 'POST' }); location.reload(); },

  /* ── admin: one person, everything about them ─────────────────────────── */

  'manage-person': async (el) => {
    const person = (state.people || []).find(p => p.kc_sub === el.dataset.id);
    if (!person) return;
    state.managing = person;
    let projects = state.projects;
    if (!projects.length) { try { ({ projects } = await api('/api/projects')); state.projects = projects; } catch { projects = []; } }
    const ungranted = projects.filter(p => !person.grants.some(g => g.project_id === p.id));
    const me = person.kc_sub === state.user?.sub;
    modal(`
      <h3>${esc(person.full_name || person.username)}</h3>
      <p>${esc(person.username)}${person.email ? ' · ' + esc(person.email) : ''} ·
        ${person.local_account ? 'signs in with a password'
          : person.kc_sub.startsWith('dev-') ? 'a developer identity, only usable on a dev console'
          : 'signs in through single sign-on'}</p>

      <label class="field-l" for="m-role"><span class="t">Console role</span>
        <select id="m-role">
          <option value="member" ${person.org_role === 'member' ? 'selected' : ''}>Member — only the projects granted below</option>
          <option value="admin" ${person.org_role === 'admin' ? 'selected' : ''}>Admin — every project, and this screen</option>
        </select>
        <span class="hint">${me ? 'This is your own account.' : ''} A change signs them out so it applies at once.</span></label>

      <label class="field-l"><span class="t">Account</span>
        <span style="display:flex;gap:9px;align-items:center">
          ${person.status === 'active'
            ? `<span class="pill live"><span class="d"></span>Active</span>
               <button class="btn sm" data-act="set-status" data-id="disabled" type="button" ${me ? 'disabled' : ''}>Disable</button>`
            : `<span class="pill bad"><span class="d"></span>Disabled</span>
               <button class="btn sm" data-act="set-status" data-id="active" type="button">Re-enable</button>`}
          ${person.local_account
            ? `<button class="btn sm" data-act="reset-link" type="button">Issue a reset link</button>` : ''}
        </span>
        <span class="hint">A disabled account cannot sign in and is signed out immediately.</span></label>
      <div id="m-link"></div>

      <label class="field-l"><span class="t">Project access</span></label>
      <div class="panel"><div class="panel-b tight" id="m-grants">
        ${person.grants.length ? person.grants.map(g => `<div class="row">
          <div class="row-main"><div class="row-t">${esc(g.project_name)}</div>
            <div class="row-m">${esc(g.role)}</div></div>
          <div class="row-act">
            <button class="btn sm danger" data-act="revoke-grant" data-id="${esc(g.project_id)}"
              type="button">Revoke</button></div>
        </div>`).join('')
        : '<div class="row"><div class="row-main"><div class="row-m">No projects yet — they see nothing.</div></div></div>'}
      </div></div>

      ${ungranted.length ? `
      <label class="field-l" style="margin-top:14px"><span class="t">Grant another</span>
        <span style="display:flex;gap:9px">
          <select id="m-proj">${ungranted.map(p =>
            `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>
          <select id="m-grole" style="max-width:150px">
            <option value="viewer">Viewer</option><option value="presenter">Presenter</option>
            <option value="maintainer">Maintainer</option><option value="admin">Admin</option>
          </select>
          <button class="btn pri" data-act="add-grant" type="button">Grant</button>
        </span></label>` : ''}

      <div class="modal-actions">
        <button class="btn" data-act="close" type="button">Done</button>
        <button class="btn pri" data-act="save-person" type="button">Save role</button>
      </div>`);
  },

  'save-person': async () => {
    const p = state.managing; if (!p) return;
    try {
      await api(`/api/people/${p.kc_sub}/org-role`,
        { method: 'POST', body: { org_role: $('#m-role').value } });
      closeModal(); toast('Console role updated', `${p.username} is now a ${$('#m-role')?.value || ''}`.trim(), 'ok');
      viewAdmin('people');
    } catch (e) { toast('Could not change the role', e.message, 'bad'); }
  },

  'set-status': async (el) => {
    const p = state.managing; if (!p) return;
    try {
      await api(`/api/people/${p.kc_sub}/status`, { method: 'POST', body: { status: el.dataset.id } });
      closeModal();
      toast(el.dataset.id === 'active' ? 'Account re-enabled' : 'Account disabled',
        el.dataset.id === 'active' ? `${p.username} can sign in again.`
                                   : `${p.username} has been signed out.`, 'ok');
      viewAdmin('people');
    } catch (e) { toast('Could not change the account', e.message, 'bad'); }
  },

  'reset-link': async () => {
    const p = state.managing; if (!p) return;
    try {
      const r = await api(`/api/people/${p.kc_sub}/reset-link`, { method: 'POST' });
      $('#m-link').innerHTML = `<div class="callout">
        <b>${r.emailed ? 'Emailed, and here it is too.' : 'Hand this to them yourself.'}</b>
        It works once and expires in ${r.expires_in_minutes} minutes.
        <input class="mono" readonly value="${esc(r.link)}"
          style="width:100%;margin-top:8px;height:38px;padding:0 10px;border-radius:9px;border:1px solid var(--line-2);background:var(--paper)">
      </div>`;
      $('#m-link input').select();
    } catch (e) { toast('Could not issue a link', e.message, 'bad'); }
  },

  'add-grant': async () => {
    const p = state.managing; if (!p) return;
    try {
      await api(`/api/projects/${$('#m-proj').value}/grants`, { method: 'POST',
        body: { person_sub: p.kc_sub, role: $('#m-grole').value } });
      closeModal(); toast('Access granted', `${p.username} can now reach it.`, 'ok');
      viewAdmin('people');
    } catch (e) { toast('Could not grant that', e.message, 'bad'); }
  },

  'revoke-grant': async (el) => {
    const p = state.managing; if (!p) return;
    try {
      await api(`/api/projects/${el.dataset.id}/grants/${p.kc_sub}`, { method: 'DELETE' });
      closeModal(); toast('Access revoked', `${p.username} can no longer see it.`, 'ok');
      viewAdmin('people');
    } catch (e) { toast('Could not revoke that', e.message, 'bad'); }
  },

  close: closeModal,

};

/* ── uploads ────────────────────────────────────────────────────────────── */

/** One file at a time, reported as it goes. A folder is the same thing with
 *  `webkitdirectory` set — the browser hands over its files with their relative
 *  paths, which we keep as the note so the shelf stays a flat list of things
 *  you can open rather than a tree nobody navigates. */
function pickAndUpload(folder) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  if (folder) { input.webkitdirectory = true; input.directory = true; }
  input.onchange = () => uploadAll([...input.files]);
  input.click();
}

async function uploadAll(files) {
  const p = state.project;
  if (!p || !files.length) return;
  const box = $('#res-progress');
  let done = 0, failed = 0;

  for (const f of files) {
    if (box) {
      box.innerHTML = `<div class="uploading">
        <div class="meter-t"><span>${esc(f.name)}</span></div>
        <div class="bar"><i style="width:${Math.round(done / files.length * 100)}%"></i></div>
        <span class="row-m">${done} of ${files.length}${failed ? ` · ${failed} failed` : ''}</span>
      </div>`;
    }
    const body = new FormData();
    body.append('file', f);
    body.append('title', f.name);
    // webkitRelativePath is the only place the folder structure survives
    if (f.webkitRelativePath && f.webkitRelativePath !== f.name) {
      body.append('note', f.webkitRelativePath.split('/').slice(0, -1).join(' / '));
    }
    try {
      const res = await fetch(`/api/projects/${p.id}/resources/upload`, { method: 'POST', body });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `failed (${res.status})`);
      done++;
    } catch (e) {
      failed++;
      toast(`Could not upload ${f.name}`, e.message, 'bad');
    }
  }
  if (box) box.innerHTML = '';
  toast(done ? `${done} file${done === 1 ? '' : 's'} uploaded` : 'Nothing was uploaded',
    failed ? `${failed} failed — the rest are on the shelf.` : '', failed ? 'bad' : 'ok');
  viewProject(p.id, 'resources');
}

/* ── command palette ────────────────────────────────────────────────────── */

let paletteIndex = 0;
function openPalette() {
  $('#palette').hidden = false;
  $('#palette-input').value = '';
  renderPalette('');
  $('#palette-input').focus();
}
function closePalette() { $('#palette').hidden = true; }

function paletteItems(q) {
  const items = state.projects.map(p => ({
    label: p.name, hint: p.client || 'project', go: `#/project/${p.id}`,
  }));
  items.push(
    { label: 'Projects', hint: 'the collection', go: '#/projects' },
    { label: 'Activity', hint: 'who did what', go: '#/activity' },
    { label: 'People & access', hint: 'grants', go: '#/people' },
  );
  const needle = q.toLowerCase().trim();
  return needle ? items.filter(i => (i.label + ' ' + i.hint).toLowerCase().includes(needle)) : items;
}

function renderPalette(q) {
  const items = paletteItems(q);
  paletteIndex = 0;
  $('#palette-list').innerHTML = items.length ? items.map((i, n) =>
    `<div class="pitem ${n === 0 ? 'on' : ''}" data-go="${esc(i.go)}">
      <span class="pt">${esc(i.label)}</span><span class="pk">${esc(i.hint)}</span></div>`).join('')
    : `<div class="pitem"><span class="pk">Nothing matches.</span></div>`;
}

/* ── the sign-in artwork ────────────────────────────────────────────────── */

/* WHICH ARTWORK the sign-in panel shows. null falls back to the rotating globe
 * below, which is kept in full for exactly that reason.
 *
 * The blend belongs WITH the file, not with the panel: a piece on a black
 * ground wants `screen`, which makes that black vanish into the panel. A piece
 * painted edge to edge wants `normal` — screening it would wash the paint out
 * and take the caption with it.
 */
const ARTWORK = {
  'login-art.jpg':     { blend: 'screen', opacity: .95 },  // the cube burst, on black
  'login-art-alt.jpg': { blend: 'normal', opacity: 1 },    // the painted arcs
};
const ART = 'login-art.jpg';   // or 'login-art-alt.jpg', or null for the globe

/** A slowly rotating globe with the demo estate marked on it: a node for each
 *  place the console has driven a demo, and an arc from home out to each one.
 *  That is what the product is — one place, many environments, in different
 *  countries — so the artwork states the subject rather than decorating it.
 *
 *  It is drawn as a SOLID sphere, not a wire cage: the body is filled first and
 *  only the near hemisphere is stroked on top, which is what makes the eye read
 *  a ball instead of a tangle of ellipses. Hand-rolled 3D on a 2D canvas — no
 *  library, no build step — and it stops dead under prefers-reduced-motion.
 */
function loginArt() {
  const still = $('#login-art-img');
  const c = $('#signin-canvas');
  if (ART) {
    const how = ARTWORK[ART] || { blend: 'normal', opacity: 1 };
    if (still) {
      still.style.setProperty('--login-art', `url('/assets/${ART}')`);
      still.style.mixBlendMode = how.blend;
      still.style.opacity = String(how.opacity);
    }
    if (c) c.hidden = true;
    return;
  }
  if (still) still.hidden = true;
  if (c) c.hidden = false;
  if (!c) return;
  const ctx = c.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Where the estate is, and where it has been shown.
  const SITES = [
    [9.0, 38.7],    // Addis Ababa
    [-15.4, 28.3],  // Lusaka
    [-1.3, 36.8],   // Nairobi
    [6.5, 3.4],     // Lagos
    [-26.2, 28.0],  // Johannesburg
    [51.5, -0.1],   // London
    [38.9, -77.0],  // Washington
    [23.8, 90.4],   // Dhaka
    [1.3, 103.8],   // Singapore
  ];
  const HOME = 0;
  const CAM = 3.2;
  // Coastlines, so it is unmistakably the Earth rather than a wire ball. Ours,
  // in web/assets — the console depends on no project for its own artwork.
  // Simplified to one decimal place: 75 rings, 4,675 points, 50KB, loaded only
  // on this screen. Absent or unreachable, the globe simply has no land.
  let LAND = null;
  fetch('/assets/coastlines.json')
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      if (!d?.rings) return;
      LAND = d.rings.map(flat => {
        const pts = [];
        for (let i = 0; i < flat.length; i += 2) pts.push(unit(flat[i + 1], flat[i]));
        return pts;
      });
    })
    .catch(() => { /* the globe works without it */ });
  const TILT = -0.40;
  let W = 0, H = 0, R = 0, LIMB = 0, cx = 0, cy = 0, raf = 0, spin = 0.6;

  const unit = (lat, lon) => {
    const a = lat * Math.PI / 180, b = lon * Math.PI / 180;
    return [Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)];
  };
  const turn = (p) => {                       // spin about Y, then a fixed tilt
    const x = p[0] * Math.cos(spin) + p[2] * Math.sin(spin);
    const z = -p[0] * Math.sin(spin) + p[2] * Math.cos(spin);
    return [x, p[1] * Math.cos(TILT) - z * Math.sin(TILT),
            p[1] * Math.sin(TILT) + z * Math.cos(TILT)];
  };
  const project = (p, r = 1) => {
    const s = CAM / (CAM - p[2] * r);
    return [cx + p[0] * r * R * s, cy - p[1] * r * R * s, p[2]];
  };

  const size = () => {
    const rect = c.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = rect.width; H = rect.height;
    c.width = Math.max(1, W * dpr); c.height = Math.max(1, H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    R = Math.min(W, H) * 0.34;
    // The silhouette of a sphere under this projection is not the r=1 great
    // circle: the tangent point sits at cos(phi) = 1/CAM, which works out to
    // this. Getting it right is what lets the fill and the strokes line up.
    LIMB = R * CAM / Math.sqrt(CAM * CAM - 1);
    cx = W / 2; cy = H / 2;
  };

  /** Stroke a polyline, dropping everything on the far side of the sphere — and
   *  anything that lands outside the silhouette, which a lifted arc does near
   *  the limb and which would read as a wire flying off the ball. */
  const inside = (p) => Math.hypot(p[0] - cx, p[1] - cy) <= LIMB - 0.5;
  const nearLine = (pts, alpha, width = 1) => {
    ctx.lineWidth = width;
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    let drawing = false;
    ctx.beginPath();
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (a[2] <= 0.02 || b[2] <= 0.02 || !inside(a) || !inside(b)) { drawing = false; continue; }
      if (!drawing) { ctx.moveTo(a[0], a[1]); drawing = true; }
      ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
  };

  const draw = () => {
    ctx.clearRect(0, 0, W, H);

    // the body, lit from the upper left so it has volume
    const body = ctx.createRadialGradient(
      cx - LIMB * .42, cy - LIMB * .48, LIMB * .06, cx, cy, LIMB * 1.05);
    body.addColorStop(0, 'rgba(255,255,255,.155)');
    body.addColorStop(.55, 'rgba(255,255,255,.055)');
    body.addColorStop(1, 'rgba(255,255,255,.012)');
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(cx, cy, LIMB, 0, Math.PI * 2); ctx.fill();

    // the silhouette
    ctx.strokeStyle = 'rgba(255,255,255,.36)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(cx, cy, LIMB, 0, Math.PI * 2); ctx.stroke();

    for (let lat = -75; lat <= 75; lat += 15) {           // parallels
      const pts = [];
      for (let lon = 0; lon <= 360; lon += 4) pts.push(project(turn(unit(lat, lon))));
      nearLine(pts, lat === 0 ? .34 : .18, lat === 0 ? 1.15 : 1);
    }
    for (let lon = 0; lon < 180; lon += 15) {             // meridians
      const pts = [];
      for (let lat = -90; lat <= 90; lat += 4) pts.push(project(turn(unit(lat, lon))));
      nearLine(pts, .18);
    }

    if (LAND) {                                           // the land itself
      for (const ring of LAND) {
        const pts = ring.map(v => project(turn(v)));
        pts.push(pts[0]);
        nearLine(pts, .58, 1.1);
      }
    }

    // arcs from home to every other site, lifted just clear of the surface
    const home = turn(unit(...SITES[HOME]));
    SITES.forEach((s, i) => {
      if (i === HOME) return;
      const to = turn(unit(...s));
      if (home[2] <= 0.02 && to[2] <= 0.02) return;       // both behind
      const pts = [];
      for (let t = 0; t <= 1.0001; t += 1 / 36) {
        const v = [home[0] + (to[0] - home[0]) * t,
                   home[1] + (to[1] - home[1]) * t,
                   home[2] + (to[2] - home[2]) * t];
        const len = Math.hypot(v[0], v[1], v[2]) || 1;
        pts.push(project([v[0] / len, v[1] / len, v[2] / len],
                         1 + 0.05 * Math.sin(Math.PI * t)));
      }
      nearLine(pts, .52, 1.2);
    });

    SITES.forEach((s, i) => {                             // the sites
      const [x, y, z] = project(turn(unit(...s)));
      if (z <= 0.04) return;                              // round the back
      const a = Math.min(1, 0.3 + z);
      if (i === HOME) {
        const pulse = reduced ? .5 : (Math.sin(spin * 5) + 1) / 2;
        ctx.fillStyle = `rgba(255,255,255,${0.14 * (1 - pulse * .7)})`;
        ctx.beginPath(); ctx.arc(x, y, 5 + pulse * 10, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = `rgba(255,255,255,${0.5 * a})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath(); ctx.arc(x, y, i === HOME ? 3.4 : 2.4, 0, Math.PI * 2); ctx.fill();
    });

    if (!reduced) { spin += 0.0019; raf = requestAnimationFrame(draw); }
  };

  cancelAnimationFrame(raf);
  size(); draw();
  addEventListener('resize', () => { cancelAnimationFrame(raf); size(); draw(); });
}

/* ── boot ───────────────────────────────────────────────────────────────── */

/* Four things happen on this screen and they share one panel: signing in,
 * creating an account, asking for a reset link, and redeeming one. Each states
 * its own heading and lede so nobody has to work out which one they are on. */
let authCfg = { oidc: false, env: 'prod', signup: false, can_email: false };
let resetToken = '';

function showSignIn(mode = 'signin', token = '') {
  resetToken = token || resetToken;
  $('#app').hidden = true;
  $('#signin').hidden = false;
  renderLogin(mode);
  loginArt();
}

/* The heading carries the thesis on the way IN, and the task on every other
 * screen. The artwork used to repeat "every demo, one place" in its corner;
 * saying it once, in the largest type on the panel, is better than twice. */
const LOGIN_COPY = {
  signin:   ['Every demo,<br>one place.',
             'Live status, what each project is showing, and the moments worth pressing.'],
  register: ['Create an account',
             'A new account reaches no project until a console admin grants it one.'],
  forgot:   ['Forgot your password',
             'Give us the username or email on the account and we will mint a single-use link.'],
  reset:    ['Choose a new password',
             'This link works once. Setting a password here signs you in.'],
};

/** A login field. It borrows the console's own label idiom — small, uppercase,
 *  letterspaced — so the way in looks like the thing it leads to. */
const lf = (id, label, attrs = '', hint = '') =>
  `<label class="field-l" for="${id}"><span class="t">${label}</span>
    <input id="${id}" ${attrs}>${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;

function renderLogin(mode) {
  const [title, lede] = LOGIN_COPY[mode] || LOGIN_COPY.signin;
  $('#login-title').innerHTML = title;
  $('#login-lede').textContent = lede;
  const body = $('#login-body');
  const foot = $('#login-foot');

  $('.login-form')?.classList.toggle('compact', mode !== 'signin');

  const sso = authCfg.oidc
    ? `<a class="btn pri" href="/auth/login">Sign in with Palladium</a>` : '';
  if (mode === 'register') {
    // Two short fields share a row: it is one line less to read, and it stops
    // the tallest of the four forms dictating a card everything else rattles in.
    body.innerHTML = `
      <div class="frow">
        ${lf('lg-user', 'Username', 'autocomplete="username" placeholder="maya"')}
        ${lf('lg-name', 'Full name', 'autocomplete="name" placeholder="Maya Tesfaye"')}
      </div>
      ${lf('lg-email', 'Email', 'type="email" autocomplete="email" placeholder="maya@palladium.example"')}
      ${lf('lg-pw', 'Password', 'type="password" autocomplete="new-password"', 'At least 10 characters.')}
      <button class="btn pri wide" data-act="do-register" type="button">Create account</button>`;
    foot.innerHTML = `<span class="dim">Already have one?</span>
      <button class="linkbtn" data-act="mode-signin" type="button">Sign in</button>`;
  } else if (mode === 'forgot') {
    body.innerHTML = `
      ${lf('lg-id', 'Username or email', 'autocomplete="username"')}
      <button class="btn pri wide" data-act="do-forgot" type="button">Send me a link</button>
      <div id="lg-note"></div>`;
    foot.innerHTML = `<span class="dim">Remembered it?</span>
      <button class="linkbtn" data-act="mode-signin" type="button">Back to sign in</button>`;
  } else if (mode === 'reset') {
    body.innerHTML = `
      ${lf('lg-pw', 'New password', 'type="password" autocomplete="new-password"', 'At least 10 characters.')}
      <button class="btn pri wide" data-act="do-reset" type="button">Set it and sign in</button>`;
    foot.innerHTML = `<span class="dim">Not you?</span>
      <button class="linkbtn" data-act="mode-signin" type="button">Back to sign in</button>`;
  } else {
    body.innerHTML = `
      ${lf('lg-id', 'Username or email', 'autocomplete="username"')}
      ${lf('lg-pw', 'Password', 'type="password" autocomplete="current-password"')}
      <button class="btn pri wide" data-act="do-login" type="button">Sign in</button>
      ${sso}`;
    foot.innerHTML = `
      <button class="linkbtn" data-act="mode-forgot" type="button">Forgot your password?</button>
      ${authCfg.signup
        ? `<button class="linkbtn" data-act="mode-register" type="button">Create an account</button>` : ''}`;
  }
  setTimeout(() => body.querySelector('input')?.focus(), 30);
}

Object.assign(handlers, {
  'mode-signin':   () => renderLogin('signin'),
  'mode-register': () => renderLogin('register'),
  'mode-forgot':   () => renderLogin('forgot'),

  'do-login': async (el) => {
    el.disabled = true;
    try {
      await api('/auth/password-login', { method: 'POST', body: {
        identifier: $('#lg-id').value.trim(), password: $('#lg-pw').value } });
      location.hash = '#/projects';
      location.reload();
    } catch (e) { toast('Could not sign you in', e.message, 'bad'); el.disabled = false; }
  },

  'do-register': async (el) => {
    el.disabled = true;
    try {
      await api('/auth/register', { method: 'POST', body: {
        username: $('#lg-user').value.trim(), full_name: $('#lg-name').value.trim(),
        email: $('#lg-email').value.trim(), password: $('#lg-pw').value } });
      location.hash = '#/projects';
      location.reload();
    } catch (e) { toast('Could not create that account', e.message, 'bad'); el.disabled = false; }
  },

  'do-forgot': async (el) => {
    el.disabled = true;
    try {
      const r = await api('/auth/forgot', { method: 'POST', body: {
        identifier: $('#lg-id').value.trim() } });
      // The message never says whether the account exists; the link only ever
      // comes back on a development console with no mail relay.
      $('#lg-note').innerHTML = `<div class="callout">${esc(r.message)}${r.link ? `
        <input class="mono" readonly value="${esc(r.link)}"
          style="width:100%;margin-top:8px;height:38px;padding:0 10px;border-radius:9px;border:1px solid var(--line-2);background:var(--paper)">
        <span class="hint">Shown because this console has no mail relay and is running in
          development.</span>` : ''}</div>`;
    } catch (e) { toast('Could not do that', e.message, 'bad'); }
    finally { el.disabled = false; }
  },

  'do-reset': async (el) => {
    el.disabled = true;
    try {
      await api('/auth/reset', { method: 'POST', body: {
        token: resetToken, password: $('#lg-pw').value } });
      location.hash = '#/projects';
      location.reload();
    } catch (e) { toast('That did not work', e.message, 'bad'); el.disabled = false; }
  },
});

async function boot() {
  const saved = localStorage.getItem('console-theme');
  if (saved) document.documentElement.dataset.theme = saved;
  else document.documentElement.removeAttribute('data-theme');

  if (!/Mac|iPhone|iPad/.test(navigator.platform || '')) {
    const k = $('#kbd-hint'); if (k) k.textContent = 'Ctrl K';
  }

  // /auth/session rather than /api/me: "not signed in" is the expected answer on
  // a first visit, and it should not look like an error in the browser console.
  let session = { signed_in: false };
  try { session = await fetch('/auth/session').then(r => r.json()); } catch { /* offline */ }
  if (!session.signed_in) {
    authCfg = await fetch('/auth/config').then(r => r.json()).catch(() => authCfg);
    const m = location.hash.match(/^#\/reset\/(.+)$/);
    showSignIn(m ? 'reset' : 'signin', m ? m[1] : '');
    return;
  }
  state.user = session.user;
  $('#signin').hidden = true;
  $('#app').hidden = false;
  const who = state.user.full_name || state.user.username;
  $('#btn-user').textContent = initials(who);
  $('#btn-user').title =
    `${who} · ${state.user.org_role === 'admin' ? 'console admin' : 'member'} — sign out`;
  $('#who-name').textContent = who;
  $('#nav-admin').hidden = state.user.org_role !== 'admin';
  renderJob(); renderFleet();
  // A reset link followed while already signed in has nothing to redeem.
  if (/^#\/reset\//.test(location.hash)) location.hash = '#/projects';
  route();
}

/* ── events ─────────────────────────────────────────────────────────────── */

addEventListener('hashchange', route);

// Scroll and resize both change whether anything is below the fold. Passive,
// and the work is two reads and a class toggle.
document.addEventListener('scroll', (e) => {
  if (e.target instanceof Element && e.target.id === 'canvas') edgeFade();
}, { capture: true, passive: true });
addEventListener('resize', edgeFade, { passive: true });
addEventListener('DOMContentLoaded', watchEdge);
if (document.readyState !== 'loading') watchEdge();

document.addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]');
  if (act) {
    e.preventDefault();
    const fn = handlers[act.dataset.act];
    if (fn) await fn(act);
    return;
  }
  const view = e.target.closest('[data-view]');
  if (view) {
    state.view = view.dataset.view;
    localStorage.setItem('console-view', state.view);
    $$('.vt').forEach(b => {
      const on = b.dataset.view === state.view;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    renderCollection();
    return;
  }
  const go = e.target.closest('[data-go]');
  if (go) { location.hash = go.dataset.go; closePalette(); return; }
  const row = e.target.closest('tr[data-href]');
  if (row) { location.hash = row.dataset.href; return; }

  if (e.target.id === 'modal') closeModal();
  if (e.target.id === 'viewer') closeViewer();
  if (e.target.id === 'palette') closePalette();
  if (e.target.closest('#btn-search')) openPalette();
  if (e.target.closest('#btn-theme')) {
    const now = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = now;
    localStorage.setItem('console-theme', now);
  }
  if (e.target.closest('#btn-user')) {
    await fetch('/auth/logout', { method: 'POST' });
    location.reload();
  }
});

/** Re-lay the collection and the affordances around it without rebuilding the
 *  controls, so focus and the caret stay where they were. */
function refreshStrip() {
  renderCollection();
  const strip = $('.strip');
  if (!strip) return;
  strip.querySelector('#f-cat')?.closest('.selpill').classList.toggle('set', !!state.fCat);
  strip.querySelector('#f-val')?.closest('.selpill').classList.toggle('set', !!state.fVal);
  const existing = strip.querySelector('.linkbtn');
  if (filtersActive() && !existing) {
    const b = document.createElement('button');
    b.className = 'linkbtn'; b.type = 'button';
    b.dataset.act = 'clear-filters'; b.textContent = 'Clear';
    strip.append(b);
  } else if (!filtersActive() && existing) { existing.remove(); }
}

document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { state.q = e.target.value; refreshStrip(); }
  if (e.target.id === 'palette-input') renderPalette(e.target.value);
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'sort') {
    state.sort = e.target.value;
    localStorage.setItem('console-sort', state.sort);
    renderCollection();
  }
  if (e.target.id === 'f-cat') {
    // A new dimension invalidates the old value, so the second select is rebuilt
    // rather than left holding something that means nothing here.
    state.fCat = e.target.value;
    state.fVal = '';
    const val = $('#f-val');
    const cat = FILTERS[state.fCat];
    val.disabled = !cat;
    val.innerHTML = `<option value="">${cat ? 'Any ' + cat.label.toLowerCase() : 'Pick a filter first'}</option>`
      + (cat?.values || []).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    refreshStrip();
  }
  if (e.target.id === 'f-val') { state.fVal = e.target.value; refreshStrip(); }
});

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (e.key === '/' && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) {
    e.preventDefault(); openPalette(); return;
  }
  if (e.key === 'Escape') { closePalette(); closeModal(); closeViewer(); return; }
  if ($('#palette').hidden) return;
  const items = $$('.pitem[data-go]');
  if (!items.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    paletteIndex = (paletteIndex + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((el, n) => el.classList.toggle('on', n === paletteIndex));
    items[paletteIndex].scrollIntoView({ block: 'nearest' });
  }
  if (e.key === 'Enter') { e.preventDefault(); items[paletteIndex]?.click(); }
});

boot();
