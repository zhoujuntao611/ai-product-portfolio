/* Run against isolated_server.py; PLAYWRIGHT_CORE and CHROME_PATH may override. */
const {chromium}=require(process.env.PLAYWRIGHT_CORE || 'playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const base=process.env.SUPPORTFLOW_BASE || 'http://127.0.0.1:18875';
const report={generated_at_utc:new Date().toISOString(),scope:'Synthetic questions, disposable policy and ticket storage; browser interactions, no external model',checks:[],page_errors:[]};
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1050}});
 page.on('pageerror',e=>report.page_errors.push(e.message));
 async function check(name,fn){try{const evidence=await fn();report.checks.push({name,passed:true,evidence});}catch(e){report.checks.push({name,passed:false,error:e.message});throw e;}}
 async function generate(content,region='unknown'){
  await page.locator('[data-page=desk]').click();await page.fill('#title','审阅专项验收 '+Date.now());await page.fill('#content',content);await page.selectOption('#region',region);
  const response=page.waitForResponse(r=>r.url()===base+'/api/tickets'&&r.request().method()==='POST');await page.click('#generate');
  const r=await (await response).json();await page.waitForFunction(id=>document.querySelector('#ticket-id').textContent==='#'+id,r.id);return r;
 }
 try{
  await page.goto(base);await page.waitForFunction(()=>document.querySelector('#count-knowledge').textContent!=='—');
  await check('Common mainland-workspace wording resolves the supplied region',async()=>{
   const r=await generate('大陆工作区标准订阅退款的申请期限是多少天？');assert.equal(r.result.status,'ready');assert.equal(r.result.region,'mainland');assert.match(r.result.draft,/7/);return r;
  });
  await check('Explicit overseas selector conflicts with mainland wording; approval disabled',async()=>{
   const r=await generate('大陆工作区标准订阅退款的申请期限是多少天？','overseas');assert.equal(r.result.status,'needs_context');assert.equal(r.result.can_approve,false);assert.equal(await page.locator('#approve').isDisabled(),true);return r;
  });
  for(const [name,question,region] of [
   ['Refund receipt time cannot be answered by the application window','中国大陆标准订阅退款多久会到账？','mainland'],
   ['Refund approval time cannot be answered by the application window','中国大陆标准订阅退款审核要几天？','mainland'],
   ['Export completion time cannot be answered by file retention','导出任务多久能完成？','unknown'],
   ['Monthly API quota cannot be answered by a per-minute rate limit','API 频率限制为每月多少次？','unknown']
  ])await check(name,async()=>{const r=await generate(question,region);assert.equal(r.result.status,'needs_context');assert.equal(r.result.can_approve,false);assert.equal(await page.locator('#approve').isDisabled(),true);return r;});
  await check('Supported file-retention question remains answerable',async()=>{
   const r=await generate('导出文件保留多久？');assert.equal(r.result.status,'ready');assert.match(r.result.draft,/24/);return r;
  });
  for(const action of ['escalate','reject'])await check('Unsaved edits survive '+action+' and history reload',async()=>{
   const r=await generate('请问在哪里申请发票？');assert.equal(r.result.status,'ready');
   const marker='人工交接说明：请核对订单资料。'+action;
   await page.fill('#draft',(await page.locator('#draft').inputValue())+'\n'+marker);
   const response=page.waitForResponse(x=>x.url()===base+'/api/tickets/'+r.id+'/review');await page.click('#'+action);const reviewed=await (await response).json();
   assert.ok(reviewed.current_draft.includes(marker));
   await page.reload();await page.locator('#history .history-item').filter({hasText:r.title}).waitFor();await page.locator('#history .history-item').filter({hasText:r.title}).click();
   await page.waitForFunction(id=>document.querySelector('#ticket-id').textContent==='#'+id,r.id);
   assert.ok((await page.locator('#draft').inputValue()).includes(marker));return reviewed;
  });
  assert.deepEqual(report.page_errors,[]);report.passed=true;
 }catch(e){report.passed=false;report.error=e.stack;process.exitCode=1;}
 finally{fs.writeFileSync(path.join(__dirname,'browser-review-20261019.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({passed:report.passed,checks:report.checks.map(({name,passed,error})=>({name,passed,error})),errors:report.page_errors}));}
})();
