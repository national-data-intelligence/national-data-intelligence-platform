import { chromium } from 'playwright';
const SHOTS = '/tmp/nhdw-test-shots';
let allOk = true;
const check = (b, m) => { console.log(`${b ? 'PASS' : 'FAIL'}: ${m}`); if (!b) allOk = false; };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const cap = [];
ctx.on('response', async (r) => {
  if (r.url().includes('dz-malaria-kpi') && r.status() === 200) {
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
    const r = page.locator('button, a').filter({ hasText: /try again/i }).first();
    if (!(await r.count())) break;
    await r.click();
    await page.waitForLoadState('networkidle', { timeout: 40000 }).catch(() => {});
  }
  await page.locator('nav, aside, [class*=side]').getByText('Disease', { exact: false }).first().click();
  await page.waitForTimeout(2500);
  for (let y = 0; y < 10; y++) { await page.mouse.wheel(0, 1100); await page.waitForTimeout(350); }
  await page.waitForTimeout(3500);
  const rows = cap.flatMap(p => p?.data?.rows || []);
  check(rows.length >= 12, `malaria KPI series (${rows.length} months)`);
  const hasKpis = rows.some(r => r.test_positivity_pct != null && r.itn_coverage_pct != null && r.confirmed != null);
  check(hasKpis, 'Table 7 KPIs present (TPR + ITN + confirmed)');
  const tpr = rows.map(r => Number(r.test_positivity_pct)).filter(n => !isNaN(n));
  check(Math.max(...tpr) <= 100 && Math.min(...tpr) >= 0, `TPR in range (${Math.min(...tpr)}–${Math.max(...tpr)}%)`);
  const t = await page.locator('body').innerText();
  check(/malaria/i.test(t), 'Malaria KPI section rendered');
  await page.screenshot({ path: `${SHOTS}/p3_malaria.png` });
} catch (e) { console.log('FAIL: exception — ' + e.message); allOk = false; }
await browser.close();
console.log(allOk ? 'ALL OK' : 'SOME CHECKS FAILED');
process.exit(allOk ? 0 : 1);
