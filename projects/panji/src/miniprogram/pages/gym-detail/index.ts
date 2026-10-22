import { catalogGym, catalogTags, linkedCatalogGym } from '../../../shared/gym-catalog';
import { load, current, command, ensurePrivacy, notify, toast } from '../../services/store';
import { exportOsmCatalog, osmAttribution, osmCopyrightUrl, osmLicenseUrl } from '../../services/catalog-export';
Page({
  selectMode:false,
  data:{entry:null as any,addressText:'',hasAddress:false,tags:[] as string[],added:false,busy:false,sources:false,error:'',sourceItems:[] as {name:string;url:string;dateText:string;license:string}[],
    isOsm:false,exporting:false,osmAttribution,osmCopyrightUrl,osmLicenseUrl},
  onLoad(q:Record<string,string>){this.selectMode=q.select==='1';const entry=catalogGym(q.id);
    const records=entry?[{name:entry.sourceName,url:entry.sourceUrl,date:entry.sourceDate,license:entry.sourceLicense},...(entry.sources||[])]:[];
    const sourceItems=records.filter((source,index)=>source.url&&records.findIndex(item=>item.url===source.url)===index).map(source=>({
      name:source.name,url:source.url,license:source.license||'',
      dateText:source.date?`${/openstreetmap\.org/.test(source.url)?'数据快照':'资料日期'} ${source.date}`:'来源未注明日期',
    }));
    const isOsm=records.some(source=>/ODbL/i.test(source.license||'')||/openstreetmap\.org/.test(source.url));
    const address=entry?.address.trim()||'';
    const addressText=address&&address.replace(/市$/,'')!==entry?.city.replace(/市$/,'')?address:'街道地址待补充';
    this.setData({entry:entry||null,addressText,hasAddress:addressText!=='街道地址待补充',tags:entry?catalogTags(entry):[],error:entry?'':'岩馆资料不存在',sourceItems,isOsm});},
  async onShow(){try{await load();this.refresh();}catch{/* Public details do not depend on personal cloud connectivity. */}},
  refresh(){if(this.data.entry){const own=linkedCatalogGym(this.data.entry,current().gyms);this.setData({added:!!own&&!own.archivedAt});}},
  sources(){this.setData({sources:!this.data.sources});},
  async copyAddress(){if(!this.data.entry||!this.data.hasAddress)return;try{
    const {city,address}=this.data.entry;await wx.setClipboardData({data:address.startsWith(city)?address:city+' '+address});
  }catch(error){notify(error);}},
  async exportOsm(){if(this.data.exporting)return;this.setData({exporting:true});
    try{await exportOsmCatalog();}catch(error){notify(error);}finally{this.setData({exporting:false});}},
  async save(record=false){
    if(this.data.busy||!this.data.entry)return;this.setData({busy:true});
    try{await load();if(!(await ensurePrivacy()))return;const own=linkedCatalogGym(this.data.entry,current().gyms);
      const gym=own&&!own.archivedAt?own:await command('gym.import',{catalogId:this.data.entry.id});this.refresh();
      if(record){wx.setStorageSync('panji.selectedGym',gym._id);if(this.selectMode)wx.navigateBack({delta:2});else wx.navigateTo({url:'/pages/session-edit/index'});}
      else toast('已加入我的岩馆');
    }catch(e){notify(e);}finally{this.setData({busy:false});}
  },
  add(){return this.save(false);},record(){return this.save(true);},
});
