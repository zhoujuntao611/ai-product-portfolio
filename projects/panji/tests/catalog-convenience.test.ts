import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { emptyState, State, PRIVACY_VERSION } from '../src/shared/domain';
import type { CatalogGym } from '../src/shared/gym-catalog';

const entries:CatalogGym[]=Array.from({length:181},(_,i)=>({
  id:`catalog-${i}`,name:i<2?'同名分馆':`合成岩馆 ${i}`,brand:'合成品牌',city:i<2?'城市0':`城市${i%3}`,address:i===180?'城市0':`测试路 ${i} 号`,
  facilities:i%2===0?['bouldering','kilter']:['rope'],summary:'资料说明',sourceName:'合成来源',sourceUrl:'https://example.com/source',
  sourceDate:'2026-10-22',checkedAt:'2026-10-22',alternateIds:i===0?['former-catalog-0']:undefined,
}));
const paths={catalog:'src/miniprogram/pages/catalog/index.ts',picker:'src/miniprogram/pages/gym-picker/index.ts',
  detail:'src/miniprogram/pages/gym-detail/index.ts',editor:'src/miniprogram/pages/session-edit/index.ts'};
const bundles=Promise.all(Object.entries(paths).map(async([key,path])=>[key,(await build({entryPoints:[path],bundle:true,write:false,
  platform:'neutral',format:'cjs',target:'es2018',define:{PANJI_CLOUD_ENV:'"test-env"'},plugins:[{name:'synthetic-catalog',setup(builder){
    builder.onLoad({filter:/gym-catalog-data\.json$/},()=>({contents:JSON.stringify({updatedAt:'2026-10-22',entries}),loader:'json'}));
  }}],
})).outputFiles[0].text])).then(Object.fromEntries);

function state():State{
  const result=emptyState('device');result.consent.privacyVersion=PRIVACY_VERSION;
  result.gyms=entries.slice(0,126).map((entry,i)=>({_id:`gym-${i}`,ownerId:'device',createdAt:'2026-10-22',updatedAt:'2026-10-22',schemaVersion:1,
    catalogId:i===0?'former-catalog-0':entry.id,name:i===0?'私人昵称':entry.name,city:entry.city,gradeSystem:'私人颜色',notes:'我的备注',
    archivedAt:i===2?'2026-10-22':undefined}));
  return result;
}
async function device(initial=state()){
  const compiled=await bundles;
  const storage=new Map<string,any>([['panji.data.v1',structuredClone(initial)]]),navigation:string[]=[],back:number[]=[],modals:any[]=[],clipboard:string[]=[],payloadSizes:number[]=[];
  let accepted=true,cloudFailed=false;
  const wx={getStorageSync:(key:string)=>structuredClone(storage.get(key)??''),setStorageSync:(key:string,value:any)=>storage.set(key,structuredClone(value)),
    removeStorageSync:(key:string)=>storage.delete(key),navigateTo:({url}:any)=>navigation.push(url),navigateBack:({delta=1}:any={})=>back.push(delta),
    showToast:()=>{},showModal:async(options:any)=>{modals.push(options);return {confirm:accepted};},
    setClipboardData:async({data}:any)=>{clipboard.push(data);},cloud:{init:()=>{},callFunction:async()=>{
      if(cloudFailed)throw new Error('offline');return {result:{ok:true,data:{state:structuredClone(initial),capabilities:{}}}};
    }}};
  function page(kind:keyof typeof paths){let result:any;
    vm.runInNewContext(compiled[kind],{wx,Page:(definition:any)=>{result=definition;},console,exports:{},module:{exports:{}},setTimeout,clearTimeout});
    result.data=structuredClone(result.data);result.setData=(patch:Record<string,unknown>)=>{
      payloadSizes.push(Buffer.byteLength(JSON.stringify(patch),'utf8'));
      for(const [path,value] of Object.entries(patch)){
        const parts=path.replace(/\[(\d+)\]/g,'.$1').split('.');let target=result.data;
        for(let i=0;i<parts.length-1;i++){if(target[parts[i]]===undefined)target[parts[i]]=/^\d+$/.test(parts[i+1])?[]:{};target=target[parts[i]];}
        target[parts[parts.length-1]]=structuredClone(value);
      }
    };return result;
  }
  return {storage,navigation,back,modals,clipboard,payloadSizes,page,decline:()=>{accepted=false;},cloudFail:(value:boolean)=>{cloudFailed=value;}};
}
const event=(id:string)=>({currentTarget:{dataset:{id}}});
const mine={currentTarget:{dataset:{scope:'mine'}}};
const rows=(p:any)=>p.data.groups.flatMap((group:any)=>group.entries);

