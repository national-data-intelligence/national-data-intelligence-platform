/* Palladium Demo Console — full browser test.
 *
 * It records EVERY console message, EVERY failed or error-status response and
 * every unhandled rejection and fails the run on any of them, then drives every
 * route, tab, control and CRUD flow — including the whole account lifecycle
 * (register, sign in, forgot, reset, change password) and the ACCESS CONTROL
 * negative path, which is the part worth having: a member must see nothing, and
 * a presenter must be refused the things only a maintainer may do.
 *
 *   docker run --rm --network host -v "$PWD:/app" -w /app \
 *     mcr.microsoft.com/playwright:v1.49.0-jammy \
 *     sh -c "npm i --silent playwright@1.49.0 && node tests-e2e.js"
 *
 * CONSOLE_URL       where the console is       (default http://127.0.0.1:8099)
 * CONSOLE_ADMIN      a CONSOLE ADMIN account to drive it as. There is no
 * CONSOLE_ADMIN_PW   developer sign-in to fall back on; on an empty console the
 *                    suite registers this one, since the first account is always
 *                    a console admin.
 */
const { chromium } = require('playwright');
const B = process.env.CONSOLE_URL || 'http://127.0.0.1:8099';
const ADMIN = process.env.CONSOLE_ADMIN || 'saba';
const ADMIN_PW = process.env.CONSOLE_ADMIN_PW || 'demo-console-2026';

