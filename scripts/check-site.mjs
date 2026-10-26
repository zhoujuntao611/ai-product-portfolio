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
  for (const pathname of ['', 'panji/', 'oriel/', 'supportflow/', 'metricpilot/']) {
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
        // Visitors see the product and its interface before optional development notes.
        const preview = await page.locator('.product-preview').boundingBox();
        const notes = await page.locator('#decisions').boundingBox();
        assert.ok(preview.y < notes.y);
        assert.ok(preview.y < 700, 'Product interface is reachable in the first viewport');
        assert.equal(await page.locator('.development-notes details[open]').count(), 0);
        assert.ok((await page.locator('.product-description').innerText()).length > 20);
        const sections = ['background', 'actions', 'decisions', 'limits'];
        assert.equal(await page.locator('.reading-section > h2').count(), 4);
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
        assert.equal(await page.locator('a[href="climbai/"],a[href="climbai-notes/"]').count(), 0);
        assert.deepEqual(await page.locator('.work-section article.project-entry').evaluateAll(nodes => nodes.map(node => node.id)),
          ['oriel', 'supportflow', 'metricpilot', 'panji'], 'The lead project and supporting cases have a clear order');
        assert.ok(await page.locator('.intro-actions a[href="profile/"]').isVisible());
        if (width === 1440) {
          const support = await page.locator('#supportflow').boundingBox();
          const metric = await page.locator('#metricpilot').boundingBox();
          assert.equal(support.y, metric.y, 'Secondary projects share a row');
        }
        for (const id of ['supportflow', 'metricpilot']) {
          const title = await page.locator(`#${id} .entry-heading`).boundingBox();
          const screen = await page.locator(`#${id} .project-cover`).boundingBox();
          assert.ok(title.y < screen.y, 'Project purpose appears before its screenshot');
        }
        // A project preview must appear within the first mobile viewport.
        const cover = await page.locator('#oriel .project-cover').boundingBox();
        assert.ok(cover.y < 700, `Lead project too far down at ${width}`);
        for (const id of ['panji', 'oriel', 'supportflow', 'metricpilot']) {
          assert.equal(await page.locator(`#${id} .case-link`).getAttribute('href'), `${id}/`);
          assert.equal(await page.locator(`#${id} .entry-facts > div`).count(), 3, 'Each project explains contribution, decision and evidence');
        }
      }
      if (pathname) {
        const summary = page.locator('.development-notes summary').first();
        await summary.focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('.development-notes details').first().evaluate(n => n.open), true);
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('.development-notes details').first().evaluate(n => n.open), false);
      }
      if (pathname && pathname !== 'panji/' && pathname !== 'oriel/') {
        const tabs = page.locator('.preview-tabs [role=tab]');
        await tabs.first().focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true');
        assert.equal(await page.locator('#preview-panel-1').isVisible(), true);
        await page.keyboard.press('End');
        assert.equal(await tabs.nth(2).getAttribute('aria-selected'), 'true');
        await page.keyboard.press('Home');
        assert.equal(await tabs.first().getAttribute('aria-selected'), 'true');
      }
      if (pathname && pathname !== 'oriel/') {
        const image = page.locator('.screen-gallery a,.preview-panel:not([hidden]) a').first();
        await image.focus();
        await page.keyboard.press('Enter');
        await page.locator('.image-viewer[open]').waitFor();
        assert.match(await page.locator('.image-viewer img').getAttribute('src'), /assets\//);
        await page.locator('.image-viewer img').evaluate(image => image.decode());
        await page.getByRole('button', {name:'原尺寸', exact:true}).click();
        const zoom = await page.locator('.image-viewer img').evaluate(image => ({
          width:image.getBoundingClientRect().width, natural:image.naturalWidth,
          scroll:image.parentElement.scrollWidth, viewport:image.parentElement.clientWidth,
        }));
        assert.ok(Math.abs(zoom.width - zoom.natural) < 1, 'Original screenshot size is readable');
        if (zoom.natural > zoom.viewport) assert.ok(zoom.scroll > zoom.viewport, 'Large screenshot can be panned');
        if (width === 390 && pathname === 'supportflow/') {
          await page.screenshot({path:path.join(output, 'supportflow-original-size-390.png')});
        }
        await page.getByRole('button', {name:'适应窗口', exact:true}).click();
        assert.ok(await page.locator('.image-viewer img').evaluate(image => image.getBoundingClientRect().width <= image.parentElement.clientWidth));
        await page.keyboard.press('Escape');
        await page.locator('.image-viewer').waitFor({state:'hidden'});
      }
      await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
      await page.screenshot({path:path.join(output, `${pathname ? pathname.slice(0, -1) : 'home'}-${width}.png`), fullPage:true});
      if (!pathname) await page.screenshot({path:path.join(output, `home-${width}-top.png`)});
      assert.deepEqual(errors, []);
      report.checks.push({page:pathname || '/', ...layout, passed:true});
      await page.close();
    }
  }
  const nojs = await browser.newPage({javaScriptEnabled:false, viewport:{width:390, height:844}, reducedMotion:'reduce'});
  for (const project of ['panji', 'oriel', 'supportflow', 'metricpilot']) {
    await nojs.goto(base);
    await nojs.locator(`#${project} .case-link`).click();
    await nojs.waitForURL(base + project + '/');
    assert.equal(await nojs.locator('h1').isVisible(), true);
    const documentLink = project === 'oriel' ? '/projects/oriel/README.md' : `/projects/${project}/docs/PRD.md`;
    assert.ok(await nojs.locator(`a[href*="${documentLink}"]`).count());
    if (project !== 'panji' && project !== 'oriel') assert.equal(await nojs.locator('.preview-panel:visible').count(), 3);
    await nojs.locator('.case-nav a[href="#limits"]').click();
    await nojs.waitForURL(base + project + '/#limits');
    assert.equal(await nojs.locator('#limits-title').isVisible(), true);
    await nojs.locator('.next-project a[href="../#work"]').click();
    await nojs.waitForURL(base + '#work');
    assert.equal(await nojs.locator('#work').isVisible(), true);
    report.checks.push({page:project, javascript:false, navigation:'home → case → home', passed:true});
  }
  await nojs.close();
  const profile = await browser.newPage({viewport:{width:320, height:900}});
  await profile.goto(base + 'profile/', {waitUntil:'networkidle'});
  await profile.evaluate(() => document.fonts.ready);
  assert.equal(await profile.locator('h1').count(), 1);
  assert.equal(await profile.locator('.profile-project').count(), 4);
  assert.equal(await profile.locator('#print-profile').isVisible(), true);
  assert.ok(await profile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  // The button must invoke printing, rather than merely being visible.
  await profile.evaluate(() => { window.print = () => { window.profilePrintRequested = true; }; });
  await profile.locator('#print-profile').click();
  await profile.waitForFunction(() => window.profilePrintRequested === true);
  await profile.screenshot({path:path.join(output, 'profile-320.png'),fullPage:true});
  const profileNoJs = await browser.newPage({javaScriptEnabled:false, viewport:{width:320,height:900}});
  await profileNoJs.goto(base + 'profile/');
  assert.equal(await profileNoJs.locator('#print-profile').isVisible(), false);
  assert.equal(await profileNoJs.locator('.profile-project a[href="../oriel/"]').first().isVisible(), true);
  await profileNoJs.close();
  await profile.close();
  report.checks.push({page:'profile/', mode:'mobile, print and no-JS navigation', passed:true});
  const motion = await browser.newPage({viewport:{width:768, height:900}, reducedMotion:'no-preference'});
  await motion.goto(base + 'panji/', {waitUntil:'networkidle'});
  await motion.locator('.case-nav a[href="#limits"]').click();
  await motion.waitForFunction(() => document.querySelector('.case-nav a[href="#limits"]')?.getAttribute('aria-current') === 'location');
  await motion.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await motion.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
  report.checks.push({page:'panji/', mode:'smooth scroll and reduced motion', passed:true});
  await motion.close();
  const retired = await browser.newPage();
  for (const slug of ['climbai/', 'climbai-notes/']) {
    await retired.goto(base + slug, {waitUntil:'networkidle'});
    assert.equal(retired.url(), base + slug, 'The historical project must not silently become a different project');
    assert.match(await retired.locator('h1').innerText(), /ClimbAI/);
    assert.ok(await retired.locator('a[href="../panji/"]').isVisible());
    assert.equal(await retired.locator('meta[http-equiv="refresh"]').count(), 0);
    report.checks.push({page:slug, mode:'historical project distinguished from Panji', passed:true});
  }
  await retired.close();
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
