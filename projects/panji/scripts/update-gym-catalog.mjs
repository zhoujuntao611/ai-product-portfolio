// Only public venue metadata. Never reads private accounts, user reviews or contacts.
import fs from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
const {mergeCatalogSources,applyCatalogRechecks}=await tsImport('../src/shared/catalog-maintenance.ts',import.meta.url);
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const cities={beijing:'北京',shanghai:'上海',shenzhen:'深圳',guangzhou:'广州',hangzhou:'杭州',chengdu:'成都',wuhan:'武汉',changsha:'长沙',zhuhai:'珠海'};
const provinces={'北京':'北京','上海':'上海','深圳':'广东','广州':'广东','珠海':'广东','东莞':'广东','杭州':'浙江','成都':'四川','武汉':'湖北','长沙':'湖南','重庆':'重庆','常州':'江苏'};
const known=new Set(['bouldering','lead','toprope','autobelay','kilter','tension','moon','speed','fitness']);
let banana=await read('infrastructure/gym-catalog-banana.json');
if(!process.argv.includes('--offline')){
  try{
    const responses=await Promise.all(['locations','schema'].map(p=>fetch('https://www.bananaclimbing.com/api/v1/'+p,{signal:AbortSignal.timeout(20000)})));
    if(responses.some(r=>!r.ok))throw Error('品牌资料暂不可用');
    const [body,schema]=await Promise.all(responses.map(r=>r.json()));
    const sourceDate=schema.info?.description?.match(/Data published at (\d{4}-\d{2}-\d{2})T/)?.[1];
    if(!body.success||!Array.isArray(body.data)||body.data.length<10||!sourceDate)throw Error('品牌资料格式改变');
    const entries=body.data.filter(g=>g.isClosed===false).map(g=>{
      if(!cities[g.city]||!g.name?.['zh-CN']||!g.address?.['zh-CN'])throw Error('缺少必要门店信息或城市映射');
      return{id:'banana-'+g.id,name:g.name['zh-CN'],city:cities[g.city],brand:'香蕉攀岩',address:g.address['zh-CN'],
        facilities:(g.facilities||[]).filter(x=>known.has(x)),summary:'',sourceName:'香蕉攀岩开放门店资料',
        sourceUrl:'https://www.bananaclimbing.com/api/v1/locations',sourceDate,checkedAt:day,verificationStatus:'source-listed'};
    });
    if(new Set(entries.map(g=>g.id)).size!==entries.length)throw Error('品牌编号重复');
    banana={updatedAt:day,entries};
    await fs.writeFile('infrastructure/gym-catalog-banana.json',JSON.stringify(banana,null,2)+'\n');
  }catch(e){console.warn('保留上次品牌快照：'+e.message);}
}
const sourceFiles=['infrastructure/gym-catalog-curated.json','infrastructure/gym-catalog-government.json','infrastructure/gym-catalog-partners.json','infrastructure/gym-catalog-osm.json','infrastructure/gym-catalog-extra-official.json','infrastructure/gym-catalog-regional.json','infrastructure/gym-catalog-supplement.json','infrastructure/gym-catalog-oct22-additions.json'];
const sourceData=await Promise.all(sourceFiles.map(read));
const groups=[banana.entries,...sourceData.map(d=>Array.isArray(d)?d:d.entries)].map(group=>group.map(g=>{
  const {verification,sourceNotes,sourceDateMeaning,additionalSources,...fields}=g;
  const sources=[...(g.sources||[]),...(additionalSources||[]).map(s=>({name:s.sourceName,url:s.sourceUrl,date:s.sourceDate}))];
  const schoolIds=['hylonomus-368dc625fc87de8a','hylonomus-9281f1aae725d7c8','hylonomus-4a686680452855b6','hylonomus-7fa4ace0b39c0466','hylonomus-ef623f3111cff053'];
  return {...fields,...(sources.length?{sources}:{}),province:g.province||provinces[g.city]||'',
    ...(schoolIds.includes(g.id)?{accessNote:'校内场馆，开放及预约规则待确认。'}:{}),
    verificationStatus:g.verificationStatus||verification||'source-listed'};
}));
const decisions=await read('infrastructure/gym-catalog-merges.json');
const exclusions=[...await read('infrastructure/gym-catalog-government-exclusions.json'),...await read('infrastructure/gym-catalog-review-exclusions.json'),...await read('infrastructure/gym-catalog-oct22-exclusions.json')];
const result=mergeCatalogSources(groups,decisions,exclusions);
const reviews=[...await read('infrastructure/gym-catalog-rechecks.json'),...await read('infrastructure/gym-catalog-oct22-rechecks.json')];
result.entries=applyCatalogRechecks(result.entries,reviews);
const sourceCounts=Object.fromEntries(['infrastructure/gym-catalog-banana.json',...sourceFiles].map((f,i)=>[f,groups[i].length]));
const meta={updatedAt:day,coverage:'partial',entries:result.entries,
  metadata:{sources:sourceCounts,merged:result.merged,excluded:result.excluded,rechecked:reviews.map(r=>({id:r.id,sourceUrl:r.sourceUrl,reason:r.reason})),
    attribution:'OSM-derived component: © OpenStreetMap contributors, ODbL 1.0; available separately via the app export.',
    osmExport:'infrastructure/gym-catalog-osm.json',note:'收录数量，不是全国总数；资料收录不等于逐家核实当前营业。'}};
const target='src/shared/gym-catalog-data.json';
await fs.writeFile(target+'.tmp',JSON.stringify(meta,null,2)+'\n');
await fs.rename(target+'.tmp',target);
console.log(`已收录 ${result.entries.length} 家岩馆，${new Set(result.entries.map(g=>g.city)).size} 个城市；归并 ${result.merged.length} 条，排除 ${result.excluded.length} 条。`);
