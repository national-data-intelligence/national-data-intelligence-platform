// dz-forecast-backtest: per-region model trust from the federated
// registry×surveillance join (analyst, Disease page).
import { chromium } from 'playwright';
const SHOTS = '/tmp/nhdw-test-shots';
let allOk = true;
const check = (b, m) => { console.log(`${b ? 'PASS' : 'FAIL'}: ${m}`); if (!b) allOk = false; };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const cap = [];
ctx.on('response', async (r) => {
  if (r.url().includes('dz-forecast-backtest') && r.status() === 200) {
    try { cap.push(await r.json()); } catch {}
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
    const retry = page.locator('button, a').filter({ hasText: /try again/i }).first();
    if (!(await retry.count())) break;
    await retry.click();
    await page.waitForLoadState('networkidle', { timeout: 40000 }).catch(() => {});
  }
  await page.waitForTimeout(1500);
  await page.locator('nav, aside, [class*=side], [class*=nav]').getByText('Disease', { exact: false }).first().click();
  await page.waitForTimeout(3000);
  for (let y = 0; y < 8; y++) { await page.mouse.wheel(0, 1100); await page.waitForTimeout(350); }
  await page.waitForTimeout(4000);
  const rows = cap.flatMap(p => p?.data?.rows || []);
  check(rows.length >= 5, `backtest rows returned (${rows.length} regions)`);
  const tot = rows.reduce((a, r) => a + Number(r.hits) + Number(r.false_alarms) + Number(r.misses), 0);
  check(tot > 20, `alarm history is substantive (${tot} evaluated events)`);
  check(rows.some(r => Number(r.false_alarms) > 0) || rows.some(r => Number(r.misses) > 0),
    'backtest is honest (some false alarms or misses exist)');
  await page.screenshot({ path: `${SHOTS}/p3_backtest.png`, fullPage: false });
} catch (e) { console.log('FAIL: exception — ' + e.message); allOk = false; }
await browser.close();
console.log(allOk ? 'ALL OK' : 'SOME CHECKS FAILED');
process.exit(allOk ? 0 : 1);
