import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, dispatch, context } from './fixtures';
import { emptyDeviceMedia, executeDeviceMedia, mergeDeviceMedia } from '../src/shared/device-media';
import { execute, publicState, State, Video } from '../src/shared/domain';
function prepared(){let s=fixture();const r=dispatch(s,'video.reserve',{byteSize:1000,durationSec:10});s=r.state;
  s=dispatch(s,'video.ready',{id:(r.value as Video)._id,localPath:'/synthetic/sample.mp4'},{trustedMedia:true}).state;return {state:s,id:(r.value as Video)._id};}
test('关键点保存、修改、排序和删除保留视频关联；错误时间与不存在关键点拒绝',()=>{
  let {state:s,id}=prepared();let r=dispatch(s,'video.mark',{id,timeSec:5,note:'转髋'});s=r.state;const marker=(r.value as {id:string}).id;
  s=dispatch(s,'video.mark',{id,timeSec:0,note:'起步'}).state;
  s=dispatch(s,'video.mark',{id,markerId:marker,timeSec:8,note:'落脚后转髋'}).state;
  assert.deepEqual(s.videos[0].marks?.map(m=>m.timeSec),[0,8]);assert.equal(s.videos[0].status,'ready');
  for(const timeSec of [-1,11,NaN,'3'])assert.throws(()=>dispatch(s,'video.mark',{id,timeSec,note:'无效'}));
  assert.throws(()=>dispatch(s,'video.mark',{id,markerId:'unknown',timeSec:3,note:'无效'}));
  s=dispatch(s,'video.unmark',{id,markerId:marker}).state;assert.equal(s.videos[0].marks?.length,1);
});
test('关键点归属、30条上限、备注长度和未完成视频保护',()=>{
  let {state:s,id}=prepared();for(let i=0;i<30;i++)s=dispatch(s,'video.mark',{id,timeSec:i/10,note:'合成标记'}).state;
  assert.throws(()=>dispatch(s,'video.mark',{id,timeSec:2,note:'第31条'}));
  assert.throws(()=>dispatch(s,'video.mark',{id,markerId:s.videos[0].marks![0].id,timeSec:2,note:'x'.repeat(121)}));
  assert.throws(()=>dispatch(s,'video.mark',{id,timeSec:1,note:'越权'},{ownerId:'someone-else'}));
  s=dispatch(s,'video.delete',{id}).state;assert.throws(()=>dispatch(s,'video.mark',{id,timeSec:1,note:'待删除'}));
});
test('云端记录模式关键点只写当前设备媒体，删除视频后不残留标记',()=>{
  const cloud=fixture();let journal=emptyDeviceMedia(cloud.ownerId),state:State=cloud;let seq=0;
  const cmd=(action:string,data:Record<string,unknown>)=>{const r=executeDeviceMedia(state,journal,{action,data,requestId:'marker_request_'+(++seq)},
    {ownerId:cloud.ownerId,now:new Date().toISOString(),newId:p=>p+'_'+(++seq)});state=r.state;journal=r.journal;return r.value as Video;};
  const v=cmd('video.reserve',{byteSize:1000,durationSec:10});cmd('video.ready',{id:v._id,localPath:'/synthetic/video.mp4'});
  cmd('video.mark',{id:v._id,timeSec:1.5,note:'回看脚步'});assert.equal(journal.videos[0].marks?.[0].timeSec,1.5);assert.equal(cloud.videos.length,0);
  cmd('video.delete',{id:v._id});cmd('video.purged',{id:v._id});assert.equal(journal.videos.length,0);
});

test('编辑关键点清除旧备注缓存，编辑与删除请求重放幂等且不恢复旧文字',()=>{
  let {state:s,id}=prepared();
  const made=dispatch(s,'video.mark',{id,timeSec:3,note:'仅属于旧版本的合成备注'});s=made.state;
  const markerId=(made.value as {id:string}).id;
  const edit={action:'video.mark',requestId:'marker_edit_request_001',data:{id,markerId,timeSec:4,note:'本次更新的合成备注'}};
  const edited=execute(s,edit,context());s=edited.state;
  assert.equal(JSON.stringify(s).includes('仅属于旧版本的合成备注'),false);
  assert.deepEqual(s.operations[s.operations.length-1]?.value,{id:markerId});
  const editReplay=execute(s,edit,context());
  assert.equal(editReplay.state,s);assert.deepEqual(editReplay.value,{id:markerId});assert.equal(s.videos[0].marks?.length,1);

  const remove={action:'video.unmark',requestId:'marker_remove_request_001',data:{id,markerId}};
  const removed=execute(s,remove,context());s=removed.state;
  assert.deepEqual(s.videos[0].marks,[]);assert.equal(JSON.stringify(s).includes('本次更新的合成备注'),false);
  const deleteReplay=execute(s,remove,context());
  assert.equal(deleteReplay.state,s);assert.deepEqual(deleteReplay.value,{deletedId:markerId});assert.deepEqual(s.videos[0].marks,[]);
});

test('账号删除与公开删除墓碑立即移除视频关键点，仍保留清理文件所需的记录',()=>{
  let {state:s,id}=prepared();s=dispatch(s,'video.mark',{id,timeSec:3,note:'删除账户时应立即清除的合成备注'}).state;
  const tombstone=publicState({...s,accountDeleting:true});
  assert.equal(JSON.stringify(tombstone).includes('删除账户时应立即清除的合成备注'),false);
  assert.deepEqual(tombstone.videos[0].marks,[]);assert.equal(tombstone.videos[0]._id,id);assert.equal(tombstone.videos[0].status,'deleting');
  const deleted=dispatch(s,'account.delete',{}).state;
  assert.equal(JSON.stringify(deleted).includes('删除账户时应立即清除的合成备注'),false);
  assert.deepEqual(deleted.videos[0].marks,[]);assert.equal(deleted.videos[0].localPath,'/synthetic/sample.mp4');
  assert.equal(deleted.videos[0].status,'deleting');assert.equal(s.videos[0].marks?.length,1);
});

test('其他设备删除云端账号后，本机合并清空关键点与旧缓存，待清理副本不能带回备注',()=>{
  const cloud=fixture();let journal=emptyDeviceMedia(cloud.ownerId),state:State=cloud;let seq=0;
  const cmd=(action:string,data:Record<string,unknown>)=>{const r=executeDeviceMedia(state,journal,{action,data,requestId:'reset_mark_request_'+(++seq)},
    {ownerId:cloud.ownerId,now:new Date().toISOString(),newId:p=>p+'_'+(++seq)});state=r.state;journal=r.journal;return r.value as Video;};
  const v=cmd('video.reserve',{sessionId:cloud.sessions[0]._id,byteSize:1000,durationSec:10});
  cmd('video.ready',{id:v._id,localPath:'/synthetic/device-delete.mp4'});
  cmd('video.mark',{id:v._id,timeSec:2,note:'其他设备删号后不能重新合入的合成备注'});
  for(const server of [{...cloud,accountDeleting:true},{...cloud,consent:{...cloud.consent,privacyVersion:''}}]){
    const merged=mergeDeviceMedia(server,journal);
    assert.equal(JSON.stringify(merged).includes('其他设备删号后不能重新合入的合成备注'),false);
    assert.deepEqual(merged.journal.operations,[]);assert.deepEqual(merged.journal.videos[0].marks,[]);
    assert.equal(merged.journal.videos[0].status,'deleting');assert.equal(merged.journal.videos[0].localPath,'/synthetic/device-delete.mp4');
    assert.equal(merged.state.videos[0]._id,v._id);
  }
  assert.equal(journal.videos[0].marks?.length,1);
});
