import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { CatalogGym, CATALOG_PAGE_SIZE, createCatalogIndex, catalogListItem, linkedCatalogGym } from '../src/shared/gym-catalog';

function fixtures(count=1237):CatalogGym[]{
  return Array.from({length:count},(_,i)=>({
    id:`stable-${i}`,name:`攀岩馆 ${i}`,brand:'测试品牌',city:`城市${String(i%13).padStart(2,'0')}`,
    province:`省份${i%4}`,district:`分区${i%5}`,aliases:[`旧馆名${i}`],address:`场馆地址 ${i}`,
    facilities:[...(i%2===0?['bouldering' as const]:[]),...(i%3===0?['lead' as const]:[]),...(i%7===0?['kilter' as const]:[])],
    summary:'完整来源说明不应进入列表桥接'.repeat(100),sourceName:'合成验证资料',sourceUrl:'https://example.com/source',
    sourceDate:'2026-10-20',checkedAt:'2026-10-21',sourceLicense:'test-only',verificationStatus:'source-listed',
    coordinates:{latitude:30,longitude:120,system:'gcj02'},sources:[{name:'原始资料',url:'https://example.com/original'}],
  }));
}

test('千馆索引按稳定编号查找，分页不漏重，未知城市与越界页安全返回',()=>{
  const gyms=fixtures(),index=createCatalogIndex(gyms),ids:string[]=[];
  assert.equal(index.get('stable-900')?.name,'攀岩馆 900');assert.equal(index.get({id:'stable-900'}),undefined);
  assert.equal(index.cities().reduce((sum,city)=>sum+city.count,0),gyms.length);
  for(let offset=0;offset<gyms.length;offset+=CATALOG_PAGE_SIZE){
    const page=index.page({},offset);assert.ok(page.items.length<=CATALOG_PAGE_SIZE);
    assert.equal(page.total,gyms.length);ids.push(...page.items.map(g=>g.id));
  }
  assert.equal(ids.length,gyms.length);assert.equal(new Set(ids).size,gyms.length);
  assert.equal(index.page({},99999).hasMore,false);assert.deepEqual(index.page({},99999).items,[]);
  assert.deepEqual(index.search({city:'未收录城市'}),[]);
  const cities=index.cities();cities[0].count=-1;assert.ok(index.cities()[0].count>0);
});

test('省份、区县和旧名称可搜索，设施与城市联合过滤，列表不携带完整来源',()=>{
  const gyms=fixtures(),index=createCatalogIndex(gyms);
  assert.deepEqual(index.search({query:' 旧馆名 1236 '}).map(g=>g.id),['stable-1236']);
  assert.ok(index.search({query:'省份1'}).every(g=>g.province==='省份1'));
  assert.ok(index.search({query:'分区3'}).every(g=>g.district==='分区3'));
  const options={city:'城市03',kind:'rope' as const},expected=gyms.filter(g=>g.city===options.city&&g.facilities.includes('lead'));
  assert.deepEqual(index.search(options).map(g=>g.id),expected.map(g=>g.id));
  const page=index.page(options);assert.equal(page.cities[0].count,expected.length);
  assert.deepEqual(Object.keys(catalogListItem(gyms[0])).sort(),['added','address','id','name','tags']);
  const renamed={...gyms[0],name:'资料更新后的门店名',city:'北京'};
  const personal={catalogId:gyms[0].id,name:'私人昵称',city:'北京市',notes:'我的私人备注',gradeSystem:'颜色'};
  assert.equal(linkedCatalogGym(renamed,[personal]),personal);
  assert.equal(linkedCatalogGym(renamed,[{name:renamed.name,city:'北京'}])?.city,'北京');
  assert.equal(linkedCatalogGym(renamed,[{name:renamed.name,city:'上海'}]),undefined);
});

