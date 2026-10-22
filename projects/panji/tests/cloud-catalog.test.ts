import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as crypto from 'node:crypto';
import { buildSync } from 'esbuild';
import { catalogGym, catalogSummary, catalogUpdatedAt, gymCatalog } from '../src/shared/gym-catalog';

// Exercise the compiled deployment handler, not a reimplementation of catalog.get.
const bundle=buildSync({entryPoints:['cloudfunctions/panji/main.ts'],bundle:true,write:false,
  platform:'node',format:'cjs',target:'node20',external:['wx-server-sdk','@cloudbase/node-sdk','@cloudbase/manager-node']}).outputFiles[0].text;
const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
const platformIdentity={environment:{WX_OPENID:'synthetic-platform-reader',WX_APPID:'wx-synthetic-test-app'}};

function cloudHandler(){
  const databaseTouches:string[]=[],storageTouches:string[]=[];
  const guard=(kind:string,touches:string[])=>new Proxy({}, {get(_target,key){
    touches.push(String(key));throw new Error(`${kind} must not be accessed by a public catalog read`);
  }});
  const database=guard('database',databaseTouches),storage=guard('storage',storageTouches);
  const module={exports:{} as {main:(event:unknown,context:unknown)=>Promise<any>}};
  const wxSdk={DYNAMIC_CURRENT_ENV:'synthetic-current-env',init:()=>undefined,database:()=>database};
  const tcbSdk={SYMBOL_CURRENT_ENV:'synthetic-current-env',init:()=>storage,parseContext:(context:unknown)=>context||{}};
  vm.runInNewContext(bundle,{exports:module.exports,module,Buffer,setTimeout,clearTimeout,
    // A warm function can retain a prior environment identity. It is not authorization.
    process:{env:{WX_OPENID:'stale-environment-owner',PANJI_AI_ENABLED:'false'}},
    require:(name:string)=>{
      if(name==='node:crypto')return crypto;
      if(name==='wx-server-sdk')return wxSdk;
      if(name==='@cloudbase/node-sdk')return tcbSdk;
      throw new Error(`Unexpected catalog dependency: ${name}`);
    },
  });
  return {main:module.exports.main,assertReadOnly(){assert.deepEqual(databaseTouches,[]);assert.deepEqual(storageTouches,[]);}};
}

test('云端目录读取返回部署快照和新合作岩馆，不读取或创建任何私人账户',async()=>{
  const server=cloudHandler(),partner=gymCatalog.find(g=>g.id.startsWith('hylonomus-'));
  assert.ok(partner,'扩充快照应包含新合作馆');
  for(const id of [gymCatalog[0].id,partner.id]){
    const result=plain(await server.main({action:'catalog.get',data:{id}},platformIdentity));
    assert.equal(result.ok,true);assert.equal(result.data.updatedAt,catalogUpdatedAt);
    assert.deepEqual(result.data.summary,catalogSummary());assert.deepEqual(result.data.entry,plain(catalogGym(id)));
    assert.deepEqual(Object.keys(result.data).sort(),['entry','summary','updatedAt']);
    assert.ok(!JSON.stringify(result).includes('synthetic-platform-reader'));
  }
  server.assertReadOnly();
});

test('合并来源的旧别名编号解析到原馆编号；未知编号只返回空条目',async()=>{
  const server=cloudHandler();
  for(const [alias,canonical] of [['hylonomus-c1bfb03ca55832c7','bj-rockhour-xisanqi'],['hylonomus-ee7a0d031618db2e','sh-rockhour-gatem']]){
    const result=plain(await server.main({action:'catalog.get',data:{id:alias}},platformIdentity));
    assert.equal(result.ok,true);assert.equal(result.data.entry.id,canonical);
    assert.deepEqual(result.data.entry,plain(catalogGym(canonical)));
  }
  const missing=plain(await server.main({action:'catalog.get',data:{id:'unknown-catalog-id'}},platformIdentity));
  assert.equal(missing.ok,true);assert.equal(missing.data.entry,null);assert.deepEqual(missing.data.summary,catalogSummary());
  server.assertReadOnly();
});

test('云端目录要求本次平台身份，事件伪造身份或温实例环境身份均无效',async()=>{
  const server=cloudHandler();
  const event={action:'catalog.get',data:{id:gymCatalog[0].id,ownerId:'spoofed-user',WX_OPENID:'spoofed-user'},OPENID:'spoofed-user'};
  for(const context of [{},{environment:{WX_OPENID:''}},{environment:{WX_OPENID:42}},
    {environment:{},environ:{WX_OPENID:'stale-legacy-user'}}]){
    const result=plain(await server.main(event,context));
    assert.equal(result.ok,false);assert.equal(result.error.code,'AUTH_REQUIRED');
  }
  server.assertReadOnly();
});

test('目录请求格式仍受正式接口校验；非法请求不触及数据库',async()=>{
  const server=cloudHandler();
  for(const event of [{action:'catalog.get',data:null},{action:'catalog.get',data:[]},
    {action:'catalog.get',data:{id:'x'.repeat(32000)}}]){
    const result=plain(await server.main(event,platformIdentity));
    assert.equal(result.ok,false);assert.equal(result.error.code,'VALIDATION_ERROR');
  }
  server.assertReadOnly();
});
