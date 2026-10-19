import {createRequire} from 'node:module';
import {writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const args=process.argv.slice(2);
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(option('--out',path.join(root,'verification','knowledge-browser-20261019')));
const url=option('--url','http://127.0.0.1:4189/climbai/#knowledge');
const require=createRequire(import.meta.url);
let playwright;
try {playwright=require(process.env.PLAYWRIGHT_MODULE||'playwright');}
catch {playwright=require('D:/Codex/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');}
const cases=[
 {q:'踩边 edging 和摩擦 smearing 有什么区别？',id:'K11'},
 {q:'旗式 flagging 是什么意思？',id:'K12'},
 {q:'抱石的 V 和 Font 等级能直接比较吗？',id:'K17'},
 {q:'第一次买攀岩鞋要看什么？',id:'K19'},
 {q:'在岩馆，等待位置与落地区域有什么要求？',id:'K21'},
 {q:'今天只有 30 分钟怎么办？',id:'K06'},
 {q:'训练结束后还能补交反馈吗？',id:'K25'},
 {q:'如何写 Python 脚本？',insufficient:true},
 {q:'为什么天空是蓝色？',insufficient:true},
 {q:'font 字体怎么改？',insufficient:true},
 {q:'painting 教程',insufficient:true},
 {q:'股票交易只有 30 分钟应该怎么安排？',insufficient:true},
 {q:'会议只有 30 分钟怎么安排？',insufficient:true},
 {q:'攀岩后手指疼痛该吃什么药？',id:'K09',insufficient:true},
];
mkdirSync(out,{recursive:true});
const report={generated_at_utc:new Date().toISOString(),frontend_url:url,model_calls:0,method:'Headless browser against the deployed static build; fixed developer-authored regression questions, not user or live-model quality evaluation.',results:[],errors:[],layout:[]};
const browser=await playwright.chromium.launch({headless:true,executablePath:process.env.QA_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(url,{waitUntil:'networkidle'});
 assert.equal(await page.getByTestId('knowledge-count').innerText(),'30 条');
 assert.equal(await page.locator('.quick-questions button').count(),6);
 for(const c of cases){
   await page.getByTestId('knowledge-question').fill(c.q);
   await page.getByTestId('knowledge-submit').click();
   await page.waitForFunction(q=>document.querySelector('.user-question p')?.textContent===q,c.q,{timeout:6000});
   const result={question:c.q,expected_id:c.id||null,expected_insufficient:!!c.insufficient,ids:await page.locator('.answer-card .source a,.answer-card .source strong').allTextContents(),pill:await page.locator('.answer-card .pill').innerText(),answer:await page.locator('.answer-text').innerText(),urls:await page.locator('.answer-card .source a').evaluateAll(els=>els.map(e=>e.href))};
   const ids=result.ids.map(s=>s.match(/^\[(K\d+)\]/)?.[1]);
   if(c.id) assert.ok(ids.includes(c.id),`${c.q}: expected ${c.id}, got ${ids}`);
   assert.equal(result.pill.includes('资料不足'),!!c.insufficient,`${c.q}: ${result.pill}`);
   if(!c.id&&c.insufficient) assert.equal(ids.length,0,`${c.q}: unrelated citations ${ids}`);
   if(c.id==='K09') assert.deepEqual(ids,['K09']);
   report.results.push({...result,passed:true});
 }
 await page.getByTestId('knowledge-question').fill(cases[0].q);
 await page.getByTestId('knowledge-submit').click();
 await page.waitForFunction(q=>document.querySelector('.user-question p')?.textContent===q,cases[0].q);
 assert.ok((await page.locator('.answer-card').innerText()).includes('来源核验：2026-10-15'));
 assert.ok((await page.locator('.answer-card').innerText()).includes('专业教练审核待完成'));
 for(const [width,height] of [[1440,1100],[390,844]]){
  await page.setViewportSize({width,height});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  assert.equal(overflow,false);
  await page.screenshot({path:path.join(out,`knowledge-${width}.png`),fullPage:true});
  report.layout.push({width,height,horizontal_overflow:overflow,passed:true});
 }
 assert.deepEqual(report.errors,[]);
 report.summary={passed:report.results.length,total:cases.length,layout_passed:report.layout.length};
} catch(error){report.failure=String(error);process.exitCode=1;}
finally {
 await browser.close();
 writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report.summary||{passed:report.results.length,total:cases.length,failure:report.failure}));
}
