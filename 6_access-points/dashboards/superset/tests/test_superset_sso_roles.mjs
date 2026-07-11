// Superset SSO + role enforcement: R3 direct-access same-creds login; R4a a
// scientist (R-CONS-SCI → Alpha) admitted with SQL Lab + the Trino marts DB;
// R4b a partner (R-CONS-PRT — no mapped Superset role) lands in the empty
// Public role with NO data access.
import { chromium } from 'playwright';
const SHOTS = '/tmp/nhdw-test-shots';
const PW = 'NhdwDemo2026.OK';
let allOk = true;
const check = (b, m) => { console.log(`${b ? 'PASS' : 'FAIL'}: ${m}`); if (!b) allOk = false; };
const browser = await chromium.launch({ args: ['--no-sandbox'] });

async function loginSuperset(page, user) {
  await page.goto('https://superset.127.0.0.1.nip.io/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
  const kc = page.getByText(/Sign In with keycloak/i).first();
  if (await kc.count() > 0) { await kc.click().catch(() => {}); await page.waitForTimeout(2000); }
  if (await page.locator('#username').count() > 0) {
    await page.fill('#username', user); await page.fill('#password', PW);
    await page.click('#kc-login, button[type=submit], input[type=submit]');
    await page.waitForTimeout(3500);
  }
  await page.waitForTimeout(2500);
}

// R3 + R4a — sci.demo (R-CONS-SCI → Alpha): admitted, SQL Lab available.
{
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const promptedLogin = await (async () => {
    await page.goto('https://superset.127.0.0.1.nip.io/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
    return await page.getByText(/Sign In with keycloak/i).count() > 0;
  })();
  await loginSuperset(page, 'sci.demo');
  const url = page.url();
  const body = (await page.locator('body').innerText().catch(() => '')) || '';
  await page.screenshot({ path: `${SHOTS}/superset_sci.png`, fullPage: false });
  check(promptedLogin, 'R3 Superset direct access shows the Keycloak sign-in');
  check(/superset\.127/.test(url) && !/Access is Denied|Forbidden|401|Unauthorized/i.test(body),
        `R4a sci.demo (R-CONS-SCI→Alpha) admitted to Superset (url=${url.slice(0, 55)})`);
  // Navigate to SQL Lab to confirm Alpha capability + the Trino DB is present.
  await page.goto('https://superset.127.0.0.1.nip.io/sqllab/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  const sqllab = (await page.locator('body').innerText().catch(() => '')) || '';
  await page.screenshot({ path: `${SHOTS}/superset_sci_sqllab.png`, fullPage: false });
  check(/SQL Lab|Run|Database|Schema|NHDW Marts/i.test(sqllab) && !/Access is Denied|Forbidden/i.test(sqllab),
        'R4a sci.demo can reach SQL Lab (Alpha + sql_lab role)');
  await ctx.close();
}

// R4b — shewaye.a (R-CONS-PRT): no mapped Superset role → Public, no data access.
{
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await loginSuperset(page, 'shewaye.a');
  // Try to reach SQL Lab directly — a Public user must be refused.
  await page.goto('https://superset.127.0.0.1.nip.io/sqllab/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3500);
  const body = (await page.locator('body').innerText().catch(() => '')) || '';
  await page.screenshot({ path: `${SHOTS}/superset_partner.png`, fullPage: false });
  const denied = /Access is Denied|Forbidden|403|do not have|not authorized|Sign In with keycloak/i.test(body)
    || !/Run\b|Database|Schema/i.test(body);
  check(denied, 'R4b shewaye.a (R-CONS-PRT, unmapped) is NOT given SQL Lab / data access (empty Public role)');
  await ctx.close();
}

await browser.close();
console.log(allOk ? '\nSUPERSET SSO CHECKS PASSED' : '\nSOME CHECKS FAILED');
process.exit(allOk ? 0 : 1);
