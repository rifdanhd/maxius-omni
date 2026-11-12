import { chromium } from 'playwright';
import fs from 'node:fs';

const cookie = fs.readFileSync('/tmp/cookie.txt', 'utf8').trim();
const browser = await chromium.launch();
const ctx = await browser.newContext();
const [name, ...rest] = cookie.split('=');
await ctx.addCookies([{ name: 'maxius_session', value: rest.join('='), domain: 'localhost', path: '/' }]);
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });

await page.goto('http://localhost:3000/settings/accounts', { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => logs.push(`[goto] ${e.message}`));
await page.waitForTimeout(5000);
logs.push('--- URL: ' + page.url());
logs.push('--- TITLE: ' + await page.title());
logs.push('--- BODY: ' + (await page.locator('body').innerText().catch(() => 'ERR')).slice(0, 2000));
fs.writeFileSync('/tmp/repro.log', logs.join('\n'));
console.log(logs.join('\n').slice(0, 6000));
await browser.close();
