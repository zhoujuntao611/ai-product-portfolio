import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { buildSync } from 'esbuild';

test('平台隐私确认只由实际同意事件放行；拒绝及离开页面结束等待', () => {
  let definition:any, listener:any, installations=0;
  const wx={onNeedPrivacyAuthorization:(fn:any)=>{listener=fn;installations++;},getPrivacySetting:({success}:any)=>success({privacyContractName:'《已审核指引》'})};
  const code=buildSync({entryPoints:['src/miniprogram/components/privacy-consent/index.ts'],bundle:true,write:false,platform:'neutral',format:'cjs'}).outputFiles[0].text;
  vm.runInNewContext(code,{Component:(value:any)=>definition=value,wx,exports:{},module:{exports:{}}});
  const view=()=>({data:structuredClone(definition.data),setData(value:any){Object.assign(this.data,value);}});
  const first=view(),second=view();const decisions:any[]=[];
  definition.lifetimes.attached.call(first); listener((value:any)=>decisions.push(value));
  assert.equal(first.data.visible,true);assert.equal(first.data.contractName,'《已审核指引》');assert.equal(decisions.length,0);
  definition.methods.decline.call(first);assert.equal(decisions[0].event,'disagree');assert.equal(first.data.visible,false);
  listener((value:any)=>decisions.push(value));definition.methods.agree.call(first);
  assert.equal(decisions[1].event,'agree');assert.equal(decisions[1].buttonId,'panji-privacy-agree');
  listener((value:any)=>decisions.push(value));definition.pageLifetimes.hide.call(first);assert.equal(decisions[2].event,'disagree');
  definition.lifetimes.attached.call(second);assert.equal(installations,1);
  listener((value:any)=>decisions.push(value));definition.methods.agree.call(first);assert.equal(decisions.length,3);
  definition.methods.agree.call(second);assert.equal(decisions.length,4);
  definition.lifetimes.detached.call(second);definition.pageLifetimes.show.call(first);
  listener((value:any)=>decisions.push(value));assert.equal(first.data.visible,true);
});

test('微信原生隐私同意按钮绑定正确，两个视频入口均包含授权组件', () => {
  const markup=fs.readFileSync('src/miniprogram/components/privacy-consent/index.wxml','utf8');
  assert.match(markup,/id="panji-privacy-agree"[^>]*open-type="agreePrivacyAuthorization"[^>]*bindagreeprivacyauthorization="agree"/);
  for(const name of ['videos','session-detail']){
    const page=fs.readFileSync(`src/miniprogram/pages/${name}/index.wxml`,'utf8');assert.match(page,/<privacy-consent\s*\/>/);
    const config=JSON.parse(fs.readFileSync(`src/miniprogram/pages/${name}/index.json`,'utf8'));assert.equal(config.usingComponents['privacy-consent'],'/components/privacy-consent/index');
  }
});
