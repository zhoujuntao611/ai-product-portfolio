/* Run against isolated_server.py. Requires Playwright Core and local Chrome. */
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = process.env.SUPPORTFLOW_BASE || 'http://127.0.0.1:8896';
const output = __dirname;
const report = {date:new Date().toISOString(),base,data:'Synthetic policies and tickets; disposable database and knowledge store',checks:[],page_errors:[]};
const checked = (label) => report.checks.push({check:label,passed:true});
async function run(){
 const browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page = await browser.newPage({viewport:{width:1440,height:1050},locale:'zh-CN'});
 page.on('pageerror',error=>report.page_errors.push(error.message));
 const wait = async(predicate) => page.waitForFunction(predicate,{},{timeout:12000});
 const clickNav = async(name) => page.locator(`[data-page="${name}"]`).click();
 async function generate(content,region='unknown'){
  await clickNav('desk');await page.locator('#content').fill(content);await page.locator('#region').selectOption(region);
  const response=page.waitForResponse(response=>response.url()===base+'/api/tickets'&&response.request().method()==='POST');
  await page.locator('#generate').click();const result=await (await response).json();
  await page.waitForFunction(id=>document.querySelector('#ticket-id').textContent==='#'+id,result.id);
  return result;
 }
 try{
  await page.goto(base);await wait(()=>document.querySelector('#count-knowledge').textContent==='9');
  assert.equal(await page.locator('#engine option[value=model]').isDisabled(),true);checked('Configured state: rule mode available and model without key disabled');
  let invoice=await generate('我们是管理员，邮箱 customer@example.com，请问在哪里申请发票，多久可以处理？');
  assert.equal(invoice.result.status,'ready');assert.ok(await page.locator('#quality-summary').textContent().then(text=>text.includes('原稿依据')));
  await page.locator('[data-tab=evidence]').click();assert.ok(await page.locator('#claims .claim-card').count()>0);assert.ok(await page.locator('#claims').textContent().then(text=>text.includes('v1.4')));
  await page.locator('#toast').evaluate(el=>el.hidden=true);await page.screenshot({path:path.join(output,'desktop-evidence.png'),fullPage:true});checked('Invoice draft, per-claim source/version/support and question coverage rendered');
  await page.locator('[data-tab=draft]').click();const original=await page.locator('#draft').inputValue();
  await page.locator('#draft').fill(original+'\n\n人工备注：请核对订单资料。');
  await page.locator('#review-reasons input[value=missing_condition]').check();await page.locator('#review-note').fill('补充条件，联系 reviewer@example.com');
  await page.locator('#save-draft').click();await wait(()=>document.querySelector('#toast').textContent.includes('编辑与问题标记已保存'));
  assert.ok((await page.locator('#draft').inputValue()).includes('人工备注'));assert.ok((await page.locator('#review-note').inputValue()).includes('[邮箱已隐藏]'));
  await page.locator('#escalate').click();await wait(()=>document.querySelector('#state-label').textContent==='已转人工');
  assert.ok(await page.locator('#audit').textContent().then(text=>text.includes('遗漏条件')));
  const exampleDownload=page.waitForEvent('download');await page.locator('#export-examples').click();const exampleFile=await exampleDownload;const exported=JSON.parse(await fs.readFile(await exampleFile.path(),'utf8'));
  const example=exported.examples.find(item=>item.id===invoice.id);assert.ok(example.current_draft.includes('人工备注'));assert.deepEqual(example.review_reasons,['missing_condition']);assert.ok(!JSON.stringify(example).includes('reviewer@example.com'));assert.ok(!JSON.stringify(example).includes('customer@example.com'));
  await page.locator('[data-tab=draft]').click();const markdownDownload=page.waitForEvent('download');await page.locator('#export-draft').click();const markdown=await fs.readFile(await (await markdownDownload).path(),'utf8');assert.ok(markdown.includes('## 来源')&&markdown.includes('v1.4'));
  checked('Save edits, escalation, review reasons and Markdown/JSON exports preserve history and mask test emails');
  await clickNav('knowledge');await page.locator('#import-json').fill('{"documents":[{"id":"MISSING-UI"}]}');await page.locator('#import-submit').click();await wait(()=>document.querySelector('#import-feedback').classList.contains('error'));assert.ok(await page.locator('#import-feedback').textContent().then(text=>text.includes('source')));checked('Missing metadata has an explicit field validation error');
  const sampleDownload=page.waitForEvent('download');await page.locator('#download-example').click();const sample=await sampleDownload;const samplePath=await sample.path();const sampleDoc=JSON.parse(await fs.readFile(samplePath,'utf8')).documents[0];
  await page.locator('#import-file').setInputFiles({name:'policy.json',mimeType:'application/json',buffer:await fs.readFile(samplePath)});await page.locator('#import-submit').click();await wait(()=>document.querySelector('#import-feedback').textContent.includes('已导入 1 份'));
  await page.locator('#knowledge-search').fill(sampleDoc.id);const card=page.locator('#knowledge-list .source-card').filter({hasText:sampleDoc.id});assert.equal(await card.count(),1);checked('Downloaded JSON sample imports through file picker and appears in the knowledge list');
  await card.getByRole('button',{name:'编辑新版本'}).click();await page.locator('#doc-version').fill('2.0');await page.locator('#doc-statements').fill('设备签收后 10 个自然日内，未激活且配件齐全的订单可申请退货；需由客服核验订单后提供寄回地址。\n寄回前请提供订单号与设备序列号。');await page.locator('#save-version').click();await wait(()=>document.querySelector('#knowledge-editor').hidden);assert.ok((await card.textContent()).includes('v2.0'));
  await card.getByRole('button',{name:'版本历史'}).click();await page.waitForSelector('#version-list .source-card');assert.equal(await page.locator('#version-list .source-card').count(),2);assert.ok((await page.locator('#version-list').textContent()).includes('v1.0'));await page.locator('#close-versions').click();
  await page.locator('#toast').evaluate(el=>el.hidden=true);await page.screenshot({path:path.join(output,'desktop-knowledge.png'),fullPage:true});checked('New version replaces current policy; both original and latest versions are inspectable');
  const custom=await generate('请问设备退货如何申请？');assert.equal(custom.result.status,'ready');assert.ok(custom.result.sources.some(source=>source.id===sampleDoc.id&&source.version==='2.0'));assert.ok(custom.result.draft.includes('10 个自然日'));checked('Imported current version is retrieved and cited in the generated reply');
  await clickNav('knowledge');await card.getByRole('button',{name:'停用资料'}).click();await wait(()=>document.querySelector('#knowledge-list').textContent.includes('已停用'));
  const deactivated=await generate('请问设备退货如何申请？');assert.equal(deactivated.result.can_approve,false);assert.ok(!deactivated.result.sources.some(source=>source.id===sampleDoc.id));checked('Deactivated policy is excluded from later drafts');
  await page.locator('#example').selectOption('refund');await generate('我购买了标准订阅，退款申请期限是多久？');assert.equal(await page.locator('#approve').isDisabled(),true);checked('Unknown refund region routes to clarification and cannot be approved');
  await page.locator('#toast').evaluate(el=>el.hidden=true);await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'mobile-desk.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await clickNav('knowledge');await page.screenshot({path:path.join(output,'mobile-knowledge.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));checked('390 px mobile workbench and knowledge screens fit viewport without horizontal scrolling');
  assert.deepEqual(report.page_errors,[]);checked('No browser JavaScript runtime errors');report.passed=true;
 }catch(error){report.passed=false;report.error=error.stack;await page.screenshot({path:path.join(output,'browser-failure.png'),fullPage:true});throw error;}
 finally{await fs.writeFile(path.join(output,'browser-report.json'),JSON.stringify(report,null,2));await browser.close();}
}
run().then(()=>console.log(JSON.stringify(report,null,2))).catch(error=>{console.error(error);process.exitCode=1;});
