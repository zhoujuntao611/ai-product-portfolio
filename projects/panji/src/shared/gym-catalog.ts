import data from './gym-catalog-data.json';
export type Facility = 'bouldering'|'rope'|'lead'|'toprope'|'autobelay'|'kilter'|'tension'|'moon'|'speed'|'fitness';
export interface CatalogGym {
  id: string; name: string; brand: string; city: string; address: string; facilities: Facility[];
  summary: string; sourceName: string; sourceUrl: string; sourceDate: string; checkedAt: string; accessNote?:string; verificationNote?:string;
  province?: string; district?: string; aliases?: string[]; alternateIds?:string[]; alternateAddresses?:string[]; sourceLicense?: string; sourceUpdatedAt?: string;
  verificationStatus?: 'source-listed'|'cross-checked'|'reported-closed';
  coordinates?: {latitude:number;longitude:number;system?:'wgs84'|'gcj02'|'bd09'};
  sources?: {name:string;url:string;date?:string;license?:string}[];
}
export const catalogUpdatedAt = data.updatedAt;
export const gymCatalog = data.entries as CatalogGym[];
export const facilityLabels: Record<Facility,string> = { bouldering:'抱石',rope:'难度',lead:'先锋',toprope:'顶绳',autobelay:'自保',kilter:'K 板',tension:'T 板',moon:'MoonBoard',speed:'速度',fitness:'体能区' };
export type CatalogFilter = ''|'bouldering'|'rope'|'kilter';
export function catalogTags(gym: CatalogGym): string[] { return gym.facilities.map(f=>facilityLabels[f]); }
export function hasFacility(gym: CatalogGym, kind: CatalogFilter): boolean {
  return !kind || (kind==='rope' ? gym.facilities.some(f=>['rope','lead','toprope','autobelay'].includes(f)) : gym.facilities.includes(kind));
}
const normalizeQuery=(value:string)=>value.trim().toLowerCase().replace(/\s+/g,'');
export interface CatalogSearch { query?:string; city?:string; kind?:CatalogFilter }
export const CATALOG_PAGE_SIZE=60;
export function createCatalogIndex(entries:readonly CatalogGym[]) {
  const byId=new Map(entries.map(g=>[g.id,g]));
  for(const gym of entries)for(const id of gym.alternateIds||[])byId.set(id,gym);
  const byCity=new Map<string,CatalogGym[]>();
  const searchable=new Map<string,string>();
  for(const gym of entries){
    const city=byCity.get(gym.city)||[];city.push(gym);byCity.set(gym.city,city);
    searchable.set(gym.id,normalizeQuery([gym.name,gym.brand,gym.province,gym.city,gym.district,gym.address,...(gym.alternateAddresses||[]),...(gym.aliases||[]),...catalogTags(gym)].join(' ')));
  }
  const cities=[...byCity].map(([name,gyms])=>({name,count:gyms.length})).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
  const cityOrder=new Map(cities.map((c,i)=>[c.name,i]));
  const sorted=[...entries].sort((a,b)=>(cityOrder.get(a.city)!-cityOrder.get(b.city)!));
  function search({query='',city='',kind=''}:CatalogSearch={}):CatalogGym[]{
    const q=normalizeQuery(query);
    const terms=query.trim().split(/\s+/).map(normalizeQuery).filter(Boolean);
    return (city?byCity.get(city)||[]:sorted).filter(g=>{
      const text=searchable.get(g.id)!;
      return hasFacility(g,kind)&&(!q||text.includes(q)||terms.length>1&&terms.every(term=>text.includes(term)));
    });
  }
  return {
    get:(id:unknown)=>typeof id==='string'?byId.get(id):undefined,
    cities:()=>cities.map(city=>({...city})),
    search,
    page(options:CatalogSearch={},offset=0){
      const matches=search(options);
      const start=Number.isFinite(offset)?Math.min(matches.length,Math.max(0,Math.floor(offset))):0;
      const items=matches.slice(start,start+CATALOG_PAGE_SIZE);
      const counts=new Map<string,number>();
      for(const gym of matches)counts.set(gym.city,(counts.get(gym.city)||0)+1);
      return {items,total:matches.length,start,end:Math.min(start+items.length,matches.length),hasMore:start+items.length<matches.length,
        cities:[...counts].map(([city,count])=>({city,count}))};
    },
  };
}
const catalogIndex=createCatalogIndex(gymCatalog);
export function catalogGym(id:unknown):CatalogGym|undefined{return catalogIndex.get(id);}
export function searchCatalog(query='',city='',kind:CatalogFilter=''):CatalogGym[]{return catalogIndex.search({query,city,kind});}
export function catalogCities():{name:string;count:number}[]{return catalogIndex.cities();}
export function catalogListItem(gym:CatalogGym,added=false){return {id:gym.id,name:gym.name,address:gym.address===gym.city?'街道地址待补充':gym.address,tags:catalogTags(gym),added};}
export function catalogSummary(entries:readonly CatalogGym[]=gymCatalog) {
  return { total:entries.length,cities:new Set(entries.map(g=>g.city)).size,bouldering:entries.filter(g=>hasFacility(g,'bouldering')).length,
    rope:entries.filter(g=>hasFacility(g,'rope')).length,kilter:entries.filter(g=>hasFacility(g,'kilter')).length };
}
export function linkedCatalogGym<T extends {catalogId?:string;name:string;city:string}>(entry:CatalogGym, gyms:T[]): T|undefined {
  const normalize=(s:string)=>s.toLowerCase().replace(/[\s（）()·]/g,'');
  return gyms.find(g=>g.catalogId===entry.id||!!g.catalogId&&!!entry.alternateIds?.includes(g.catalogId))||gyms.find(g=>!g.catalogId&&normalize(g.name)===normalize(entry.name)&&g.city.replace(/市$/,'')===entry.city.replace(/市$/,''));
}