test('我的岩馆只含当前已加入且未归档馆；跨来源旧编号有效，分页无漏重且城市分组正确',async()=>{
  const d=await device(),p=d.page('catalog'),before=structuredClone(d.storage.get('panji.data.v1'));
  p.onLoad({});await p.onShow();p.scope(mine);
  assert.equal(p.data.found,125);assert.equal(p.data.mineCount,125);assert.equal(p.data.summary.total,125);
  assert.equal(p.data.shown,60);assert.equal(p.data.hasMore,true);
  while(p.data.hasMore)p.more();
  assert.equal(rows(p).length,125);assert.equal(new Set(rows(p).map((g:any)=>g.id)).size,125);
  assert.ok(rows(p).some((g:any)=>g.id==='catalog-0'));assert.ok(!rows(p).some((g:any)=>g.id==='catalog-2'));
  assert.ok(p.data.groups.every((group:any)=>group.total===group.entries.length));
  assert.ok(Math.max(...d.payloadSizes)<128*1024);assert.deepEqual(d.storage.get('panji.data.v1'),before);
});

test('我的筛选与城市、设施、搜索组合；清空搜索保留范围，重置解除全部筛选',async()=>{
  const d=await device(),p=d.page('catalog');p.onLoad({});await p.onShow();p.scope(mine);
  p.city({detail:{value:p.data.cities.findIndex((c:any)=>c.name==='城市0')}});
  p.filter({currentTarget:{dataset:{kind:'kilter'}}});p.search({detail:{value:'合成岩馆'}});
  const expected=entries.slice(0,126).filter(g=>g.city==='城市0'&&g.facilities.includes('kilter')&&g.name.startsWith('合成岩馆'));
  assert.equal(p.data.found,expected.length);assert.equal(p.data.shown,expected.length);assert.equal(p.data.hasMore,false);
  p.search({detail:{value:'不存在'}});assert.equal(p.data.found,0);p.clearSearch();
  assert.equal(p.data.mineOnly,true);assert.equal(p.data.kind,'kilter');assert.ok(p.data.cityIndex>0);assert.equal(p.data.found,21);
  p.reset();assert.equal(p.data.mineOnly,false);assert.equal(p.data.query,'');assert.equal(p.data.kind,'');assert.equal(p.data.cityIndex,0);assert.equal(p.data.found,181);
});

test('已加入卡片一键记训练不重写馆资料，明确选择只更换草稿岩馆并保留其他输入',async()=>{
  const d=await device();const draft={form:{sessionDate:'2026-10-20',gymId:'gym-1',durationMinutes:'85',trainingNotes:'尚未保存的安排',feeling:'好',perceivedEffort:'6'},version:0};
  d.storage.set('panji.draft.local.new',structuredClone(draft));const p=d.page('catalog');p.onLoad({});await p.onShow();
  const before=structuredClone(d.storage.get('panji.data.v1'));await p.choose(event('catalog-0'));
  assert.deepEqual(d.storage.get('panji.data.v1'),before);assert.equal(d.navigation[d.navigation.length-1],'/pages/session-edit/index');
  assert.equal(d.storage.get('panji.selectedGym'),'gym-0');assert.deepEqual(d.storage.get('panji.draft.local.new'),draft);
  const editor=d.page('editor');editor.onLoad({});await editor.onShow();
  assert.equal(editor.data.form.gymId,'gym-0');assert.equal(editor.data.form.trainingNotes,draft.form.trainingNotes);
  assert.equal(editor.data.form.sessionDate,draft.form.sessionDate);assert.equal(editor.data.form.durationMinutes,'85');
  assert.equal(d.storage.has('panji.selectedGym'),false);assert.deepEqual(d.storage.get('panji.data.v1'),before);
});

