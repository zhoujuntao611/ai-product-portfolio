import osmData from '../../../infrastructure/gym-catalog-osm.json';
import { toast } from './store';

export const osmAttribution='© OpenStreetMap contributors · ODbL';
export const osmCopyrightUrl='https://www.openstreetmap.org/copyright';
export const osmLicenseUrl='https://opendatacommons.org/licenses/odbl/1-0/';

function cancelled(error:unknown):boolean{
  const message=typeof error==='string'?error:(error as {errMsg?:string;message?:string})?.errMsg||(error as Error)?.message||'';
  return /cancel/i.test(message);
}

export async function exportOsmCatalog():Promise<void>{
  // Keep this adapted ODbL dataset separate from other sources and private records.
  const json=JSON.stringify(osmData,null,2)+'\n';
  const copy=async()=>{await wx.setClipboardData({data:json});toast('已复制 OSM 开放数据');};
  if(typeof wx.shareFileMessage!=='function'||!wx.env?.USER_DATA_PATH||typeof wx.getFileSystemManager!=='function'){await copy();return;}
  const fileName='攀迹-OSM岩馆开放数据.json';
  const filePath=`${wx.env.USER_DATA_PATH}/panji-osm-catalog.json`;
  try{
    await new Promise<void>((resolve,reject)=>wx.getFileSystemManager().writeFile({
      filePath,data:json,encoding:'utf8',success:()=>resolve(),fail:reject,
    }));
  }catch{await copy();return;}
  try{await wx.shareFileMessage({filePath,fileName});}
  catch(error){if(cancelled(error))return;await copy();}
}
