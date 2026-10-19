/* Optional QA: npm install playwright; METRICPILOT_URL may override local URL. */
const { chromium } = require(process.env.METRICPILOT_PLAYWRIGHT || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const base = process.env.METRICPILOT_URL || 'http://127.0.0.1:8876';
const records = [], errors = [];
let browser;
async function step(name, action) {
  const started = performance.now();
  try { await action(); records.push({ name, status:'passed', elapsed_ms:Math.round(performance.now()-started) }); }
  catch (error) { records.push({ name, status:'failed', error:String(error) }); throw error; }
}
(async () => {
  browser = await chromium.launch({headless:true, ...(process.env.METRICPILOT_BROWSER ? {executablePath:process.env.METRICPILOT_BROWSER} : {})});
  const context = await browser.newContext({viewport:{width:1440,height:1050}, acceptDownloads:true});
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  await step('CSV-first landing; empty confirmations', async () => {
    await page.goto(base);
    await page.waitForFunction(() => typeof csrfToken === 'string' && csrfToken.length > 10);
    assert.equal(await page.locator('#dateFormat').inputValue(), '');
    assert.equal(await page.locator('#amountUnit').inputValue(), '');
    assert.equal(await page.locator('#currency').inputValue(), '');
    await page.screenshot({path:path.join(__dirname,'v2-import.png'),fullPage:true});
  });
  await step('Upload actual CSV; preview and mapping', async () => {
    await page.locator('#csvFile').setInputFiles(path.join(root,'tests/fixtures/hand-check-orders.csv'));
    await page.locator('#mappingFields select').first().waitFor();
    assert.equal(await page.locator('#map-gross_amount').inputValue(), 'gross_amount');
    assert.match(await page.locator('#previewCaption').innerText(), /9/);
    await page.selectOption('#dateFormat','iso');
    await page.selectOption('#amountUnit','major');
    await page.selectOption('#currency','CNY');
    await page.click('#checkImport');
    await page.waitForFunction(() => !document.querySelector('#commitImport').disabled);
    await page.screenshot({path:path.join(__dirname,'v2-check.png'),fullPage:true});
  });
  await step('Changing import decisions invalidates prior check', async () => {
    await page.selectOption('#amountUnit','minor');
    assert.equal(await page.locator('#commitImport').isDisabled(),true);
    await page.selectOption('#amountUnit','major');
    await page.click('#checkImport');
    await page.waitForFunction(() => !document.querySelector('#commitImport').disabled);
    await page.click('#commitImport');
    await page.locator('#analysisView').waitFor({state:'visible'});
    assert.equal(await page.locator('#start').inputValue(),'');
    assert.equal(await page.locator('#refundBasis').inputValue(),'');
  });
  await step('Confirm definitions; exact channel result', async () => {
    await page.fill('#start','2026-01-01');
    await page.fill('#end','2026-01-31');
    await page.fill('#question','比较各渠道净收入');
    await page.selectOption('#refundBasis','order_date');
    await page.selectOption('#cancelled','exclude');
    await page.fill('#cancelledValues','cancelled');
    await page.check('#confirmContract');
    const response = page.waitForResponse(r => r.url().endsWith('/api/run') && r.request().method()==='POST');
    await page.click('#submit');
    const run = await (await response).json();
    assert.equal(run.status,'completed');
    assert.equal(run.report.totals.net_cents,23000);
    assert.deepEqual(Object.fromEntries(run.report.rows.map(r=>[r.label,r.net_cents])),{organic:8000,paid:15000});
    await page.locator('#report').waitFor({state:'visible'});
    await page.evaluate(() => window.scrollTo(0,0));
    await page.screenshot({path:path.join(__dirname,'v2-report.png'),fullPage:true});
  });
  await step('Citation opens exact query and raw result', async () => {
    await page.locator('[data-cite="Q1"]').first().click();
    assert.equal(await page.locator('#evidence-Q1 .query-raw').evaluate(e=>e.open),true);
    assert.match(await page.locator('#evidence-Q1').innerText(),/2026-01-01/);
  });
  await step('Markdown and JSON downloads retain definitions and provenance', async () => {
    for (const [button, ext] of [['#exportMd','md'],['#exportJson','json']]) {
      const downloadEvent=page.waitForEvent('download');
      await page.click(button);
      const download=await downloadEvent;
      const filename=path.join(__dirname,'v2-export.'+ext);
      await download.saveAs(filename);
      const contents=fs.readFileSync(filename,'utf8');
      assert.match(contents,/source_hash/);
      assert.match(contents,/refund_basis/);
      assert.match(contents,/23000/);
      assert.match(contents,/source_rows/);
      assert.match(contents,/sql_params/);
    }
  });
  await step('Narrow-screen report stays within viewport', async () => {
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(() => window.scrollTo(0,0));
    await page.screenshot({path:path.join(__dirname,'v2-mobile.png'),fullPage:true});
    const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
    assert.ok(width.scroll<=width.client+1, JSON.stringify(width));
  });
  await step('Ambiguous denominator performs no query', async () => {
    await page.setViewportSize({width:1440,height:1050});
    await page.fill('#question','2026年1月退款率');
    await page.fill('#start',''); await page.fill('#end','');
    const response=page.waitForResponse(r=>r.url().endsWith('/api/run') && r.request().method()==='POST');
    await page.click('#submit');
    const run=await (await response).json();
    assert.equal(run.status,'needs_clarification'); assert.equal(run.queries.length,0);
    await page.locator('#clarificationState').waitFor({state:'visible'});
    await page.screenshot({path:path.join(__dirname,'v2-clarification.png'),fullPage:true});
  });
  await step('Refund-date event ratio displays over 100 percent correctly', async () => {
    await page.fill('#question','2026年2月退款订单占比');
    await page.selectOption('#refundBasis','refund_date');
    await page.check('#confirmContract');
    const response=page.waitForResponse(r=>r.url().endsWith('/api/run') && r.request().method()==='POST');
    await page.click('#submit');
    const run=await (await response).json();
    assert.equal(run.status,'completed');
    assert.equal(run.report.totals.refund_orders,4);
    assert.equal(run.report.totals.orders,3);
    assert.match(await page.locator('#report').innerText(),/133.33%/);
  });
  await step('Abnormal CSV is explained; no silent duplicate removal', async () => {
    await page.click('.nav-item[data-view="import"]');
    await page.locator('#csvFile').setInputFiles(path.join(root,'tests/fixtures/duplicate-orders.csv'));
    await page.waitForFunction(()=>document.querySelector('#previewCaption').textContent.includes('duplicate-orders.csv'));
    await page.selectOption('#dateFormat','iso'); await page.selectOption('#amountUnit','major'); await page.selectOption('#currency','CNY');
    await page.click('#checkImport');
    await page.waitForFunction(()=>document.querySelector('#checkIssues').textContent.includes('exact_duplicates'));
    assert.equal(await page.locator('#commitImport').isDisabled(),true);
  });
  await step('Missing optional fields remain unknown; original BOM hash preserved', async () => {
    const csv='\uFEFForder_id,order_date,gross_amount\nX1,2026-01-01,9.99\n';
    const buffer=Buffer.from(csv,'utf8');
    await page.locator('#csvFile').setInputFiles({name:'gross-only.csv',mimeType:'text/csv',buffer});
    await page.waitForFunction(()=>document.querySelector('#previewCaption').textContent.includes('gross-only.csv'));
    await page.selectOption('#dateFormat','iso'); await page.selectOption('#amountUnit','major'); await page.selectOption('#currency','CNY');
    await page.click('#checkImport');
    await page.waitForFunction(()=>!document.querySelector('#commitImport').disabled);
    const committed=page.waitForResponse(r=>r.url().endsWith('/api/import/commit'));
    await page.click('#commitImport');
    const dataset=await (await committed).json();
    assert.equal(dataset.source_hash,require('node:crypto').createHash('sha256').update(buffer).digest('hex'));
    assert.equal(await page.locator('[data-task="channel"]').isDisabled(),true);
    assert.equal(await page.locator('[data-task="refund"]').isDisabled(),true);
    await page.fill('#question','2026年1月毛收入');
    await page.selectOption('#refundBasis','order_date'); await page.selectOption('#cancelled','include'); await page.check('#confirmContract');
    const response=page.waitForResponse(r=>r.url().endsWith('/api/run') && r.request().method()==='POST');
    await page.click('#submit');
    const run=await (await response).json();
    assert.equal(run.report.totals.gross_cents,999);
    assert.equal(run.report.totals.net_cents,null);
    assert.equal(run.queries[0].raw_rows[0].refund_cents,null);
  });
  await step('No browser runtime errors', async () => assert.deepEqual(errors,[]));
})().catch(error => { console.error(String(error)); process.exitCode=1; }).finally(async () => {
  fs.writeFileSync(path.join(__dirname,'browser-qa-v2.json'),JSON.stringify({generated_at_utc:new Date().toISOString(),base,fixture:'tests/fixtures/hand-check-orders.csv',records,errors},null,2));
  if(browser) await browser.close();
  console.log(JSON.stringify(records));
});
