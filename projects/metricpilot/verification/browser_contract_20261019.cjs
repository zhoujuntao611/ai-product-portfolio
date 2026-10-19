const {chromium}=require(process.env.METRICPILOT_PLAYWRIGHT || 'playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const project=path.resolve(__dirname,'..');
const base=process.env.METRICPILOT_URL || 'http://127.0.0.1:18876';
const report={generated_at_utc:new Date().toISOString(),scope:'Local browser interactions with synthetic CSV; no external model or real user',checks:[],page_errors:[]};
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.METRICPILOT_BROWSER?{executablePath:process.env.METRICPILOT_BROWSER}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1050}});
 page.on('pageerror',e=>report.page_errors.push(e.message));
 async function check(name,fn){try{const evidence=await fn();report.checks.push({name,passed:true,evidence});}catch(e){report.checks.push({name,passed:false,error:e.message});throw e;}}
 async function ask(question){await page.fill('#question',question);await page.check('#confirmContract');const response=page.waitForResponse(r=>r.url()===base+'/api/run'&&r.request().method()==='POST');await page.click('#submit');return (await response).json();}
 try{
  await check('Upload, map, check and commit independent nine-order CSV',async()=>{
   await page.goto(base);await page.waitForFunction(()=>typeof csrfToken==='string'&&csrfToken.length>10);
   await page.locator('#csvFile').setInputFiles(path.join(project,'tests/fixtures/hand-check-orders.csv'));
   await page.locator('#mappingFields select').first().waitFor();
   await page.selectOption('#dateFormat','iso');await page.selectOption('#amountUnit','major');await page.selectOption('#currency','CNY');
   await page.click('#checkImport');await page.waitForFunction(()=>!document.querySelector('#commitImport').disabled);
   await page.click('#commitImport');await page.locator('#analysisView').waitFor({state:'visible'});
   await page.selectOption('#refundBasis','order_date');await page.selectOption('#cancelled','exclude');await page.fill('#cancelledValues','cancelled');
   return {fixture:'tests/fixtures/hand-check-orders.csv',rows:9};
  });
  await check('Question refund-date basis conflicts with confirmed order-date basis; no query',async()=>{
   const r=await ask('2026年2月按退款发生日统计退款金额');assert.equal(r.status,'needs_clarification');assert.equal(r.queries.length,0);return r;
  });
  await check('User explicitly changes basis; February refunds are exactly CNY120',async()=>{
   await page.selectOption('#refundBasis','refund_date');const r=await ask('2026年2月按退款发生日统计退款金额');assert.equal(r.status,'completed');assert.equal(r.report.totals.refund_cents,12000);return r;
  });
  await check('Quarter/month mixed comparison requires clarification; no partial query',async()=>{
   const r=await ask('2026年第一季度对比2026年2月净收入');assert.equal(r.status,'needs_clarification');assert.equal(r.queries.length,0);return r;
  });
  await check('Explicit unsupported net-revenue denominator requires clarification',async()=>{
   const r=await ask('2026年1月退款金额占净收入比例');assert.equal(r.status,'needs_clarification');assert.equal(r.queries.length,0);return r;
  });
  await check('Two named channels are not silently reduced to the last one',async()=>{
   const r=await ask('2026年1月比较organic和paid两个渠道净收入');assert.equal(r.status,'needs_clarification');assert.equal(r.queries.length,0);return r;
  });
  await check('Supported all-channel question remains correct after contract change',async()=>{
   await page.selectOption('#refundBasis','order_date');const r=await ask('2026年1月各渠道净收入');assert.equal(r.status,'completed');assert.equal(r.report.totals.net_cents,23000);assert.deepEqual(Object.fromEntries(r.report.rows.map(x=>[x.label,x.net_cents])),{organic:8000,paid:15000});return r;
  });
  await check('Denominator arithmetic is not accepted by matching its gross-revenue prefix',async()=>{
   const r=await ask('2026年1月退款金额占毛收入减退款金额后的比例');assert.equal(r.status,'needs_clarification');assert.equal(r.queries.length,0);return r;
  });
  await check('Standard denominator with a normal question ending stays supported',async()=>{
   const r=await ask('2026年1月退款金额占毛收入的比例是多少？');assert.equal(r.status,'completed');assert.ok(Math.abs(r.report.totals.refund_amount_rate-12/35)<1e-12);return r;
  });
  assert.deepEqual(report.page_errors,[]);report.passed=true;
 }catch(e){report.passed=false;report.error=e.stack;process.exitCode=1;}
 finally{fs.writeFileSync(path.join(project,'verification/browser-contract-20261019.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({passed:report.passed,checks:report.checks.map(({name,passed,error})=>({name,passed,error})),errors:report.page_errors}));}
})();