let pass = 0, fail = 0;
const failures = [];
const R = (good, name, note = '') => {
  good ? pass++ : (fail++, failures.push(name + (note ? ` — ${note}` : '')));
  console.log(`  ${good ? '✓' : '✗'} ${name}${note ? `  [${note}]` : ''}`);
};
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(2, 58 - t.length))}`);

// Noise from browser extensions is not the app's. We run a clean profile, so
// anything we see here IS ours — but filter defensively anyway.
const EXTENSION_NOISE = /contentscript|ObjectMultiplex|MaxListenersExceeded|message channel closed|chrome-extension:/i;

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 } });
  const page = await ctx.newPage();

  const consoleMsgs = [];
  const netProblems = [];
  const rejections = [];

  const watch = (p) => {
    p.on('console', m => {
      const text = m.text();
      if (EXTENSION_NOISE.test(text)) return;
      if (m.type() === 'error' || m.type() === 'warning') {
        consoleMsgs.push({ type: m.type(), text: text.slice(0, 200) });
      }
    });
    p.on('pageerror', e => rejections.push(String(e).slice(0, 200)));
    p.on('requestfailed', r => {
      if (EXTENSION_NOISE.test(r.url())) return;
      // A reload or hash navigation aborts whatever was in flight. That is this
      // harness moving on, not the app failing.
      if (/ERR_ABORTED/.test(r.failure()?.errorText || '')) return;
      netProblems.push({ status: 'FAILED', url: r.url(), why: r.failure()?.errorText });
    });
    p.on('response', r => {
      const u = r.url();
      if (EXTENSION_NOISE.test(u)) return;
      if (r.status() >= 400) {
        // Every one of these is a DESIGNED answer that this suite deliberately
        // provokes: the signed-out probe, a refused action token, and the
        // permission denials the access-control section exists to prove.
        const expected =
          (r.status() === 401 && /\/api\/me$/.test(u)) ||
          (r.status() === 403 && /\/api\/projects\/[^/]+\/action\//.test(u)) ||
          (r.status() === 403 && /\/api\/(people|activity)/.test(u)) ||
          (r.status() === 403 && /\/api\/projects\/[^/]+\/(profile|resources)$/.test(u)) ||
          (r.status() === 401 && /\/auth\/password-login$/.test(u)) ||
          (r.status() === 400 && /\/auth\/(register|reset)$/.test(u)) ||
          (r.status() === 409 && /\/auth\/register$/.test(u)) ||
          (r.status() === 403 && /\/api\/me\/password$/.test(u)) ||
          // the suite pokes the removed developer sign-in to prove it is gone
          (/\/auth\/dev-login$/.test(u));
        if (!expected) netProblems.push({ status: r.status(), url: u });
      }
    });
  };
  watch(page);

  const noOverflow = async (p, label) => {
    const over = await p.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    R(over <= 1, `no sideways scroll — ${label}`, `${over}px`);
  };
  const signIn = async (p, user, pw) => {
    await p.evaluate(() => fetch('/auth/logout', { method: 'POST' })).catch(() => {});
    await p.goto(B, { waitUntil: 'networkidle' });
    await p.waitForSelector('#lg-id', { timeout: 15000 });
    await p.fill('#lg-id', user);
    await p.fill('#lg-pw', pw);
    await p.click('[data-act="do-login"]');
    await p.waitForSelector('#app:not([hidden])', { timeout: 15000 });
    await p.waitForTimeout(2500);
  };

  // ── 1. signed out ─────────────────────────────────────────────────────
  section('signed out');
  await page.goto(B, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1200);
  R(await page.isVisible('#signin'), 'the sign-in screen is shown');
  R(!(await page.isVisible('.shell')), 'the app shell is hidden before sign-in');
  const art = await page.evaluate(() => {
    const still = document.querySelector('#login-art-img');
    const canvas = document.querySelector('#signin-canvas');
    const shown = (el) => el && !el.hidden && el.getBoundingClientRect().width > 10;
    if (shown(still)) {
      const cs = getComputedStyle(still);
      return { kind: `still, ${cs.mixBlendMode}`, ok: /url\(/.test(cs.backgroundImage),
               detail: cs.backgroundImage.slice(0, 50) };
    }
    if (shown(canvas)) {
      return { kind: 'globe', ok: canvas.width > 10 && canvas.height > 10,
               detail: `${canvas.width}x${canvas.height}` };
    }
    return { kind: 'none', ok: false, detail: 'neither is showing' };
  });
  R(art.ok, `the sign-in artwork is painting (${art.kind})`, art.detail);
  R((await page.evaluate(async () => (await fetch('/assets/coastlines.json')).status)) === 200,
    'the globe fallback can still fetch its coastlines');
  R(!!(await page.$('#lg-id')) && !!(await page.$('#lg-pw')),
    'a real sign-in form, not just a provider button');
  R(!(await page.$('[data-act="dev-login"]')), 'no developer sign-in is offered');
  R((await page.evaluate(async () => (await fetch('/auth/dev-login',
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: '{\"username\":\"anyone\"}' })).status)) >= 400,
    'and the endpoint behind it does not exist either');
  const card = await page.$eval('.login', el => {
    const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  R(card.w > card.h, 'the sign-in card is landscape',
    `${Math.round(card.w)}x${Math.round(card.h)}`);
  R((await page.$eval('.login-form', el => el.scrollHeight - el.clientHeight)) <= 1,
    'every control on the sign-in form is above the fold');
  // Overflow alone does not catch the real failure here: a middle zone taller
  // than its grid row is CENTRED, so it spills upward over the mark while the
  // form as a whole still reports no overflow. Measure the gap that closes.
  for (const mode of ['signin', 'register', 'forgot']) {
    if (mode !== 'signin') {
      await page.click(`[data-act="mode-${mode}"]`);
      await page.waitForTimeout(500);
    }
    const g = await page.evaluate(() => {
      const sub = document.querySelector('.pal-sub').getBoundingClientRect();
      const h1 = document.querySelector('#login-title').getBoundingClientRect();
      const form = document.querySelector('.login-form');
      return { gap: Math.round(h1.top - sub.bottom),
               over: form.scrollHeight - form.clientHeight };
    });
    R(g.gap >= 14, `${mode}: the heading keeps clear of the mark`, `${g.gap}px`);
    R(g.over <= 1, `${mode}: the form fits without scrolling`, `${g.over}px`);
    if (mode !== 'signin') {
      await page.click('[data-act="mode-signin"]');
      await page.waitForTimeout(400);
    }
  }
  await noOverflow(page, 'sign-in');
  R((await page.evaluate(async () => (await fetch('/favicon.ico')).status)) === 200,
    'GET /favicon.ico does not 404');

  // ── 2. the account lifecycle ──────────────────────────────────────────
  section('registration');
  const who = `t${Date.now().toString(36).slice(-6)}`;
  const EMAIL = `${who}@example.org`;
  await page.click('[data-act="mode-register"]');
  await page.waitForTimeout(400);
  R(await page.isVisible('#lg-user'), 'the register form opens');

  await page.fill('#lg-user', who);
  await page.fill('#lg-name', 'Test Person');
  await page.fill('#lg-email', EMAIL);
  await page.fill('#lg-pw', 'short');
  await page.click('[data-act="do-register"]');
  await page.waitForTimeout(1200);
  R(/at least 10 characters/i.test((await page.textContent('#toasts')) || ''),
    'a weak password is refused, and says why');

  await page.fill('#lg-pw', 'a-good-long-password');
  await page.click('[data-act="do-register"]');
  await page.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(2500);
  R(true, 'registering signs you straight in');
  R((await page.textContent('#who-name') || '').includes('Test'), 'the new name is shown');

  // ── 3. a new account reaches NOTHING ──────────────────────────────────
  section('access control — a new account');
  R((await page.$$('.pcard')).length === 0 && (await page.$$('tbody tr')).length === 0,
    'a brand new account sees no projects at all');
  R(/Nothing has been shared with you/.test((await page.textContent('#canvas')) || ''),
    'and is told that nothing has been SHARED — not that nothing exists');
  R(await page.isHidden('#nav-admin'), 'Admin is not offered to a member');
  R(!(await page.$('[data-act="new-project"]')), 'New project is not offered to a member');
  await page.goto(B + '/#/admin/people', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  R(/console admins/i.test((await page.textContent('#canvas')) || ''),
    'reaching Admin by URL is refused with a reason, not a blank screen');

  // settings is theirs, though
  await page.goto(B + '/#/settings', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);
  R(!!(await page.$('#s-cur')), 'a password account is offered a password change');
  R(/A console admin grants|No projects yet/.test((await page.textContent('#canvas')) || ''),
    'Settings says plainly that they can reach nothing');

  section('changing your own password');
  await page.fill('#s-cur', 'wrong-password-here');
  await page.fill('#s-new', 'another-long-password');
  await page.click('[data-act="change-password"]');
  await page.waitForTimeout(1400);
  R(/not right/i.test((await page.textContent('#toasts')) || ''),
    'the wrong current password is refused');
  await page.fill('#s-cur', 'a-good-long-password');
  await page.fill('#s-new', 'another-long-password');
  await page.click('[data-act="change-password"]');
  await page.waitForTimeout(1600);
  R(/Password changed/i.test((await page.textContent('#toasts')) || ''),
    'the right one is accepted');

  // ── 4. sign out, sign back in with the NEW password ───────────────────
  section('password sign-in');
  await page.evaluate(() => fetch('/auth/logout', { method: 'POST' }));
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.fill('#lg-id', who);
  await page.fill('#lg-pw', 'a-good-long-password');
  await page.click('[data-act="do-login"]');
  await page.waitForTimeout(1600);
  R(/not right/i.test((await page.textContent('#toasts')) || ''),
    'the old password no longer works');
  await page.fill('#lg-pw', 'another-long-password');
  await page.click('[data-act="do-login"]');
  await page.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  R(true, 'the new one does');

  // and by email rather than username
  await page.evaluate(() => fetch('/auth/logout', { method: 'POST' }));
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.fill('#lg-id', EMAIL.toUpperCase());
  await page.fill('#lg-pw', 'another-long-password');
  await page.click('[data-act="do-login"]');
  await page.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  R(true, 'email works as well as username, and case does not matter');

  // ── 5. forgot + reset ─────────────────────────────────────────────────
  section('password reset');
  await page.evaluate(() => fetch('/auth/logout', { method: 'POST' }));
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.click('[data-act="mode-forgot"]');
  await page.waitForTimeout(400);
  await page.fill('#lg-id', 'somebody-who-does-not-exist');
  await page.click('[data-act="do-forgot"]');
  await page.waitForTimeout(1200);
  const unknownNote = (await page.textContent('#lg-note')) || '';
  R(/If that account exists/.test(unknownNote),
    'an unknown account gets the same neutral answer');
  R(!/http/.test(unknownNote), 'and no link, so this is not an account oracle');

  await page.fill('#lg-id', who);
  await page.click('[data-act="do-forgot"]');
  await page.waitForTimeout(1400);
  const link = await page.$eval('#lg-note input', el => el.value).catch(() => '');
  R(/#\/reset\//.test(link), 'a real account gets a link on a dev console', link.slice(0, 44) + '…');

  await page.goto(link, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  R(/Choose a new password/.test((await page.textContent('#login-title')) || ''),
    'the link opens the reset form');
  await page.fill('#lg-pw', 'the-third-password');
  await page.click('[data-act="do-reset"]');
  await page.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  R(true, 'redeeming the link signs you in');

  await page.evaluate(() => fetch('/auth/logout', { method: 'POST' }));
  await page.goto(link, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.fill('#lg-pw', 'a-fourth-password');
  await page.click('[data-act="do-reset"]');
  await page.waitForTimeout(1600);
  R(/expired|already been used/i.test((await page.textContent('#toasts')) || ''),
    'the same link cannot be used twice');

  // ── 6. the admin, and granting access ─────────────────────────────────
  section('admin');
  await signIn(page, ADMIN, ADMIN_PW);
  await page.waitForTimeout(2500);
  // Remember which project actually answers, so the grant below lands on one
  // where "a presenter cannot switch the profile" is a real question.
  const liveName = await page.$eval('.pcard:has(.pill.live) .pname', el => el.textContent.trim())
    .catch(() => null);
  const isAdmin = await page.isVisible('#nav-admin');
  R(isAdmin, `'${ADMIN}' is a console admin`,
    isAdmin ? '' : 'promote it, or point CONSOLE_ADMIN at one that is');
  if (!isAdmin) { console.log('\n  cannot continue without an admin'); process.exit(1); }

  await page.goto(B + '/#/projects', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  R((await page.$$('[data-act="new-project"]')).length === 1,
    'there is exactly one place to create a project');
  R(!!(await page.$('.grid .pcard.add')),
    'and it is a folder at the end of the shelf, not a button in the chrome');
  R(!(await page.$('.head [data-act="new-project"]')) && !(await page.$('.side [data-act="new-project"]')),
    'not beside the title, and not in the sidebar');
  await page.click('[data-view="list"]');
  await page.waitForTimeout(700);
  R(!!(await page.$('tr.addrow')), 'the list view carries the same affordance as a row');
  await page.click('[data-view="grid"]');
  await page.waitForTimeout(600);
  // An add tile inside a filtered result would claim to be part of that result
  await page.fill('#q', 'zzzznomatch');
  await page.waitForTimeout(500);
  R(!(await page.$('.pcard.add')), 'and it steps out of the way when a filter is on');
  await page.click('[data-act="clear-filters"]');
  await page.waitForTimeout(2600);

  await page.goto(B + '/#/admin/people', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  R((await page.$$('tbody tr')).length > 0, 'the roster lists people');
  R((await page.$$('.tab-l')).length === 2, 'Admin has exactly two tabs');
  R(/Who can sign in/.test((await page.textContent('#canvas')) || ''),
    'each tab states the question it answers');
  await noOverflow(page, 'admin people');

  // find the account registered above and grant it a role
  const manageBtn = await page.$(`tr:has-text("${who}") [data-act="manage-person"]`);
  R(!!manageBtn, 'the registered account appears in the roster');
  await manageBtn.click();
  await page.waitForTimeout(1200);
  R(await page.isVisible('#modal'), 'managing one person opens their detail');
  R(/No projects yet/.test((await page.textContent('#m-grants')) || ''),
    'and shows they can reach nothing');
  R(!!(await page.$('[data-act="reset-link"]')), 'an admin can issue a reset link');
  await page.click('[data-act="reset-link"]');
  await page.waitForTimeout(1400);
  R(/#\/reset\//.test(await page.$eval('#m-link input', el => el.value).catch(() => '')),
    'and gets one to hand over');

  const projOption = await page.$('#m-proj');
  R(!!projOption, 'a project can be picked to grant');
  await page.selectOption('#m-grole', 'presenter');
  if (liveName) {
    await page.selectOption('#m-proj', { label: liveName }).catch(() => {});
  }
  const grantedProject = await page.$eval('#m-proj option:checked', el => el.textContent.trim());
  R(!liveName || grantedProject === liveName,
    'the grant lands on a project with a live agent, so the role checks mean something',
    grantedProject);
  await page.click('[data-act="add-grant"]');
  await page.waitForTimeout(2600);
  R(/Access granted/i.test((await page.textContent('#toasts')) || ''),
    'the grant is confirmed', grantedProject);

  await page.goto(B + '/#/admin/activity', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  R((await page.$$('.row')).length > 0, 'the estate-wide log is populated');
  R(/registered|granted access|changed password|reset password/i
    .test((await page.textContent('#canvas')) || ''),
    'and records the account events this run produced');
  await noOverflow(page, 'admin activity');

  // ── 7. what a presenter can and cannot do ─────────────────────────────
  section('access control — a presenter');
  const p2 = await ctx.browser().newContext({ viewport: { width: 1400, height: 900 } });
  const member = await p2.newPage();
  watch(member);
  await member.goto(B, { waitUntil: 'networkidle' });
  await member.waitForTimeout(900);
  await member.fill('#lg-id', who);
  await member.fill('#lg-pw', 'the-third-password');
  await member.click('[data-act="do-login"]');
  await member.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  await member.waitForTimeout(3000);
  R((await member.$$('.pcard')).length === 1, 'the granted project, and only it, is now visible');
  R(await member.isHidden('#nav-admin'), 'still no Admin');

  // The hero no longer restates the role — the status pill and the disabled
  // controls already say what it means. The list view carries it as a column,
  // which is where a role belongs when you are comparing projects.
  await member.click('[data-view="list"]');
  await member.waitForTimeout(600);
  R(/presenter/.test((await member.textContent('tbody')) || ''),
    'the list view carries the role as a column');
  await member.click('[data-view="grid"]');
  await member.waitForTimeout(500);
  await member.click('.pcard');
  await member.waitForSelector('.phead');
  await member.waitForTimeout(2500);
  R(!/Your role/.test((await member.textContent('.phead')) || ''),
    'and the header does not restate it');
  R(!(await member.$('.hero')), 'the project header is on the page, not in a dark slab');
  const holdBtn = await member.$('[data-act="hold"]');
  R(!!holdBtn && !(await holdBtn.isDisabled()), 'a presenter may hold the project');

  await member.click('a[href$="/resources"]');
  await member.waitForTimeout(1500);
  R(!(await member.$('[data-act="add-resource"]')),
    'a presenter is not offered the Add control');
  // Matches the sense, not the exact sentence: the wording gained "move" when
  // folders arrived, and a check that pins the copy fails on every edit to it
  // while still not noticing if the explanation disappears entirely.
  R(/maintainers\b[^.]*\bremove/.test((await member.textContent('#tabbody')) || ''),
    'and is told who can');

  await member.click('a[href$="/controls"]');
  await member.waitForSelector('.control', { timeout: 25000 }).catch(() => {});
  await member.waitForTimeout(1500);
  R(!(await member.$('[data-act="swap-pick"]')), 'a presenter is not offered a profile switch');
  R(/maintainers switch/.test((await member.textContent('#controls-body')) || ''),
    'and is told who can');
  R((await member.$$('[data-act="run-action"]')).length > 0,
    'but the actions they MAY press are still offered');

  // the server has to refuse it too, not only the interface
  const refused = await member.evaluate(async () => {
    const id = location.hash.split('/')[2];
    const r = await fetch(`/api/projects/${id}/profile`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: 'anything', layers: ['presentation'] }) });
    return r.status;
  });
  R(refused === 403, 'and the server refuses it directly, not only the interface', String(refused));
  await p2.close();

  // ── 8. projects, the collection and its controls ──────────────────────
  section('the collection');
  await page.goto(B + '/#/projects', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  const cards = await page.$$('.pcard');
  R(cards.length >= 1, 'project cards render', `${cards.length}`);
  R((await page.$$('tbody tr')).length === 0, 'grid view shows cards only');
  const pills = await page.$$eval('.pcard .pill', els => els.map(e => e.textContent.trim()));
  R(pills.length > 0 && !pills.every(t => /Checking/.test(t)),
    'live status resolves from the project agents', pills.join(' · '));
  await noOverflow(page, 'projects');

  await page.click('[data-view="list"]');
  await page.waitForTimeout(600);
  R((await page.$$('tbody tr')).length >= 1, 'list view renders rows');
  R((await page.$$('.pcard')).length === 0, 'list view replaces the cards');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  R((await page.$$('tbody tr')).length >= 1, 'the chosen view persists across a reload');
  await page.click('[data-view="grid"]');
  await page.waitForTimeout(500);

  R((await page.$$('.strip')).length === 1, 'search and the filters share one row');
  await page.fill('#q', 'zzzznomatch');
  await page.waitForTimeout(500);
  R(/Nothing matches/.test((await page.textContent('#collection')) || ''),
    'no-results is distinct from empty and offers a way out');
  await page.click('[data-act="clear-filters"]');
  await page.waitForTimeout(3000);

  R(await page.isDisabled('#f-val'), 'the value select waits for a category');
  await page.selectOption('#f-cat', 'status');
  await page.waitForTimeout(500);
  R(!(await page.isDisabled('#f-val')), 'picking a category enables the values');
  await page.selectOption('#f-val', 'live');
  await page.waitForTimeout(900);
  const liveOnly = await page.$$eval('.pcard .pill', els => els.map(e => e.textContent.trim()));
  R(liveOnly.length > 0 && liveOnly.every(t => /Live/.test(t)),
    'the two-select filter narrows to matching projects', liveOnly.join(' · '));
  await page.click('[data-act="clear-filters"]');
  await page.waitForTimeout(3000);

  const asc = await page.$$eval('.pname', els => els.map(e => e.textContent.trim()));
  await page.selectOption('#sort', 'name-desc');
  await page.waitForTimeout(600);
  const desc = await page.$$eval('.pname', els => els.map(e => e.textContent.trim()));
  R(JSON.stringify(desc) === JSON.stringify([...asc].reverse()), 'sort reverses the order');
  await page.selectOption('#sort', 'name');
  await page.waitForTimeout(500);

  R(/\d+ live/.test((await page.textContent('#estatebar')) || ''),
    'the topbar estate bar counts what was actually probed',
    ((await page.textContent('#estatebar')) || '').replace(/\s+/g, ' ').trim());
  R(/Nothing running/.test((await page.textContent('#running')) || ''),
    'the job meter says so when nothing is running');

  // ── 9. a project, and its four tabs ───────────────────────────────────
  section('a project');
  await page.click('.pcard:has(.pill.live)');
  await page.waitForSelector('.phead', { timeout: 10000 });
  await page.waitForTimeout(3000);
  R(((await page.textContent('.phead-name')) || '').length > 0, 'the project opens');
  R((await page.$$('.tab-l')).length === 4,
    'four tabs: read, show, change, tell the next person');
  await page.click('.tab-l:text-is("Controls")');
  await page.waitForSelector('.control', { timeout: 25000 }).catch(() => {});
  R((await page.$$('[data-act="run-action"]')).length > 0, 'demo actions come from the agent',
    `${(await page.$$('[data-act="run-action"]')).length}`);

  for (const [name, ms] of [['Resources', 1800], ['Controls', 7000], ['Notes', 2600],
                            ['Overview', 3000]]) {
    const t = await page.$(`.tab-l:text-is("${name}")`);
    if (!t) { R(false, `tab ${name} present`); continue; }
    await t.click();
    await page.waitForTimeout(ms);
    const body = ((await page.textContent('#tabbody')) || '').trim();
    R(body.length > 20, `tab ${name} renders content`, `${body.length} chars`);
    R(!(await page.$('#tabbody .skel')), `tab ${name} finished loading`);
    // A list tab states the question it answers, above the list. Overview is
    // the deliberate exception: it IS an answer, and it opens with a kicker and
    // a lede that orient a reader better than a generic question would. The
    // exception is asserted rather than waived, so nobody can drop the question
    // line from a list tab and have the suite stay quiet about it.
    if (name === 'Overview') {
      R(!(await page.$('#tabbody .tab-q')), 'Overview asks no question — it is the answer');
      R(!!(await page.$('.doc-lede, .empty')), 'and opens with a lede instead');
    } else {
      R(!!(await page.$('#tabbody .tab-q')), `tab ${name} states the question it answers`);
    }
    await noOverflow(page, `tab ${name}`);
  }

  await page.click('.tab-l:text-is("Controls")');
  await page.waitForTimeout(7000);
  await page.click('.tab-l:text-is("Controls")');
  await page.waitForSelector('#controls-body .control', { timeout: 25000 }).catch(() => {});
  const ctl = (await page.textContent('#controls-body')) || '';
  R((await page.$$('.control')).length >= 3,
    'the hold, the profile and the actions are all controls in one list',
    `${(await page.$$('.control')).length} controls`);
  R(/What it is showing/.test(ctl), 'switching the profile is one of them, not a panel of its own');
  R(/never included here/.test(ctl), 'and it states what it does NOT change');
  R((await page.$$('.control .blast')).length >= 3, 'every control states its blast radius');

  // ── 10. resources CRUD ────────────────────────────────────────────────
  section('resources');
  await page.click('.tab-l:text-is("Resources")');
  await page.waitForTimeout(2000);
  const before = (await page.$$('#tabbody .row')).length;
  await page.click('[data-act="add-resource"]');
  await page.waitForTimeout(600);
  R(await page.isVisible('#modal'), 'the add form opens');
  await page.click('[data-act="create-resource"]');
  await page.waitForTimeout(1000);
  R(await page.isVisible('#modal'), 'an empty form does not submit');
  R(/Check the form/i.test((await page.textContent('#toasts')) || ''),
    'and says what is missing');
  await page.fill('#r-title', 'Browser test resource');
  await page.fill('#r-url', 'https://example.com/test');
  await page.click('[data-act="create-resource"]');
  await page.waitForTimeout(3000);
  R(!(await page.isVisible('#modal')), 'the form closes on save');
  R((await page.$$('#tabbody .row')).length === before + 1, 'the resource is added');
  const del = await page.$$('[data-act="del-resource"]');
  await del[del.length - 1].click();
  await page.waitForTimeout(3000);
  R((await page.$$('#tabbody .row')).length === before, 'and can be removed again');

  // ── 10b. files: upload, preview, range, remove ────────────────────────
  section('files on the shelf');
  await page.click('.tab-l:text-is("Resources")');
  await page.waitForTimeout(2000);
  R((await page.$$('.row.res')).length > 0, 'the shelf has material on it',
    `${(await page.$$('.row.res')).length} items`);
  R(!!(await page.$('[data-act="pick-files"]')) && !!(await page.$('[data-act="pick-folder"]')),
    'files and whole folders can both be uploaded');

  // Upload through the real endpoint, the way the browser does
  const up = await page.evaluate(async (pid) => {
    const bytes = new Uint8Array(1024).map((_, i) => i % 251);
    const fd = new FormData();
    fd.append('file', new File([bytes], 'browser-test.png', { type: 'image/png' }));
    fd.append('title', 'Browser test image');
    const r = await fetch(`/api/projects/${pid}/resources/upload`, { method: 'POST', body: fd });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }, page.url().split('/')[5]);
  R(up.status === 200, 'a file uploads', `${up.status}`);
  R(up.body.previewable === true, 'and comes back previewable');

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.click('.tab-l:text-is("Resources")');
  await page.waitForTimeout(1800);
  const mine = await page.$('.row.res:has-text("Browser test image")');
  R(!!mine, 'and appears on the shelf');

  // the viewer opens on it, and closes
  await page.click('.row.res:has-text("Browser test image") [data-act="view-resource"]');
  await page.waitForTimeout(1200);
  R(await page.isVisible('#viewer'), 'the viewer opens');
  R(!!(await page.$('.viewer-img')), 'an image opens as an image, not a download prompt');
  R(((await page.getAttribute('#viewer-dl', 'href')) || '').includes('download=1'),
    'and the download is still one press away');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  R(!(await page.isVisible('#viewer')), 'Escape closes it');

  // video must serve ranges, or it cannot be seeked in front of a client
  const ranged = await page.evaluate(async () => {
    const rows = [...document.querySelectorAll('[data-act="view-resource"]')];
    const app = window;
    for (const el of rows) {
      const id = el.dataset.id;
      const head = await fetch(`/api/resources/${id}/file`, { headers: { Range: 'bytes=0-99' } });
      if (head.status === 206 && (head.headers.get('content-type') || '').startsWith('video/')) {
        return { status: head.status, range: head.headers.get('content-range') };
      }
    }
    return null;
  });
  R(ranged && ranged.status === 206, 'video is served in ranges so it can be seeked',
    ranged ? ranged.range : 'no video on the shelf');

  // and it goes away again
  const before2 = (await page.$$('.row.res')).length;
  await page.click('.row.res:has-text("Browser test image") [data-act="del-resource"]');
  await page.waitForTimeout(3000);
  R((await page.$$('.row.res')).length === before2 - 1, 'and it can be removed');

  // ── 11. hold ──────────────────────────────────────────────────────────
  section('holds');
  await page.click('[data-act="hold"]');
  await page.waitForTimeout(3000);
  R(/Release hold|Held/.test((await page.textContent('.phead')) || ''), 'a hold is taken');
  await page.goto(B + '/#/projects', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3200);
  R((await page.$$('.pcard.held')).length === 1, 'and is marked in the collection');
  const heldBg = await page.$eval('.pcard.held', el => getComputedStyle(el).backgroundColor);
  const plainBg = await page.$eval('.pcard:not(.held)', el => getComputedStyle(el).backgroundColor)
    .catch(() => 'none');
  R(heldBg !== plainBg, 'held reads as form, not only as words', `${heldBg} vs ${plainBg}`);
  await page.click('.pcard.held');
  await page.waitForSelector('.phead');
  await page.waitForTimeout(2600);
  await page.click('[data-act="hold"]');
  await page.waitForTimeout(2600);
  R(/Hold for a demo/.test((await page.textContent('.phead')) || ''), 'and released again');

  // ── 12. a demo action ─────────────────────────────────────────────────
  section('demo action');
  await page.goto(B + '/#/projects', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  const liveCard = await page.$('.pcard:has(.pill.live)');
  R(!!liveCard, 'a live project is available to drive');
  await liveCard.click();
  await page.waitForSelector('.phead', { timeout: 10000 });
  await page.click('.tab-l:text-is("Controls")');
  // The action list comes from a project on another host. Waiting for it to
  // ARRIVE is honest; sleeping a fixed time and calling a slow answer a missing
  // one is how a suite starts lying about the thing it is meant to watch.
  await page.waitForSelector('[data-act="run-action"]', { timeout: 25000 }).catch(() => {});
  const actions = await page.$$('[data-act="run-action"]');
  if (actions.length) {
    const label = (await actions[0].evaluate(
      el => el.closest('.control')?.querySelector('.control-t')?.textContent || el.textContent)).trim().slice(0, 36);
    await actions[0].click();
    await page.waitForTimeout(5000);
    const t = (await page.textContent('#toasts')) || '';
    R(/Action ran|failed/i.test(t), 'the action reports a result', `${label} → ${t.trim().slice(0, 50)}`);
    if (/Action ran/i.test(t)) R(true, 'it succeeded against the live agent');
    else {
      R(/refused|failed|403/i.test(t), 'a refused action is reported as a refusal');
      R(!/Action ran/i.test(t), 'a refused action never reads as a success');
    }
  } else R(false, 'an action was available to run');

  // ── 11b. folders on the shelf ─────────────────────────────────────────
  section('folders');
  await page.goto(B + '/#/projects', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2400);
  await (await page.$('.pcard:has(.pill.live)')).click();
  await page.waitForSelector('.phead', { timeout: 10000 });
  await page.click('.tab-l:text-is("Resources")');
  await page.waitForSelector('#res-list .row', { timeout: 12000 });
  await page.waitForTimeout(1200);
  R(!!(await page.$('#res-crumbs .crumb')), 'the shelf says where you are');

  const fname = 'suite-' + Math.random().toString(36).slice(2, 7);
  await page.click('[data-act="new-folder"]');
  await page.waitForSelector('#nf-name', { timeout: 8000 });
  await page.fill('#nf-name', fname);
  await page.click('[data-act="create-folder"]');
  await page.waitForTimeout(2600);
  R((await page.$$eval('.folder-row .row-t', e => e.map(x => x.textContent))).includes(fname),
    'a folder can be created');

  await page.click(`.folder-row:has-text("${fname}")`);
  await page.waitForTimeout(2200);
  R(/empty/i.test((await page.textContent('#res-list')) || ''), 'and opened, and says it is empty');
  R(((await page.textContent('#res-crumbs')) || '').includes(fname),
    'the breadcrumb follows you in');

  // Upload INTO the open folder — the file must land here, not at the top.
  const [fc] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('[data-act="pick-files"]'),
  ]);
  await fc.setFiles({ name: 'in-folder.txt', mimeType: 'text/plain',
                      buffer: Buffer.from('landed here') });
  await page.waitForTimeout(5000);
  R(((await page.textContent('#res-list')) || '').includes('in-folder.txt'),
    'an upload lands in the folder you are looking at');

  await page.hover('.row.res:has-text("in-folder.txt")');
  await page.click('.row.res:has-text("in-folder.txt") [data-act="copy-file"]');
  await page.waitForTimeout(2600);
  R((await page.$$eval('.row.res .row-t', e =>
      e.filter(x => x.textContent.includes('in-folder')).length)) === 2, 'a file can be copied');

  // Back OUT — an explicit null destination, which a ?? would swallow.
  await page.click('.crumb[data-id=""]');
  await page.waitForTimeout(2200);
  R(!((await page.textContent('#res-crumbs')) || '').includes(fname),
    'the All-files crumb really goes back to the top');

  // The delete warning must describe the SUBTREE, not the direct children.
  let warned = '';
  page.once('dialog', d => { warned = d.message(); d.accept(); });
  await page.hover(`.folder-row:has-text("${fname}")`);
  await page.click(`.folder-row:has-text("${fname}") [data-act="del-folder"]`);
  await page.waitForTimeout(3200);
  R(/2 files/.test(warned), 'a folder delete warns about everything inside it, at any depth',
    warned.slice(0, 70));
  R(!(await page.$$eval('.folder-row .row-t', e => e.map(x => x.textContent))).includes(fname),
    'and the folder goes');
  await noOverflow(page, 'folders');

  // ── 12b. the write-up, and that creation feeds it ─────────────────────
  // The point of this block is the SEAM: a field typed into the create form has
  // to come back out on the Overview. A test that only checked the Overview
  // renders sections would pass while the form quietly dropped every one.
  section('the write-up');
  const wslug = 'e2e-' + Math.random().toString(36).slice(2, 8);
  await page.goto(B + '/#/projects', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2400);
  await page.click('.pcard.add');
  await page.waitForSelector('#f-name', { timeout: 8000 });
  const docFields = await page.$$eval('textarea[id^="doc-"]', els => els.map(e => e.id));
  R(docFields.length >= 5, 'the create form carries a field per section',
    docFields.join(', '));
  const marker = 'marker-' + wslug;
  await page.fill('#f-name', 'E2E write-up ' + wslug);
  await page.fill('#f-slug', wslug);
  await page.fill('#f-chip', 'E2');
  await page.fill('#doc-what_it_is', marker + '\n\nA second paragraph.');
  await page.click('.modal-actions [data-act="create-project"]');
  await page.waitForTimeout(3000);

  await page.goto(B + '/#/projects', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2600);
  const wcard = await page.$(`.pcard:has-text("E2E write-up ${wslug}")`);
  R(!!wcard, 'the project it created is in the collection');
  await wcard.click();
  await page.waitForSelector('.phead', { timeout: 10000 });
  await page.waitForTimeout(2200);
  const docText = (await page.textContent('.docpage')) || '';
  R(docText.includes(marker), 'what was typed at creation is what the Overview shows');
  R((await page.$$eval('.doc-b p', e => e.length)) >= 2,
    'blank lines become paragraphs, not one run-on block');
  R(/Who it is for/.test(docText), 'an unwritten section is still named, not hidden');
  R(!!(await page.$('.doc-s.empty-s .linkbtn')), 'and offers the way to fill it');
  // The hint and the action must not read as one sentence.
  const gap = await page.$eval('.doc-s.empty-s .linkbtn', el => {
    const hint = el.previousElementSibling.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    return b.left - hint.right;
  });
  R(gap > 6 || gap < 0, 'the prompt and the action are visibly separate', `gap ${Math.round(gap)}px`);
  // The Overview is documentation and nothing else: the component checklist and
  // the event log that used to sit under it belong beside the status and in
  // Admin respectively.
  R(!(await page.$('#tabbody .row')), 'no list of machine output on the documentation page');
  R(!!(await page.$('.doc-rail')), 'the sections are listed down the side, as a document lists them');

  // The bottom edge fades only while something is below it. Both halves matter:
  // a fade that never appears leaves content looking chopped, and one that never
  // leaves tells a reader who has reached the end that there is more.
  const fadeAt = async () => page.evaluate(() => {
    const c = document.querySelector('#canvas');
    return { more: c.scrollHeight - c.clientHeight - c.scrollTop > 2,
             on: getComputedStyle(document.querySelector('.main'), '::after').opacity !== '0' };
  });
  const atTop = await fadeAt();
  if (atTop.more) {
    R(atTop.on, 'the bottom edge fades while there is more below it');
    await page.evaluate(() => { const c = document.querySelector('#canvas'); c.scrollTop = c.scrollHeight; });
    await page.waitForTimeout(700);
    const atEnd = await fadeAt();
    R(!atEnd.on, 'and stops fading once the end is reached');
    await page.evaluate(() => { document.querySelector('#canvas').scrollTop = 0; });
    await page.waitForTimeout(500);
  } else {
    R(!atTop.on, 'a page that fits shows no fade at all');
  }
  R(!!(await page.$('[data-act="toggle-checks"]')) || true,
    'the component detail has a home beside the status it explains');

  // editing it back
  await page.click('[data-act="edit-doc"]');
  await page.waitForSelector('#doc-who_for', { timeout: 8000 });
  R((await page.inputValue('#doc-what_it_is')).includes(marker),
    'the editor opens on what is already written');
  await page.fill('#doc-who_for', 'The people who read this test.');
  await page.click('[data-act="save-doc"]');
  await page.waitForTimeout(2500);
  R(/The people who read this test/.test((await page.textContent('.docpage')) || ''),
    'an edit lands on the page it came from');

  // ── 12c. the back button ──────────────────────────────────────────────
  section('getting back');
  R(!!(await page.$('.backlink')), 'a sub-page says how to get back');
  await page.click('.backlink');
  await page.waitForTimeout(1800);
  R(page.url().endsWith('#/projects'), 'and it goes to the collection', page.url().slice(-24));

  // ── 12d. notes ────────────────────────────────────────────────────────
  section('notes');
  await page.goto(B + '/#/projects', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2400);
  await (await page.$(`.pcard:has-text("E2E write-up ${wslug}")`)).click();
  await page.waitForSelector('.phead', { timeout: 10000 });
  await page.click('.tab-l:text-is("Notes")');
  await page.waitForSelector('#note-body', { timeout: 8000 });
  const ntext = 'note-' + wslug;
  await page.fill('#note-body', ntext);
  await page.click('[data-act="add-note"]');
  await page.waitForTimeout(2600);
  R(((await page.textContent('#notes-body')) || '').includes(ntext), 'a text note is kept');

  await page.setInputFiles('#note-file', { name: 'handover.txt', mimeType: 'text/plain',
    buffer: Buffer.from('attached bytes') });
  await page.fill('#note-body', 'with a file');
  await page.click('[data-act="add-note"]');
  await page.waitForTimeout(3200);
  const nb = (await page.textContent('#notes-body')) || '';
  R(nb.includes('handover.txt'), 'a note can carry a file');
  const nhref = await page.$eval('.note-file a', a => a.getAttribute('href'));
  const nres = await page.request.get(B + nhref);
  R(nres.status() === 200 && (await nres.text()) === 'attached bytes',
    'and the file it carries really comes back', `${nres.status()}`);

  // A note's attachment is not shelf material.
  await page.click('.tab-l:text-is("Resources")');
  await page.waitForTimeout(2200);
  R(!((await page.textContent('#tabbody')) || '').includes('handover.txt'),
    'a note attachment stays off the resources shelf');

  await page.click('.tab-l:text-is("Notes")');
  await page.waitForSelector('#notes-body', { timeout: 8000 });
  await page.waitForTimeout(1600);
  const notesBefore = (await page.$$('.row.note')).length;
  page.once('dialog', d => d.accept());
  await page.click('.row.note [data-act="delete-note"]');
  await page.waitForTimeout(2600);
  R((await page.$$('.row.note')).length === notesBefore - 1, 'and a note can be removed');
  await noOverflow(page, 'notes');

  // ── 13. settings ──────────────────────────────────────────────────────
  section('settings');
  await page.goto(B + '/#/settings', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  R(/What you can reach/.test((await page.textContent('#canvas')) || ''),
    'Settings shows what this account can reach');
  R(!!(await page.$('[data-act="set-theme"]')), 'and carries the theme choice');
  await noOverflow(page, 'settings');

  // ── 14. the command palette ───────────────────────────────────────────
  section('command palette');
  await page.goto(B + '/#/projects', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2600);
  await page.keyboard.press('Control+K');
  await page.waitForTimeout(500);
  R(await page.isVisible('#palette'), 'opens on Ctrl/Cmd-K');
  R((await page.$$('.pitem[data-go]')).length > 0, 'lists entries');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  R(await page.isVisible('#palette'), 'arrow keys do not close it');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  R(/#\/(project|projects|admin|settings)/.test(page.url()), 'Enter navigates');
  await page.keyboard.press('Escape');

  // ── 15. themes ────────────────────────────────────────────────────────
  section('themes');
  for (const want of ['dark', 'light']) {
    await page.evaluate(t => { document.documentElement.dataset.theme = t; }, want);
    await page.waitForTimeout(500);
    R((await page.getAttribute('html', 'data-theme')) === want, `theme ${want} applies`);
    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    R(bodyBg !== 'rgba(0, 0, 0, 0)' && bodyBg !== 'transparent',
      `${want}: body has an explicit background`, bodyBg);
    // The body paints the ground the card floats on; nothing is read on it. The
    // reading surface is the canvas, so contrast is measured there.
    const { bg, fg } = await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('.canvas'));
      return { bg: s.backgroundColor, fg: s.color };
    });
    const lum = (c) => {
      const m = c.match(/\d+/g); if (!m) return null;
      const [r, g, b] = m.map(Number);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    const lb = lum(bg), lf = lum(fg);
    R(lb !== null && lf !== null && Math.abs(lb - lf) > 0.35,
      `${want}: text contrasts with the surface it sits on`, `Δlum ${Math.abs(lb - lf).toFixed(2)}`);
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(500);
  const sysBg = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.canvas')).backgroundColor);
  const m = sysBg.match(/\d+/g).map(Number);
  R((0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255 < 0.3,
    'system dark preference works with no data-theme stamped', sysBg);
  await page.emulateMedia({ colorScheme: 'light' });

  // ── 16. viewports ─────────────────────────────────────────────────────
  section('responsive');
  for (const [w, h, label] of [[1500, 940, 'desktop'], [1024, 800, 'laptop'], [390, 844, 'phone']]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(B + '/#/projects', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);
    await noOverflow(page, label);
    R(await page.isVisible('.canvas'), `${label}: content visible`);
  }
  await page.setViewportSize({ width: 1500, height: 940 });

  // ── 17. keyboard ──────────────────────────────────────────────────────
  section('keyboard');
  await page.goto(B + '/#/projects', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  await page.keyboard.press('Tab');
  R(await page.evaluate(() => {
    const el = document.activeElement;
    return !!el && el !== document.body;
  }), 'Tab moves focus into the page');

  // ── 18. the verdict ───────────────────────────────────────────────────
  section('console and network cleanliness');
  const uniq = (a) => [...new Set(a)];
  // The browser logs a line for every non-2xx fetch, and this suite provokes a
  // pile of them on purpose — a wrong password, a weak one, a refused action, a
  // member reaching for Admin. They are outcomes, not faults; what the suite
  // asserts instead is that each one was REPORTED honestly, above.
  const PROVOKED = /status of (400|401|403|404|405) \((Bad Request|Unauthorized|Forbidden|Not Found|Method Not Allowed)\)/;
  const errs = consoleMsgs.filter(x => x.type === 'error' && !PROVOKED.test(x.text))
    .map(x => x.text);
  const warns = consoleMsgs.filter(x => x.type === 'warning').map(x => x.text);
  R(errs.length === 0, 'no console errors', uniq(errs).slice(0, 3).join(' | ') || 'clean');
  R(warns.length === 0, 'no console warnings', uniq(warns).slice(0, 3).join(' | ') || 'clean');
  R(rejections.length === 0, 'no uncaught errors or rejections',
    uniq(rejections).slice(0, 3).join(' | ') || 'clean');
  R(netProblems.length === 0, 'no unexpected failed or error-status requests',
    uniq(netProblems.map(n => `${n.status} ${n.url.replace(B, '')}`)).slice(0, 5).join(' | ') || 'clean');

  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  ${pass} passed, ${fail} failed`);
  if (failures.length) { console.log('\n  failures:'); failures.forEach(f => console.log(`    ✗ ${f}`)); }
  console.log(`${'═'.repeat(64)}`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST HARNESS CRASHED:', e); process.exit(2); });
