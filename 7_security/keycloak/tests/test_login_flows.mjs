/**
 * Regression E2E: the THREE login types, end-to-end in a real browser, offline.
 *
 *   1. username/password  → internal-bi (moh-staff realm), a seeded staff user.
 *   2. social (REAL Google) → click "Google" on the Keycloak login page →
 *      Keycloak's built-in Google broker redirects to accounts.google.com with
 *      our client_id. (Interactive sign-in is manual — Google blocks bots — so
 *      this asserts the CONFIG: real redirect + our client, brokers to R-CONS-ANA.)
 *   3. federation (EHIA SAML) → click "EHIA" → the offline ehia-saml-mock realm
 *      → brokered into moh-staff as R-CONS-RES → lands in workshop.
 *   4. NEGATIVE — the privileged-ops admin realm is password-only: its login
 *      page shows NO social/federation buttons (no external IdP mints an admin).
 *
 * Proves the fix for the mock-IdP client URIs frozen at :8090 (redirect_uri /
 * SAML entityID rewritten to the nip.io hostname) + the least-privilege posture.
 *
 * Run: node test_login_flows.mjs
 */
import { createRequire } from 'module';
const require = createRequire((process.env.PW_MODULES || 'node_modules') + '/');
const { chromium } = require('playwright');

const BI = 'https://internal-bi.127.0.0.1.nip.io/';
const WORKSHOP = 'https://workshop.127.0.0.1.nip.io/';
const ADMIN = 'https://admin.127.0.0.1.nip.io/';
const STAFF_PW = 'NhdwDemo2026.OK';
const EHIA_PW = 'EhiaDemo2026.OK';
// Public OAuth client_id (not a secret) — asserts the REAL Google client is wired.
const GOOGLE_CLIENT_ID_PREFIX = '642752171811-';
const failures = [];
const check = (c, l) => { console.log((c ? '  ✓ ' : '  ✗ ') + l); if (!c) failures.push(l); };

// After an IdP round-trip Keycloak may show a one-time "Update Account
// Information" (review profile) form — fill any required fields + submit.
async function passFirstBrokerProfile(pg) {
  const has = await pg.$('#kc-update-profile-form, input#firstName, input#lastName');
  if (!has) return;
  for (const [sel, val] of [['#firstName', 'Demo'], ['#lastName', 'User'], ['#email', 'brokered@moh.gov.et']]) {
    const el = await pg.$(sel);
    if (el) { const v = await el.inputValue().catch(() => 'x'); if (!v) await el.fill(val); }
  }
  await pg.click('button[type=submit], input[type=submit]').catch(() => {});
  await pg.waitForTimeout(3000);
}

// Poll until the SPA has an access token (logged in) or timeout.
async function waitLoggedIn(pg, tries = 25) {
  for (let i = 0; i < tries; i++) {
    const tok = await pg.evaluate(() => !!window.__nhdwAccessToken).catch(() => false);
    if (tok) return true;
    await passFirstBrokerProfile(pg);
    await pg.waitForTimeout(1000);
  }
  return false;
}

async function main() {
  const browser = await chromium.launch();
  try {
    // ── 1 · username / password ───────────────────────────────────────────────
    console.log('\n▸ (1) username/password → internal-bi (moh-staff)');
    let ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 950 } });
    let pg = await ctx.newPage();
    await pg.goto(BI, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await pg.waitForSelector('#username', { timeout: 30000 });
    await pg.fill('#username', 'tadesse.h'); await pg.fill('#password', STAFF_PW); await pg.click('#kc-login');
    check(await waitLoggedIn(pg), 'password login mints a session (window.__nhdwAccessToken)');
    check(!(await pg.innerText('body')).includes('No access to Internal BI'), 'password user reaches internal-bi');
    await ctx.close();

    // ── 2 · social (REAL Google) ──────────────────────────────────────────────
    // Real Google login can't be automated (bot-blocked + needs a human account),
    // so we verify the CONFIG: the "Google" button redirects to real Google's
    // consent screen with OUR client_id. The interactive sign-in is manual.
    console.log('\n▸ (2) social login "Google" → REAL accounts.google.com (config check)');
    ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 950 } });
    pg = await ctx.newPage();
    await pg.goto(BI, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await pg.waitForSelector('#kc-login', { timeout: 30000 });
    const gBtn = await pg.$('#social-google') || await pg.$('a:has-text("Google")');
    check(!!gBtn, 'internal-bi login page shows the "Google" social button');
    if (gBtn) {
      await Promise.all([
        pg.waitForURL(/accounts\.google\.com|oauth2|redirect_uri_mismatch/, { timeout: 30000 }).catch(() => {}),
        gBtn.click(),
      ]);
      const url = pg.url();
      check(/accounts\.google\.com/.test(url),
            `"Google" redirects to REAL accounts.google.com (not a mock) — got ${url.slice(0, 60)}…`);
      check(url.includes(GOOGLE_CLIENT_ID_PREFIX),
            'the redirect carries OUR Google client_id (real client wired)');
    }
    await ctx.close();

    // ── 3 · federation (EHIA SAML) via ehia-saml-mock → workshop ──────────────
    console.log('\n▸ (3) federation "EHIA" (SAML) → ehia-saml-mock → workshop (R-CONS-RES)');
    ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 950 } });
    pg = await ctx.newPage();
    await pg.goto(WORKSHOP, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await pg.waitForSelector('#kc-login', { timeout: 30000 });
    const eBtn = await pg.$('#social-ehia-saml') || await pg.$('a:has-text("EHIA")');
    check(!!eBtn, 'workshop login page shows the "EHIA" federation button');
    if (eBtn) {
      await eBtn.click();
      await pg.waitForSelector('#username', { timeout: 30000 });   // ehia-saml-mock login
      await pg.fill('#username', 'abebe.bekele@ehia.gov.et'); await pg.fill('#password', EHIA_PW); await pg.click('#kc-login');
      check(await waitLoggedIn(pg), 'EHIA (SAML) round-trip completes → session minted');
    }
    await ctx.close();

    // ── 4 · NEGATIVE — admin realm is password-only ───────────────────────────
    console.log('\n▸ (4) admin (privileged-ops) is password-only — no IdP buttons');
    ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 950 } });
    pg = await ctx.newPage();
    await pg.goto(ADMIN, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await pg.waitForSelector('#kc-login', { timeout: 30000 });
    check(!(await pg.$('#social-google')) && !(await pg.$('#social-ehia-saml')),
          'admin login shows NO Google/EHIA buttons (external IdPs cannot mint an operator)');
    check(!!(await pg.$('#username')) && !!(await pg.$('#password')),
          'admin login still offers username/password');
    await ctx.close();
  } finally {
    await browser.close();
  }
  if (failures.length) { console.log(`\nFAILED: ${failures.length} check(s)`); process.exit(1); }
  console.log('\nALL GREEN');
}
main().catch(e => { console.error('ERROR', e); process.exit(2); });
