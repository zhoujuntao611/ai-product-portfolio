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
  for (const pathname of ['', 'panji/', 'supportflow/', 'metricpilot/', 'climbai-notes/']) {
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
      assert.equal(await page.locator('h1').count(), 1);
      if (pathname) {
        const sections = ['background', 'actions', 'decisions', 'limits'];
        assert.deepEqual(await page.locator('.reading-section > h2').allTextContents(), ['背景', '动作', '关键决策', '局限']);
        for (const id of sections) {
          await page.locator(`.case-nav a[href="#${id}"]`).click();
          try {
            await page.waitForFunction(id => document.querySelector(`.case-nav a[href="#${id}"]`)?.getAttribute('aria-current') === 'location', id, {timeout:5000});
          } catch (error) {
            const positions = await page.evaluate(() => ({hash:location.hash, y:scrollY, viewport:innerHeight,
              nav:document.querySelector('.case-nav').getBoundingClientRect().bottom,
              sections:[...document.querySelectorAll('.reading-section')].map(n => ({id:n.id,top:n.getBoundingClientRect().top})),
              current:document.querySelector('.case-nav [aria-current]')?.getAttribute('href')}));
            throw new Error(`${pathname} at ${width}: ${id} did not become current: ${JSON.stringify(positions)}`, {cause:error});
          }
          const sectionTop = await page.locator(`#${id}`).evaluate(node => node.getBoundingClientRect().top);
          const navBottom = await page.locator('.case-nav').evaluate(node => node.getBoundingClientRect().bottom);
          assert.ok(sectionTop >= navBottom - 1, `${pathname}${id} heading is obscured`);
        }
      }
      if (!pathname) {
        // A project preview must appear within the first mobile viewport.
        const cover = await page.locator('#panji .project-cover').boundingBox();
        assert.ok(cover.y < 650, `First project too far down at ${width}`);
        for (const id of ['panji', 'supportflow', 'metricpilot']) {
          assert.equal(await page.locator(`#${id} .case-link`).getAttribute('href'), `${id}/`);
        }
      }
      if (pathname === 'panji/') {
        const summary = page.locator('.evidence-detail summary');
        await summary.focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('.evidence-detail').evaluate(n => n.open), true);
        assert.ok((await page.locator('.evidence-detail').innerText()).includes('174'));
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('.evidence-detail').evaluate(n => n.open), false);
      }
      await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
      await page.screenshot({path:path.join(output, `${pathname ? pathname.slice(0, -1) : 'home'}-${width}.png`), fullPage:true});
      if (!pathname) await page.screenshot({path:path.join(output, `home-${width}-top.png`)});
      assert.deepEqual(errors, []);
      report.checks.push({page:pathname || '/', ...layout, passed:true});
      await page.close();
    }
  }
  const nojs = await browser.newPage({javaScriptEnabled:false, viewport:{width:390, height:844}});
  for (const project of ['panji', 'supportflow', 'metricpilot', 'climbai-notes']) {
    await nojs.goto(base);
    await nojs.locator(project === 'climbai-notes' ? '.early-note a[href="climbai-notes/"]' : `#${project} .case-link`).click();
    await nojs.waitForURL(base + project + '/');
    assert.equal(await nojs.locator('h1').isVisible(), true);
    assert.ok(await nojs.locator(`a[href*="/projects/${project === 'climbai-notes' ? 'climbai' : project}/docs/PRD.md"]`).count());
    await nojs.locator('.case-nav a[href="#limits"]').click();
    await nojs.waitForURL(base + project + '/#limits');
    assert.equal(await nojs.locator('#limits-title').isVisible(), true);
    await nojs.getByRole('navigation').getByRole('link', {name:'全部项目'}).click();
    await nojs.waitForURL(base + '#work');
    assert.equal(await nojs.locator('#work').isVisible(), true);
    report.checks.push({page:project, javascript:false, navigation:'home → case → home', passed:true});
  }
  await nojs.close();
  const motion = await browser.newPage({viewport:{width:768, height:900}, reducedMotion:'no-preference'});
  await motion.goto(base + 'panji/', {waitUntil:'networkidle'});
  await motion.locator('.case-nav a[href="#limits"]').click();
  await motion.waitForFunction(() => document.querySelector('.case-nav a[href="#limits"]')?.getAttribute('aria-current') === 'location');
  await motion.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await motion.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
  report.checks.push({page:'panji/', mode:'smooth scroll and reduced motion', passed:true});
  await motion.close();
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
