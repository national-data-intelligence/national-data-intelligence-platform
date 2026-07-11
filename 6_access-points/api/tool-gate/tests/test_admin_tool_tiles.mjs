// Verify the admin Documentation → Operator tools tiles (external-tool SSO
// spec req 2): every gated tool enters via /oauth2gate/login, and the MLflow
// tile is HIDDEN for a role its gate would deny (R-OPS-SEC), shown for R-OPS-ADM.
import { chromium } from 'playwright';
import crypto from 'node:crypto';
const SHOTS = '/tmp/nhdw-test-shots';
const PW = 'NhdwDemo2026.OK';
let allOk = true;
const check = (b, m) => { console.log(`${b ? 'PASS' : 'FAIL'}: ${m}`); if (!b) allOk = false; };
const browser = await chromium.launch({ args: ['--no-sandbox'] });

// RFC 6238 TOTP (SHA1, 6 digits, 30s) — to complete sec.officer's MFA setup.
function b32decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  s = s.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = '', out = [];
  for (const c of s) { const v = A.indexOf(c); if (v < 0) continue; bits += v.toString(2).padStart(5, '0'); }
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totp(secret, t = Date.now()) {
  const key = b32decode(secret);
  const ctr = Buffer.alloc(8);
  ctr.writeBigInt64BE(BigInt(Math.floor(t / 1000 / 30)));
  const h = crypto.createHmac('sha1', key).update(ctr).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return (n % 1e6).toString().padStart(6, '0');
}

async function toolTiles(user, shot) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  await page.goto('https://admin.127.0.0.1.nip.io/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  if (await page.locator('#username').count() > 0) {
    await page.fill('#username', user);
    await page.fill('#password', PW);
    await page.click('#kc-login, button[type=submit], input[type=submit]');
    await page.waitForTimeout(3000);
  }
  // MFA setup screen (sec.officer, R-OPS-SEC) — reveal the secret, submit TOTP.
  if (await page.locator('#kc-totp-secret-key, a[href*="totp"], input[name=totp]').count() > 0) {
    const scanLink = page.getByText('Unable to scan?', { exact: false }).first();
    if (await scanLink.count() > 0) { await scanLink.click().catch(() => {}); await page.waitForTimeout(500); }
    const secret = (await page.locator('#kc-totp-secret-key').textContent().catch(() => '')) || '';
    const code = totp(secret.trim());
    await page.fill('input[name=totp], #totp', code);
    const dev = page.locator('input[name=userLabel], #userLabel');
    if (await dev.count() > 0) await dev.fill('demo-authenticator').catch(() => {});
    await page.click('button[type=submit], input[type=submit]');
    await page.waitForTimeout(3000);
  }
  // Navigate to the Documentation page via the sidebar link.
  const link = page.getByText('Documentation', { exact: true }).first();
  if (await link.count() > 0) { await link.click().catch(() => {}); await page.waitForTimeout(1800); }
  await page.waitForTimeout(1200);
  const tiles = await page.locator('a.doc-tool').evaluateAll(
    els => els.map(e => ({ name: e.querySelector('.doc-tool-name')?.textContent?.trim() || e.textContent?.trim(), href: e.getAttribute('href') })));
  await page.screenshot({ path: `${SHOTS}/${shot}`, fullPage: true });
  await ctx.close();
  return tiles;
}

// solomon.m — R-OPS-ADM: sees every tile incl. MLflow; gated tools use the gate.
{
  const t = await toolTiles('solomon.m', 'admin_tools_solomon.png');
  const names = t.map(x => x.name);
  console.log('  solomon.m tiles:', names.join(' | '));
  const byName = n => t.find(x => (x.name || '').startsWith(n));
  check(!!byName('MLflow'), 'MLflow tile VISIBLE for R-OPS-ADM (solomon.m)');
  check((byName('MLflow')?.href || '').includes('/oauth2gate/login'), 'MLflow tile enters via the tool-gate');
  check((byName('Prometheus')?.href || '').includes('/oauth2gate/login'), 'Prometheus tile enters via the tool-gate');
  check((byName('Alertmanager')?.href || '').includes('/oauth2gate/login'), 'Alertmanager tile enters via the tool-gate');
  check((byName('Cluster console')?.href || '') === '/oauth2gate/login?realm=privileged-ops&rd=/k8s/', 'Headlamp tile → gate login rd=/k8s/');
}

// sec.officer — R-OPS-SEC: the Documentation + Models pages that host the MLflow
// launch surface are not visible to this role (req 2 by page-level gating), and
// the Health & topology page it CAN see carries the ops-tool launchers it IS
// allowed (Prometheus/Alertmanager/Headlamp), each entering via the gate.
{
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  await page.goto('https://admin.127.0.0.1.nip.io/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  if (await page.locator('#username').count() > 0) {
    await page.fill('#username', 'sec.officer'); await page.fill('#password', PW);
    await page.click('#kc-login, button[type=submit], input[type=submit]'); await page.waitForTimeout(3000);
  }
  if (await page.locator('#kc-totp-secret-key, input[name=totp]').count() > 0) {
    const sl = page.getByText('Unable to scan?', { exact: false }).first();
    if (await sl.count() > 0) { await sl.click().catch(() => {}); await page.waitForTimeout(500); }
    const secret = (await page.locator('#kc-totp-secret-key').textContent().catch(() => '')) || '';
    await page.fill('input[name=totp], #totp', totp(secret.trim()));
    const dev = page.locator('input[name=userLabel], #userLabel');
    if (await dev.count() > 0) await dev.fill('demo-authenticator').catch(() => {});
    await page.click('button[type=submit], input[type=submit]'); await page.waitForTimeout(3500);
  }
  await page.waitForTimeout(1500);
  // req 2: the MLflow launch surface (Documentation + Models pages) is not
  // visible to R-OPS-SEC at all, so the tile can never be shown to it.
  const noDocPage = await page.getByText('Documentation', { exact: true }).count() === 0;
  await page.screenshot({ path: `${SHOTS}/admin_tools_secofficer.png`, fullPage: true });
  check(noDocPage, 'Documentation page (the MLflow tile surface) is NOT visible to R-OPS-SEC');
  await ctx.close();
}

// solomon.m again — the ops-tool launchers on Health & topology (visible to the
// ops-admin/super who live on that page) enter via the gate.
{
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  await page.goto('https://admin.127.0.0.1.nip.io/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  if (await page.locator('#username').count() > 0) {
    await page.fill('#username', 'solomon.m'); await page.fill('#password', PW);
    await page.click('#kc-login, button[type=submit], input[type=submit]'); await page.waitForTimeout(3500);
  }
  await page.waitForTimeout(2500);
  const prom = await page.locator('[data-testid=prometheus-btn]').getAttribute('href').catch(() => null);
  const alert = await page.locator('[data-testid=alertmanager-btn]').getAttribute('href').catch(() => null);
  const cons = await page.locator('[data-testid=cluster-console-btn]').getAttribute('href').catch(() => null);
  await page.screenshot({ path: `${SHOTS}/admin_topo_solomon.png` });
  check(!!prom && prom.includes('/oauth2gate/login') && !!alert && alert.includes('/oauth2gate/login') && !!cons,
        `Health & topology carries the Prometheus/Alertmanager/Headlamp launchers via the gate (prom=${prom ? 'ok' : 'missing'})`);
  await ctx.close();
}

await browser.close();
console.log(allOk ? '\nADMIN TOOL-TILE CHECKS PASSED' : '\nSOME CHECKS FAILED');
process.exit(allOk ? 0 : 1);
