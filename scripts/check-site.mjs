import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'docs');
const output = path.join(root, 'verification/site-current');
const prefix = '/ai-product-portfolio/';
const types = {'.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'application/javascript',
  '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.json':'application/json'};
await fs.mkdir(output, {recursive:true});
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!pathname.startsWith(prefix)) throw new Error('Not a Pages path');
    let file = path.resolve(site, pathname.slice(prefix.length));
    if (file !== site && !file.startsWith(site + path.sep)) throw new Error('Outside site');
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const base = origin + prefix;
const report = {generatedAt:new Date().toISOString(), scope:'Local Pages files; no model calls or user data.', checks:[]};
let browser;
try {
  browser = await chromium.launch({headless:true,
    ...(process.env.QA_BROWSER_PATH ? {executablePath:process.env.QA_BROWSER_PATH} : {})});
  for (const pathname of ['', 'panji/']) {
    for (const width of [320, 390, 768, 1440]) {
      const page = await browser.newPage({viewport:{width, height:900}, reducedMotion:'reduce'});
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);});
      page.on('requestfailed', request => errors.push(`Request failed: ${request.url()}`));
      await page.route('**/*', route => {
        if (new URL(route.request().url()).origin === origin) return route.continue();
        errors.push('Unexpected external request: ' + route.request().url());
        return route.abort();
      });
      const response = await page.goto(base + pathname, {waitUntil:'networkidle'});
      assert.equal(response.status(), 200);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map(image => {
          image.loading = 'eager';
          return image.decode().catch(() => {});
        }));
      });
      const layout = await page.evaluate(() => ({
        width:innerWidth, scrollWidth:document.documentElement.scrollWidth,
        brokenImages:[...document.images].filter(i => !i.complete || !i.naturalWidth).map(i => i.getAttribute('src')),
        missingAnchors:[...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href'))
          .filter(h => h.length > 1 && !document.getElementById(decodeURIComponent(h.slice(1)))),
        failedFonts:[...document.fonts].filter(font => font.status === 'error').map(font => font.family),
      }));
      assert.ok(layout.scrollWidth <= width, `${pathname || '/'} overflows at ${width}`);
      assert.deepEqual(layout.brokenImages, []);
      assert.deepEqual(layout.missingAnchors, []);
      assert.deepEqual(layout.failedFonts, []);
      if (!pathname) {
        const projectIds = await page.locator('[data-case]').evaluateAll(nodes => nodes.map(n => n.dataset.case));
        assert.ok(projectIds.includes('supportflow') && projectIds.includes('metricpilot'));
        for (const id of projectIds) {
          const trigger = page.locator(`[data-case="${id}"]`);
          const details = trigger.locator('xpath=ancestor::details');
          if (await details.count()) await details.evaluate(node => {node.open = true;});
          await trigger.click();
          assert.equal(await page.locator('#case-dialog').evaluate(node => node.open), true);
          const dialogLinks = await page.locator('#case-dialog a').evaluateAll(nodes => nodes.map(n => n.getAttribute('href')));
          assert.ok(dialogLinks.some(url => url.includes(`/projects/${id}/docs/PRD.md`)));
          await page.keyboard.press('Escape');
          await page.waitForFunction(() => !document.body.classList.contains('modal-open'));
          assert.equal(await trigger.evaluate(node => document.activeElement === node), true);
          if (await details.count()) await details.evaluate(node => {node.open = false;});
        }
        for (const id of ['supportflow', 'metricpilot']) {
          const tabs = page.locator(`[data-workflow="${id}"] [role="tab"]`);
          await tabs.first().press('End');
          assert.equal(await tabs.last().getAttribute('aria-selected'), 'true');
          await tabs.last().press('Home');
          assert.equal(await tabs.first().getAttribute('aria-selected'), 'true');
        }
      }
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({path:path.join(output, `${pathname ? 'panji' : 'home'}-${width}.png`), fullPage:true});
      assert.deepEqual(errors, []);
      report.checks.push({page:pathname || '/', ...layout, passed:true});
      await page.close();
    }
  }
  const nojs = await browser.newPage({javaScriptEnabled:false, viewport:{width:390, height:844}});
  await nojs.goto(base);
  assert.equal(await nojs.locator('#panji').isVisible(), true);
  assert.equal(await nojs.locator('#panji .button.primary').getAttribute('href'), 'panji/');
  for (const project of ['supportflow', 'metricpilot']) {
    assert.ok((await nojs.locator(`[data-case="${project}"]`).getAttribute('href')).includes(`/projects/${project}/docs/PRD.md`));
  }
  report.checks.push({page:'/', javascript:false, passed:true});
  await nojs.close();
  const demo = await browser.newPage({viewport:{width:390, height:844}});
  const demoErrors = [];
  demo.on('pageerror', error => demoErrors.push(error.message));
  await demo.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await demo.goto(base + 'climbai/#knowledge', {waitUntil:'networkidle'});
  assert.equal(await demo.getByTestId('knowledge-count').innerText(), '30 条');
  await demo.getByTestId('knowledge-question').fill('第一次买攀岩鞋要看什么？');
  await demo.getByTestId('knowledge-submit').click();
  await demo.waitForFunction(() => document.querySelector('.answer-card')?.textContent.includes('K19'));
  assert.equal(await demo.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(demoErrors, []);
  report.checks.push({page:'climbai/#knowledge', mode:'local rules', passed:true});
  await demo.close();
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.stack || String(error);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
  console.log(`${report.checks.length} site checks completed; passed=${report.passed}. Report: verification/site-current/report.json`);
}
