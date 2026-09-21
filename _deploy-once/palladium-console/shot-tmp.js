const { chromium } = require('playwright');
(async () => {
  const B = 'http://127.0.0.1:8099';
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1560, height: 900 }, colorScheme: 'light' });
  await p.goto(B, { waitUntil: 'networkidle' });
  await p.waitForSelector('#lg-id', { timeout: 15000 });
  await p.fill('#lg-id', 'saba'); await p.fill('#lg-pw', 'demo-console-2026');
  await p.click('[data-act="do-login"]');
  await p.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(3200);
  await p.screenshot({ path: '/out/veil.png' });
  await b.close();
})();
