import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildSync } from 'esbuild';

const expected=JSON.parse(fs.readFileSync('infrastructure/gym-catalog-osm.json','utf8'));
const expectedJson=JSON.stringify(expected,null,2)+'\n';
const bundle=buildSync({entryPoints:['src/miniprogram/services/catalog-export.ts'],bundle:true,write:false,
  platform:'neutral',format:'cjs',target:'es2018',define:{PANJI_CLOUD_ENV:'""'}}).outputFiles[0].text;

function device(mode:'file'|'unsupported'|'write-fail'|'share-fail'|'cancel'|'clipboard-fail'){
  const writes:{filePath:string;data:string;encoding:string}[]=[],shares:{filePath:string;fileName:string}[]=[],copies:string[]=[];
  const module={exports:{} as {exportOsmCatalog:()=>Promise<void>}};
  const wx:any={env:{USER_DATA_PATH:'/device'},getStorageSync:()=>({privateNotes:'private-data-must-not-be-exported'}),showToast:()=>undefined,
    setClipboardData:async({data}:{data:string})=>{if(mode==='clipboard-fail')throw new Error('clipboard unavailable');copies.push(data);},
    getFileSystemManager:()=>({writeFile(options:any){
      if(mode==='write-fail')options.fail(new Error('device storage unavailable'));
      else{writes.push({filePath:options.filePath,data:options.data,encoding:options.encoding});options.success();}
    }}),
  };
  if(mode!=='unsupported'&&mode!=='clipboard-fail')wx.shareFileMessage=async(options:{filePath:string;fileName:string})=>{
    shares.push(options);if(mode==='cancel')throw {errMsg:'shareFileMessage:fail cancel'};
    if(mode==='share-fail')throw new Error('file sharing unavailable');
  };
  vm.runInNewContext(bundle,{wx,exports:module.exports,module,setTimeout,clearTimeout});
  return {writes,shares,copies,run:()=>module.exports.exportOsmCatalog()};
}

test('开放数据文件导出为完整适配 OSM 数据及许可，不混其他来源或私人记录',async()=>{
  const d=device('file');await d.run();
  assert.equal(d.writes.length,1);assert.equal(d.writes[0].data,expectedJson);assert.equal(d.writes[0].encoding,'utf8');
  assert.equal(d.shares.length,1);assert.equal(d.shares[0].filePath,d.writes[0].filePath);
  assert.match(d.shares[0].fileName,/OSM.*\.json$/);assert.equal(d.copies.length,0);
  const exported=JSON.parse(d.writes[0].data);
  assert.equal(exported.attribution,'© OpenStreetMap contributors');assert.equal(exported.license,'ODbL-1.0');
  assert.match(exported.licenseUrl,/opendatacommons\.org\/licenses\/odbl/);
  assert.match(exported.copyrightUrl,/openstreetmap\.org\/copyright/);
  assert.equal(exported.entries.length,expected.entries.length);
  assert.ok(exported.entries.every((entry:{id:string})=>entry.id.startsWith('osm-')));
  assert.ok(!d.writes[0].data.includes('private-data-must-not-be-exported'));
});

test('微信不支持文件分享时复制完整 JSON，不尝试写文件',async()=>{
  const d=device('unsupported');await d.run();
  assert.deepEqual(d.copies,[expectedJson]);assert.equal(d.writes.length,0);assert.equal(d.shares.length,0);
});

test('设备文件写入失败或分享服务失败时，仍可通过剪贴板导出原数据',async()=>{
  for(const mode of ['write-fail','share-fail'] as const){
    const d=device(mode);await d.run();assert.deepEqual(d.copies,[expectedJson]);
    if(mode==='write-fail')assert.equal(d.shares.length,0);
  }
});

test('用户取消文件分享时不擅自复制，也不把取消当成导出失败',async()=>{
  const d=device('cancel');await d.run();assert.equal(d.shares.length,1);assert.equal(d.copies.length,0);
});

test('剪贴板也不可用时返回错误，页面能够给出真实失败提示',async()=>{
  const d=device('clipboard-fail');await assert.rejects(d.run(),/clipboard unavailable/);
  assert.equal(d.copies.length,0);
});
