import type { CatalogGym } from './gym-catalog';

export interface MergeDecision { from:string; into:string; reason:string }
export interface CatalogExclusion { city:string; address?:string; name:string; aliases?:string[]; ids?:string[]; sourceUrl:string }
export interface CatalogRecheck {
  id:string; sourceName:string; sourceUrl:string; sourceDate:string; checkedAt:string; reason:string;
  changes:Partial<Pick<CatalogGym,'name'|'brand'|'address'|'district'|'facilities'|'accessNote'|'verificationNote'|'aliases'>>;
}
const normalize=(s:string)=>s.toLowerCase().replace(/[\s（）()·,，、。\-—]/g,'');
const cityKey=(s:string)=>normalize(s).replace(/市$/,'');
const names=(g:{name:string;aliases?:string[]})=>[g.name,...(g.aliases||[])].map(normalize);
const addressKey=(g:{city:string;address:string})=>normalize(g.address).replace(new RegExp('^'+cityKey(g.city)+'市?'),'');
function sources(g:CatalogGym){return [{name:g.sourceName,url:g.sourceUrl,date:g.sourceDate,...(g.sourceLicense?{license:g.sourceLicense}:{})},...(g.sources||[])];}

/** Only reviewed identities or exact, specific same-city addresses can collapse. */
export function mergeCatalogSources(groups:readonly CatalogGym[][], decisions:MergeDecision[]=[], exclusions:CatalogExclusion[]=[]){
  const entries:CatalogGym[]=[],merged:MergeDecision[]=[],excluded:{id:string;reason:string}[]=[];
  const byId=new Map<string,CatalogGym>();
  const redirects=new Map(decisions.map(d=>[d.from,d]));
  for(const source of groups)for(const raw of source){
    const g=structuredClone(raw);
    if(!g.id||!g.name||!g.city||!g.address||!/^https:\/\//.test(g.sourceUrl))throw Error('岩馆缺少必要事实或来源：'+g.id);
    if(g.sourceDate&&!/^\d{4}-\d{2}-\d{2}$/.test(g.sourceDate))throw Error('来源日期格式错误：'+g.id);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(g.checkedAt))throw Error('获取日期格式错误：'+g.id);
    const closed=exclusions.find(x=>x.ids?x.ids.includes(g.id):cityKey(x.city)===cityKey(g.city)&&
      (!!x.address&&addressKey({city:x.city,address:x.address})===addressKey(g)||names(x).some(n=>n.length>4&&names(g).includes(n))));
    if(closed){excluded.push({id:g.id,reason:closed.sourceUrl});continue;}
    g.verificationStatus ||= 'source-listed';
    g.facilities=[...new Set(g.facilities)];
    const decision=redirects.get(g.id);
    let old=byId.get(decision?.into||g.id);
    if(decision&&!old)throw Error('归并目标不存在：'+decision.into);
    if(!old)old=entries.find(e=>cityKey(e.city)===cityKey(g.city)&&addressKey(g).length>=6&&/\d/.test(g.address)&&
      addressKey(e)===addressKey(g)&&names(e).some(n=>names(g).includes(n)));
    if(!old){entries.push(g);byId.set(g.id,g);continue;}
    if(cityKey(old.city)!==cityKey(g.city))throw Error('不能跨城市归并：'+g.id);
    if(old.id!==g.id)merged.push({from:g.id,into:old.id,reason:decision?.reason||'同城同名且精确地址相同'});
    const evidence=new Map([...sources(old),...sources(g)].map(s=>[s.url,s]));
    old.sources=[...evidence.values()];
    old.aliases=[...new Set([...(old.aliases||[]),g.name,...(g.aliases||[])])].filter(n=>n!==old.name);
    old.alternateIds=[...new Set([...(old.alternateIds||[]),g.id,...(g.alternateIds||[])])].filter(id=>id!==old.id);
    old.facilities=[...new Set([...old.facilities,...g.facilities])];
    old.province ||= g.province;old.district ||= g.district;
    old.accessNote ||= g.accessNote;
    const addresses=[old.address,...(old.alternateAddresses||[]),g.address,...(g.alternateAddresses||[])];
    // A reviewed address may add a street number to an earlier coarse location.
    if(g.address.length>old.address.length)old.address=g.address;
    old.alternateAddresses=[...new Set(addresses)].filter(a=>a!==old.address&&a.replace(/市$/,'')!==old.city.replace(/市$/,''));
    if(!old.coordinates&&g.coordinates)old.coordinates=g.coordinates;
    old.checkedAt=[old.checkedAt,g.checkedAt].sort().slice(-1)[0];
    old.verificationStatus=old.sources.length>1?'cross-checked':'source-listed';
    byId.set(g.id,old);
  }
  const used=new Set<string>();
  for(const g of entries)for(const id of[g.id,...(g.alternateIds||[])]){
    if(used.has(id))throw Error('岩馆编号或别名冲突：'+id);used.add(id);
  }
  return {entries,merged,excluded};
}

/** Explicit reviewed corrections win over string-length heuristics; identities never change. */
export function applyCatalogRechecks(entries:readonly CatalogGym[],reviews:readonly CatalogRecheck[]){
  const result=structuredClone(entries) as CatalogGym[];
  const allowed=new Set(['name','brand','address','district','facilities','accessNote','verificationNote','aliases']);
  const facilities=new Set(['bouldering','rope','lead','toprope','autobelay','kilter','tension','moon','speed','fitness']);
  for(const review of reviews){
    const gym=result.find(g=>g.id===review.id||g.alternateIds?.includes(review.id));
    if(!gym)throw Error('复核目标不存在：'+review.id);
    if(!review.reason?.trim()||!review.sourceName?.trim()||!/^https:\/\//.test(review.sourceUrl)||
      !/^\d{4}-\d{2}-\d{2}$/.test(review.checkedAt)||review.sourceDate&&!/^\d{4}-\d{2}-\d{2}$/.test(review.sourceDate))throw Error('复核缺少依据或日期错误：'+review.id);
    for(const [key,value]of Object.entries(review.changes)){
      if(!allowed.has(key))throw Error('复核不能修改身份或来源字段：'+key);
      if(key==='facilities'||key==='aliases'){
        if(!Array.isArray(value)||value.some(v=>typeof v!=='string'||!v.trim()||key==='facilities'&&!facilities.has(v)))throw Error('复核列表格式错误：'+key);
      }else if(typeof value!=='string'||!value.trim())throw Error('复核字段不能为空：'+key);
    }
    if(review.changes.address&&review.changes.address!==gym.address){
      gym.alternateAddresses=[...new Set([...(gym.alternateAddresses||[]),gym.address])].filter(a=>a!==review.changes.address&&a!==gym.city);
    }
    if(review.changes.name&&review.changes.name!==gym.name)gym.aliases=[...new Set([...(gym.aliases||[]),gym.name])];
    const {aliases,...changes}=review.changes;
    Object.assign(gym,structuredClone(changes));
    if(aliases)gym.aliases=[...new Set([...(gym.aliases||[]),...aliases])].filter(a=>a!==gym.name);
    if(review.changes.facilities)gym.facilities=[...new Set(review.changes.facilities)];
    const evidence=new Map([...sources(gym),{name:review.sourceName,url:review.sourceUrl,date:review.sourceDate}].map(s=>[s.url,s]));
    gym.sources=[...evidence.values()];
    gym.checkedAt=[gym.checkedAt,review.checkedAt].sort().slice(-1)[0];
    gym.verificationStatus=gym.sources.length>1?'cross-checked':'source-listed';
  }
  return result;
}