async function directoryDevice(entries:CatalogGym[]){
  const output=await build({entryPoints:['src/miniprogram/pages/catalog/index.ts'],bundle:true,write:false,platform:'neutral',format:'cjs',
    target:'es2018',define:{PANJI_CLOUD_ENV:'""'},plugins:[{name:'synthetic-catalog',setup(builder){
      builder.onLoad({filter:/gym-catalog-data\.json$/},()=>({contents:JSON.stringify({updatedAt:'2026-10-21',entries}),loader:'json'}));
    }}]});
  const storage=new Map<string,unknown>(),payloadSizes:number[]=[];let page:any;
  vm.runInNewContext(output.outputFiles[0].text,{Page:(definition:any)=>{page=definition;},
    wx:{getStorageSync:(key:string)=>storage.get(key)||'',setStorageSync:(key:string,value:unknown)=>storage.set(key,value),removeStorageSync:(key:string)=>storage.delete(key)},
    console,setTimeout,clearTimeout,exports:{},module:{exports:{}}});
  page.data=structuredClone(page.data);
  page.setData=(patch:Record<string,unknown>)=>{
    payloadSizes.push(Buffer.byteLength(JSON.stringify(patch),'utf8'));
    for(const [path,value] of Object.entries(patch)){
      const parts=path.replace(/\[(\d+)\]/g,'.$1').split('.');let target=page.data;
      for(let i=0;i<parts.length-1;i++){
        if(target[parts[i]]===undefined)target[parts[i]]=/^\d+$/.test(parts[i+1])?[]:{};
        target=target[parts[i]];
      }
      target[parts[parts.length-1]]=structuredClone(value);
    }
  };
  page.onLoad({});return {page,payloadSizes};
}
const rows=(page:any)=>page.data.groups.flatMap((group:any)=>group.entries);

test('真实目录页千馆首屏限量，分批加载无漏重且每次桥接保留余量；筛选后重置',async()=>{
  const gyms=fixtures(),before=JSON.stringify(gyms),{page,payloadSizes}=await directoryDevice(gyms);
  assert.equal(page.data.found,gyms.length);assert.equal(page.data.shown,CATALOG_PAGE_SIZE);
  assert.equal(rows(page).length,CATALOG_PAGE_SIZE);assert.equal(page.data.hasMore,true);
  let loads=0;
  while(page.data.hasMore){page.onReachBottom();assert.ok(++loads<30);}
  assert.equal(rows(page).length,gyms.length);assert.equal(new Set(rows(page).map((g:any)=>g.id)).size,gyms.length);
  assert.ok(page.data.groups.every((group:any)=>group.total===gyms.filter(g=>g.city===group.city).length));
  assert.ok(Math.max(...payloadSizes)<128*1024,'单次列表更新应远低于微信 1 MB setData 限制');
  assert.ok(rows(page).every((g:any)=>!g.sourceUrl&&!g.summary&&!g.coordinates));
  page.filter({currentTarget:{dataset:{kind:'kilter'}}});
  const kilter=gyms.filter(g=>g.facilities.includes('kilter'));
  assert.equal(page.data.found,kilter.length);assert.equal(page.data.shown,CATALOG_PAGE_SIZE);
  page.search({detail:{value:'旧馆名1236'}});assert.equal(page.data.shown,0);
  page.reset();assert.equal(page.data.shown,CATALOG_PAGE_SIZE);assert.equal(page.data.query,'');
  const city=page.data.cities.findIndex((c:any)=>c.name==='城市03');page.city({detail:{value:city}});
  assert.ok(rows(page).every((g:any)=>gyms.find(source=>source.id===g.id)?.city==='城市03'));
  page.more();assert.equal(page.data.shown,page.data.found);assert.equal(page.data.groups[0].entries.length,page.data.found);
  page.reset();page.onLoad({});assert.equal(page.data.cityIndex,0);assert.equal(page.data.found,gyms.length,'清除筛选后重新进入不能恢复旧城市');
  assert.equal(JSON.stringify(gyms),before,'浏览、筛选和分页不能改写资料或私人训练');
});