test('普通目录加馆后仍停留浏览；选馆模式直接返回，已归档馆可明确恢复且不覆盖私人备注',async()=>{
  const d=await device(),p=d.page('catalog');p.onLoad({});await p.onShow();await p.choose(event('catalog-150'));
  assert.equal(d.navigation.length,0);assert.equal(d.storage.get('panji.data.v1').gyms.length,127);
  await p.choose(event('catalog-2'));assert.equal(d.storage.get('panji.data.v1').gyms[2].archivedAt,undefined);
  assert.equal(d.storage.get('panji.data.v1').gyms[2].notes,'我的备注');assert.equal(d.navigation.length,0);
  const picker=d.page('picker');picker.onLoad({});await picker.onShow();const before=structuredClone(d.storage.get('panji.data.v1'));
  await picker.choose(event('catalog-1'));assert.equal(d.back[d.back.length-1],1);assert.equal(d.storage.get('panji.selectedGym'),'gym-1');
  assert.deepEqual(d.storage.get('panji.data.v1'),before);assert.equal(d.storage.get('panji.selectedGym')==='gym-0',false,'同城同名分馆需按稳定编号区分');
});

test('未授权时取消加馆或记训练不修改任何记录，也不留下选择',async()=>{
  const initial=state();initial.consent.privacyVersion='';const d=await device(initial),p=d.page('catalog');d.decline();p.onLoad({});await p.onShow();
  await p.choose(event('catalog-0'));await p.choose(event('catalog-150'));
  assert.deepEqual(d.storage.get('panji.data.v1'),initial);assert.equal(d.storage.has('panji.selectedGym'),false);assert.equal(d.navigation.length,0);assert.equal(d.modals.length,2);
});

test('云端断线明确标记我的岩馆未载入，公共名录仍能浏览，重试恢复后不混入其他记录位置',async()=>{
  const d=await device(),p=d.page('catalog');d.storage.set('panji.mode.v1','cloud');d.cloudFail(true);
  p.onLoad({});await p.onShow();assert.equal(p.data.found,181);assert.match(p.data.personalError,/未能载入/);
  p.scope(mine);assert.equal(p.data.found,0);assert.equal(p.data.mineCount,0);assert.ok(p.data.personalError);
  d.cloudFail(false);await p.retry();assert.equal(p.data.personalError,'');assert.equal(p.data.found,125);
  assert.equal(d.storage.get('panji.data.v1').revision,0);
});

test('详情复制可用地址包含城市，纯城市不提供复制；已加入馆操作不重复写入',async()=>{
  const d=await device(),detail=d.page('detail');detail.onLoad({id:'catalog-0'});await detail.onShow();
  assert.equal(detail.data.hasAddress,true);await detail.copyAddress();assert.deepEqual(d.clipboard,['城市0 测试路 0 号']);
  const before=structuredClone(d.storage.get('panji.data.v1'));await detail.add();await detail.record();assert.deepEqual(d.storage.get('panji.data.v1'),before);
  assert.equal(d.storage.get('panji.selectedGym'),'gym-0');assert.equal(d.navigation[d.navigation.length-1],'/pages/session-edit/index');
  const unknown=d.page('detail');unknown.onLoad({id:'catalog-180'});assert.equal(unknown.data.hasAddress,false);await unknown.copyAddress();assert.equal(d.clipboard.length,1);
});
