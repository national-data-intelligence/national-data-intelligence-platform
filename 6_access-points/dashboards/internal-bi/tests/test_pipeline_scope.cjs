/**
 * Negative-path (OPA scoping) check for rm-pipeline (Group D procurement).
 * kebede.asfaw (R-RHB-OROMIA, geography:OR) must see ONLY Oromia's open POs;
 * tadesse.h (R-DEC) sees the national set. Logs in via the real PKCE flow, then
 * calls the widget data endpoint directly with the SPA's bearer token
 * (window.__nhdwAccessToken) so the assertion doesn't depend on page nav.
 *
 * Run: NODE_PATH=<gstack>/node_modules node tests/test_pipeline_scope.cjs
 */
const { chromium } = require('playwright');
const BI = 'https://internal-bi.127.0.0.1.nip.io/';
const PW = 'NhdwDemo2026.OK';
const OR_OPEN_POS = 8;         // bi_supply.mart_supply_pipeline WHERE region_id='OR'
const NATIONAL_OPEN_POS = 54;
const failures = [];
const check = (c, l) => { console.log((c ? '  ✓ ' : '  ✗ ') + l); if (!c) failures.push(l); };

async function pipelineRowCount(user) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 1000 } });
  const pg = await ctx.newPage();
  await pg.goto(BI, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await pg.waitForSelector('#username', { timeout: 30000 });
  await pg.fill('#username', user); await pg.fill('#password', PW);
  await pg.click('#kc-login');
  await pg.waitForFunction(() => !document.querySelector('#username') && !!window.__nhdwAccessToken, { timeout: 60000 });
  const res = await pg.evaluate(async () => {
    // The SPA proxies /api/{path} → /gw/{path} (→ nhdw-gateway/api/{path}).
    const r = await fetch('/gw/permissions/widget/rm-pipeline/data?dashboard_id=internal-bi&page_id=' +
      encodeURIComponent('internal-bi/resource'), {
      headers: { Authorization: 'Bearer ' + window.__nhdwAccessToken },
    });
    const body = r.ok ? await r.json() : null;
    const reason = r.ok ? '' : await r.text().catch(() => '');
    const d = body && body.data ? body.data : null;
    return { status: r.status, count: d ? (d.row_count ?? (d.rows || []).length) : null,
             rowFilter: body && body.opa ? JSON.stringify(body.opa.row_filter) : '', reason };
  });
  await browser.close();
  return res;
}

(async () => {
  console.log('— kebede.asfaw (R-RHB-OROMIA, geography:OR) —');
  const k = await pipelineRowCount('kebede.asfaw');
  check(k.status === 200, `kebede rm-pipeline endpoint 200 (got ${k.status}) reason=${k.reason||""}`);
  check(k.count === OR_OPEN_POS, `kebede sees ONLY Oromia open POs (${k.count} === ${OR_OPEN_POS}) row_filter=${k.rowFilter}`);
  check(k.count !== null && k.count < NATIONAL_OPEN_POS, `kebede is SCOPED, not national (${k.count} < ${NATIONAL_OPEN_POS})`);

  console.log('— tadesse.h (R-DEC, national) —');
  const t = await pipelineRowCount('tadesse.h');
  check(t.status === 200, `tadesse rm-pipeline endpoint 200 (got ${t.status}) reason=${t.reason||""}`);
  check(t.count === NATIONAL_OPEN_POS, `tadesse sees the national set (${t.count} === ${NATIONAL_OPEN_POS})`);

  if (failures.length) { console.log(`\nFAILED: ${failures.length}`); process.exit(1); }
  console.log('\nALL GREEN'); process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
