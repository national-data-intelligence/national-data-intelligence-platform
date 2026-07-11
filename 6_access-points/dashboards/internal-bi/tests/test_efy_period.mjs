import { chromium } from 'playwright';
const SHOTS = '/tmp/nhdw-test-shots';
let allOk = true;
const check = (b, m) => { console.log(`${b ? 'PASS' : 'FAIL'}: ${m}`); if (!b) allOk = false; };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const cap = [];
ctx.on('response', async (r) => {
  if (r.url().includes('dz-malaria-kpi') && r.url().includes('/data') && r.status() === 200) {
    const u = new URL(r.url());
    try { cap.push({ period: u.searchParams.get('period'), rows: (await r.json())?.data?.rows || [] }); } catch {}
  }
});
const page = await ctx.newPage();
try {
  await page.goto('https://internal-bi.127.0.0.1.nip.io/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#username', { timeout: 20000 });
  await page.fill('#username', 'analyst.ana');
  await page.fill('#password', 'NhdwDemo2026.OK');
  await page.press('#password', 'Enter');
  await page.waitForLoadState('networkidle', { timeout: 40000 }).catch(() => {});
  for (let i = 0; i < 3; i++) {
    const r = page.locator('button, a').filter({ hasText: /try again/i }).first();
    if (!(await r.count())) break;
    await r.click();
    await page.waitForLoadState('networkidle', { timeout: 40000 }).catch(() => {});
  }
  await page.locator('nav, aside, [class*=side]').getByText('Disease', { exact: false }).first().click();
  await page.waitForTimeout(3500);
  const baseline = cap.filter(c => c.rows.length).slice(-1)[0];
  check(!!baseline && baseline.rows.length >= 12, `baseline series loaded (${baseline?.rows.length} months)`);

  // open the Period filter and pick "Ethiopian FY to date"
  await page.locator('[data-open="period"]').first().click();
  await page.waitForTimeout(900);
  const opt = page.locator('[data-key="period"].dd-item, .dd-item').filter({ hasText: /ethiopian fy/i }).first();
  check(await opt.count() > 0, 'Ethiopian FY option offered in the period filter');
  await opt.click();
  await page.waitForTimeout(1500);
  // the malaria widget is below the fold — scroll it into view so its deferred
  // period-reactive refetch fires
  for (let y = 0; y < 10; y++) { await page.mouse.wheel(0, 1100); await page.waitForTimeout(400); }
  await page.waitForTimeout(3500);
  console.log('captured periods: ' + JSON.stringify(cap.map(c => ({p: c.period, n: c.rows.length}))));
  const efy = cap.filter(c => c.period === 'efy_ytd').slice(-1)[0];
  check(!!efy, `efy_ytd request fired + returned 200 (${efy?.rows.length} months)`);
  if (efy && baseline) {
    check(efy.rows.length > 0 && efy.rows.length <= baseline.rows.length,
      `EFY window narrower-or-equal than 12mo (${efy.rows.length} <= ${baseline.rows.length})`);
    const months = efy.rows.map(r => r.month_id).sort();
    check(months[0] >= '2025-07' || /-(07|08|09|10|11|12)$/.test(months[0]),
      `EFY window starts at a July boundary (${months[0]})`);
  }
  await page.screenshot({ path: `${SHOTS}/p3_efy.png` });
} catch (e) { console.log('FAIL: exception — ' + e.message); allOk = false; }
await browser.close();
console.log(allOk ? 'ALL OK' : 'SOME CHECKS FAILED');
process.exit(allOk ? 0 : 1);
