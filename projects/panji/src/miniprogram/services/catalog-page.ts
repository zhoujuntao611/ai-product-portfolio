import { gymCatalog, catalogGym, catalogCities, catalogSummary, catalogListItem, searchCatalog, linkedCatalogGym, CatalogFilter, CatalogGym, catalogUpdatedAt, CATALOG_PAGE_SIZE } from '../../shared/gym-catalog';
import { load, current, command, ensurePrivacy, notify, toast } from './store';
import { exportOsmCatalog, osmAttribution } from './catalog-export';
type DirectoryGroup={city:string;total:number;width:number;entries:ReturnType<typeof catalogListItem>[]};
export function directoryPage(selectMode: boolean) {
  const data = { loading:false,selectMode,query:'',cityIndex:0,kind:'' as CatalogFilter,mineOnly:false,mineCount:0,personalError:'',busyId:'',groups:[] as DirectoryGroup[],shown:0,hasMore:false,exporting:false,osmAttribution,
      cities:[{name:'全部城市',count:gymCatalog.length},...catalogCities()],summary:catalogSummary(),found:gymCatalog.length,updatedAt:catalogUpdatedAt,
      filters:[{id:'',name:'全部'},{id:'bouldering',name:'抱石'},{id:'rope',name:'难度'},{id:'kilter',name:'K 板'}] };
  type Instance={data:typeof data;matches:CatalogGym[];cityTotals:Map<string,number>;largestCity:number;
    setData(value:Record<string,unknown>):void;refresh(keepShown?:boolean):void;append(entries:CatalogGym[]):void;more():void;onShow():Promise<void>};
  return {
    data,
    matches:[] as CatalogGym[],cityTotals:new Map<string,number>(),largestCity:1,
    onLoad(this:Instance) {
      const city=wx.getStorageSync('panji.catalog.city');
      const index=this.data.cities.findIndex(c=>c.name===city);
      this.setData({cityIndex:index>0?index:0});this.refresh();
    },
    async onShow(this:Instance) {this.refresh(true);try{await load();this.setData({personalError:''});}catch{this.setData({personalError:'我的岩馆暂时未能载入，请重试。公共名录仍可浏览。'});}this.refresh(true);},
    retry(this:Instance){return this.onShow();},
    refresh(this:Instance,keepShown=false) {
      const city=this.data.cityIndex ? this.data.cities[this.data.cityIndex]?.name || '' : '';
      let mine:any[]=[];if(!this.data.personalError)try{mine=current().gyms;}catch{}
      const mineIds=new Set(gymCatalog.filter(entry=>{const own=linkedCatalogGym(entry,mine);return !!own&&!own.archivedAt;}).map(entry=>entry.id));
      this.matches=searchCatalog(this.data.query,city,this.data.kind).filter(entry=>!this.data.mineOnly||mineIds.has(entry.id));
      this.cityTotals=new Map();
      for(const gym of this.matches)this.cityTotals.set(gym.city,(this.cityTotals.get(gym.city)||0)+1);
      this.largestCity=Math.max(1,...this.cityTotals.values());
      const count=Math.min(this.matches.length,keepShown?Math.max(CATALOG_PAGE_SIZE,this.data.shown):CATALOG_PAGE_SIZE);
      const scope=(city?searchCatalog('',city):gymCatalog).filter(entry=>!this.data.mineOnly||mineIds.has(entry.id));
      this.setData({found:this.matches.length,mineCount:mineIds.size,summary:catalogSummary(scope),groups:[],shown:0,hasMore:!!this.matches.length});
      // Only card fields cross the WeChat bridge; complete provenance stays in the shared catalog.
      for(let offset=0;offset<count;offset+=CATALOG_PAGE_SIZE)this.append(this.matches.slice(offset,Math.min(offset+CATALOG_PAGE_SIZE,count)));
    },
    append(this:Instance,entries:CatalogGym[]){
      if(!entries.length)return;
      let mine:any[]=[];if(!this.data.personalError)try{mine=current().gyms;}catch{}
      const chunks=new Map<string,ReturnType<typeof catalogListItem>[]>();
      for(const gym of entries){
        const own=linkedCatalogGym(gym,mine),list=chunks.get(gym.city)||[];
        list.push(catalogListItem(gym,!!own&&!own.archivedAt));chunks.set(gym.city,list);
      }
      const patch:Record<string,unknown>={};let nextIndex=this.data.groups.length;
      const firstGroups:DirectoryGroup[]=[];
      for(const [city,items] of chunks){
        const index=this.data.groups.findIndex(group=>group.city===city);
        if(index<0){const total=this.cityTotals.get(city)||items.length;
          const group={city,total,width:Math.round(total/this.largestCity*100),entries:items};
          if(!this.data.groups.length)firstGroups.push(group);else patch[`groups[${nextIndex++}]`]=group;
        }else{
          const offset=this.data.groups[index].entries.length;
          for(let i=0;i<items.length;i++)patch[`groups[${index}].entries[${offset+i}]`]=items[i];
        }
      }
      if(firstGroups.length)patch.groups=firstGroups;
      patch.shown=this.data.shown+entries.length;patch.hasMore=Number(patch.shown)<this.matches.length;this.setData(patch);
    },
    more(this:Instance){this.append(this.matches.slice(this.data.shown,this.data.shown+CATALOG_PAGE_SIZE));},
    onReachBottom(this:Instance){this.more();},
    async exportOsm(this:Instance){if(this.data.exporting)return;this.setData({exporting:true});
      try{await exportOsmCatalog();}catch(error){notify(error);}finally{this.setData({exporting:false});}},
    search(this:Instance,e:any){this.setData({query:e.detail.value});this.refresh();},
    clearSearch(this:Instance){this.setData({query:''});this.refresh();},
    scope(this:Instance,e:any){this.setData({mineOnly:e.currentTarget.dataset.scope==='mine'});this.refresh();},
    city(this:Instance,e:any){const n=Number(e.detail.value);this.setData({cityIndex:Number.isInteger(n)&&n>=0&&n<this.data.cities.length?n:0});
      wx.setStorageSync('panji.catalog.city',this.data.cities[this.data.cityIndex].name);this.refresh();},
    filter(this:Instance,e:any){const kind=e.currentTarget.dataset.kind;this.setData({kind:['','bouldering','rope','kilter'].includes(kind)?kind:''});this.refresh();},
    reset(this:Instance){wx.removeStorageSync('panji.catalog.city');this.setData({query:'',cityIndex:0,kind:'',mineOnly:false});this.refresh();},
    open(e:any){wx.navigateTo({url:'/pages/gym-detail/index?id='+e.currentTarget.dataset.id+(selectMode?'&select=1':'')});},
    async choose(this:Instance,e:any){
      if(this.data.busyId)return;const catalogId=e.currentTarget.dataset.id;this.setData({busyId:catalogId});
      try{await load();this.setData({personalError:''});if(!(await ensurePrivacy()))return;const entry=catalogGym(catalogId),own=entry?linkedCatalogGym(entry,current().gyms):undefined;
        const gym=own&&!own.archivedAt?own:await command('gym.import',{catalogId});
        if(selectMode){wx.setStorageSync('panji.selectedGym',gym._id);wx.navigateBack();}
        else if(own&&!own.archivedAt){wx.setStorageSync('panji.selectedGym',gym._id);wx.navigateTo({url:'/pages/session-edit/index'});}
        else{this.refresh(true);toast('已加入我的岩馆');}
      }catch(e){notify(e);}finally{this.setData({busyId:''});}
    },
    manage(){wx.navigateTo({url:'/pages/gyms/index'});},
    manual(){if(selectMode){wx.setStorageSync('panji.catalog.manual',true);wx.navigateBack();}else wx.navigateTo({url:'/pages/gyms/index?new=1'});},
  };
}
