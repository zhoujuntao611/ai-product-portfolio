import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCatalogSources, applyCatalogRechecks, CatalogRecheck } from '../src/shared/catalog-maintenance';
import type { CatalogGym } from '../src/shared/gym-catalog';
const gym=(id:string,address:string):CatalogGym=>({id,name:'同一品牌攀岩',brand:'品牌',city:'北京',address,facilities:[],summary:'',sourceName:'场馆官网',sourceUrl:'https://example.com/'+id,sourceDate:'',checkedAt:'2026-10-21'});
test('来源归并保持原编号和设施，只在有证据时合并；同品牌异址不合并',()=>{
  const old={...gym('stable','海淀区甲路1号'),facilities:['kilter' as const]};
  const branch=gym('branch','海淀区甲路2号');
  const newer={...gym('new','北京市海淀区甲路1号'),facilities:['bouldering' as const]};
  const result=mergeCatalogSources([[old,branch],[newer]]);
  assert.equal(result.entries.length,2);assert.equal(result.entries[0].id,'stable');
  assert.deepEqual(result.entries[0].facilities,['kilter','bouldering']);
  assert.equal(result.entries[0].sources!.length,2);assert.equal(result.entries[0].sourceDate,'');
  assert.deepEqual(result.entries[0].alternateIds,['new']);
  assert.equal(old.address,'海淀区甲路1号');assert.deepEqual(old.facilities,['kilter']);
});
test('相同城市名本身不当精确地址；关闭地址从旧来源也能排除',()=>{
  const a=gym('a','北京'),b=gym('b','北京'),c=gym('closed','海淀区甲路8号');
  const r=mergeCatalogSources([[a,b,c]],[],[{city:'北京市',name:'关闭馆',address:'北京市海淀区甲路8号',sourceUrl:'https://example.com/closed'}]);
  assert.deepEqual(r.entries.map(g=>g.id),['a','b']);assert.equal(r.excluded[0].id,'closed');
  const specific=mergeCatalogSources([[a,b]],[],[{ids:['a'],city:'北京',name:a.name,sourceUrl:'https://example.com/report'}]);
  assert.deepEqual(specific.entries.map(g=>g.id),['b']);
});
test('人工归并必须有现存同城目标，不接受跨城或缺来源条目',()=>{
  assert.throws(()=>mergeCatalogSources([[gym('a','北京甲路1号')]], [{from:'a',into:'missing',reason:'x'}]),/归并目标不存在/);
  assert.throws(()=>mergeCatalogSources([[gym('a','北京甲路1号')],[{...gym('b','上海甲路1号'),city:'上海'}]], [{from:'b',into:'a',reason:'x'}]),/跨城市/);
  assert.throws(()=>mergeCatalogSources([[{...gym('a','北京甲路1号'),sourceUrl:''}]]),/来源/);
});

test('有来源的人工复核优先采用准确短地址，保留编号、旧地址与原来源，设施可纠错',()=>{
  const original={...gym('stable','北京市海淀区甲路某某园区某某楼入口待确认'),facilities:['kilter' as const],alternateIds:['old-id']};
  const review:CatalogRecheck={id:'old-id',sourceName:'经营者分馆官网',sourceUrl:'https://example.com/official',sourceDate:'',checkedAt:'2026-10-21',reason:'官网确认门牌和设施',changes:{name:'正式门店名',address:'海淀区甲路1号',facilities:['bouldering'],verificationNote:'须预约'}};
  const result=applyCatalogRechecks([original],[review])[0];
  assert.equal(result.id,'stable');assert.deepEqual(result.alternateIds,['old-id']);
  assert.equal(result.address,'海淀区甲路1号');assert.ok(result.alternateAddresses!.includes(original.address));
  assert.deepEqual(result.facilities,['bouldering']);assert.equal(result.sourceUrl,original.sourceUrl);
  assert.ok(result.sources!.some(s=>s.url===review.sourceUrl&&s.date===''));
  assert.ok(result.aliases!.includes(original.name));assert.equal(result.verificationNote,'须预约');
  assert.equal(original.name,'同一品牌攀岩');assert.deepEqual(original.facilities,['kilter']);
  assert.deepEqual(applyCatalogRechecks([result],[review]),[result],'重复重建应保持一致');
});

test('复核缺少出处、错误设施、空地址或改动身份字段时拒绝替换快照',()=>{
  const valid:CatalogRecheck={id:'a',sourceName:'官网',sourceUrl:'https://example.com/venue',sourceDate:'',checkedAt:'2026-10-21',reason:'地址复核',changes:{address:'甲路1号'}};
  for(const patch of [{sourceUrl:''},{reason:''},{changes:{address:''}},{changes:{id:'other'}},{changes:{facilities:['made-up']}}]){
    assert.throws(()=>applyCatalogRechecks([gym('a','甲路2号')],[{...valid,...patch} as CatalogRecheck]));
  }
  assert.throws(()=>applyCatalogRechecks([], [valid]),/复核目标不存在/);
});
