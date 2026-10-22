import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildSync } from 'esbuild';
import { fixture } from './fixtures';
import { emptyState, execute, MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS, State } from '../src/shared/domain';
import { release } from '../src/miniprogram/services/release';

const bundle = buildSync({ entryPoints: ['src/miniprogram/services/store.ts'], bundle: true, write: false,
  platform: 'neutral', format: 'cjs', target: 'es2018', define: { PANJI_CLOUD_ENV: '"synthetic-test-env"' } }).outputFiles[0].text;
function device() {
  let cloud = fixture(); let count = 0;
  const storage = new Map<string, any>([['panji.mode.v1', 'cloud']]);
  const requests: any[] = [], deleted: string[] = [], saved: string[] = [];
  const files = new Set<string>(); let permission: any;
  const modals: any[] = [];
  let selectedFile: any = { tempFilePath: '/temp/synthetic.mp4', size: 1000, duration: 10 };
  let videoInfo: any = { duration: 10 }, fileBytes: any = 1000, probeError = '', statError = '', saveError = '';
  let chooseCount = 0, chooseError = '', storageError = false, unlinkError = false, deletionPasses = 1, cleanupCalls = 0;
  const wx: any = {
    env: { USER_DATA_PATH: '/synthetic-device' },
    getStorageSync: (key: string) => structuredClone(storage.get(key) || ''),
    setStorageSync: (key: string, value: any) => { if (storageError) throw new Error('full'); storage.set(key, structuredClone(value)); },
    showModal: async (options: any) => { modals.push(options); return { confirm: true }; }, showToast: () => undefined, showLoading: () => undefined, hideLoading: () => undefined,
    requirePrivacyAuthorize: (options: any) => { permission = options; },
    chooseMedia: async (options: any) => { assert.equal(options.sourceType[0], 'album'); assert.ok(!('maxDuration' in options)); chooseCount++; if (chooseError) throw { errMsg: chooseError }; return { tempFiles: [selectedFile] }; },
    getVideoInfo: async () => { if (probeError) throw { errMsg: probeError }; return videoInfo; },
    getFileSystemManager: () => ({
      stat: (o: any) => { if (statError) return o.fail({ errMsg: statError }); o.success({ stats: { size: fileBytes } }); },
      saveFile: (o: any) => { if (saveError) return o.fail({ errMsg: saveError }); saved.push(o.filePath); files.add(o.filePath); o.success({ savedFilePath: o.filePath }); },
      unlink: (o: any) => { if (unlinkError) return o.fail({ errMsg: 'unlink:fail permission denied' }); deleted.push(o.filePath); files.delete(o.filePath); o.success({}); },
    }),
    uploadFile: () => { throw new Error('must never upload a device video'); },
    cloud: {
      init: () => undefined,
      callFunction: async ({ data }: any) => {
        requests.push(structuredClone(data));
        if (data.action === 'account.get') return { result: { ok: true, data: { state: structuredClone(cloud), capabilities: { uploadsAvailable: false, aiAvailable: false } } } };
        if (data.action === 'video.cleanup') { cleanupCalls++; if (cloud.accountDeleting && --deletionPasses <= 0) cloud = emptyState(cloud.ownerId); return { result: { ok: true, data: {} } }; }
        const result = execute(cloud, data, { ownerId: cloud.ownerId, now: new Date().toISOString(), newId: p => `${p}_cloud_${++count}` });
        cloud = result.state; return { result: { ok: true, data: structuredClone(result) } };
      },
    },
  };
  function service() {
    const module = { exports: {} }; vm.runInNewContext(bundle, { wx, console, exports: module.exports, module, setTimeout, clearTimeout }); return module.exports as any;
  }
  const turn = () => new Promise<void>(resolve => setImmediate(resolve));
  async function importOne(s: any) { const task = s.importVideo(cloud.sessions[0]._id, null, () => undefined); await turn(); permission.success(); await task; }
  return { service, importOne, wx, storage, files, requests, saved, deleted, turn, modals,
    metadata: (selected: any, info: any, bytes: any = 1000) => { selectedFile = { tempFilePath: '/temp/synthetic.mp4', ...selected }; videoInfo = info; fileBytes = bytes; },
    failProbe: (value: string) => { probeError = value; }, failStat: (value: string) => { statError = value; }, failSave: (value: string) => { saveError = value; },
    useLocal: () => { const local = structuredClone(cloud); local.ownerId = 'device'; local.operations = [];
      for (const key of ['gyms','sessions','attempts','videos','reviews','goals'] as const) for (const item of local[key]) item.ownerId = 'device';
      storage.set('panji.mode.v1', 'local'); storage.set('panji.data.v1', local); },
    get cloud() { return cloud; }, set cloud(v: State) { cloud = v; },
    get chooseCount() { return chooseCount; }, get permission() { return permission; },
    get cleanupCalls() { return cleanupCalls; }, deferDeletion: (passes: number) => { deletionPasses = passes; },
    failChoose: (value: string) => { chooseError = value; }, failStorage: (value: boolean) => { storageError = value; }, failUnlink: (value: boolean) => { unlinkError = value; } };
}
test('云端模式先等待微信授权，视频仅保存当前设备，重开可播放且不发送媒体元数据', async () => {
  const d = device(), s = d.service(); await s.load();
  const task = s.importVideo(d.cloud.sessions[0]._id, d.cloud.attempts[0]._id, () => undefined);
  await d.turn(); assert.equal(d.chooseCount, 0); d.permission.success(); await task;
  assert.equal(d.chooseCount, 1); assert.equal(d.cloud.videos.length, 0); assert.equal(d.cloud.sessions.length, 6);
  assert.equal(d.saved.length, 1); assert.match(d.saved[0], /^\/synthetic-device\/panji-video-video_[\w-]+\.mp4$/);
  assert.ok(d.requests.every(r => r.action === 'account.get'));
  assert.ok(!JSON.stringify(d.requests).includes('localPath'));
  const reopened = d.service(); await reopened.load(); const v = reopened.current().videos[0];
  assert.equal(v.localOnly, true); assert.equal(v.attemptId, d.cloud.attempts[0]._id);
  assert.equal(await reopened.videoUrl(v), d.saved[0]);
  await reopened.command('gym.save', { ...d.cloud.gyms[0], id: d.cloud.gyms[0]._id, name: '修改后的合成岩馆' });
  assert.equal(reopened.current().videos.length, 1); assert.equal(d.cloud.videos.length, 0);
  assert.ok(!JSON.stringify(d.requests).includes('synthetic-device'));
});

test('43 MB 视频的大小和时长返回数字字符串时，本机与云端记录均可导入关联', async () => {
  for (const local of [false, true]) {
    const d = device(); if (local) d.useLocal(); const s = d.service(); await s.load();
    const bytes = 43 * 1024 * 1024; d.metadata({ size: String(bytes), duration: '35.25' }, { duration: '35.25' }, bytes);
    const task = s.importVideo(d.cloud.sessions[0]._id, d.cloud.attempts[0]._id, () => undefined); await d.turn(); d.permission.success(); await task;
    const v = s.current().videos[0]; assert.equal(v.byteSize, bytes); assert.equal(v.durationSec, 35.25); assert.equal(v.status, 'ready');
    const confirmation = d.modals.find(m => m.title === '保存这段视频？');
    assert.match(confirmation.content, /35\.3 秒 · 43\.0 MB/);
    assert.equal(v.attemptId, d.cloud.attempts[0]._id); assert.equal(d.saved.length, 1); assert.equal(d.cloud.videos.length, 0);
    assert.ok(d.requests.every(r => r.action === 'account.get'));
  }
});

test('视频元信息缺失、探测返回0或失败时，从文件大小和相册时长恢复，不伪造时长', async () => {
  for (const local of [false, true]) for (const probe of [{ duration: 0 }, { size: 43 * 1024 }, null]) {
    const d = device(); if (local) d.useLocal(); const s = d.service(); await s.load();
    d.metadata({ duration: '20.75' }, probe, 43 * 1024 * 1024); if (probe === null) d.failProbe('getVideoInfo:fail unsupported codec');
    await d.importOne(s); const v = s.current().videos[0];
    assert.equal(v.byteSize, 43 * 1024 * 1024); assert.equal(v.durationSec, 20.75); assert.equal(v.status, 'ready');
  }
});

test('无法读取文件统计时只使用相册的有效字节数，不把kB字段当字节数', async () => {
  const d = device(), s = d.service(); await s.load(); const bytes = 43 * 1024 * 1024;
  d.metadata({ size: String(bytes), duration: '12' }, { duration: '12', size: 43 * 1024 }); d.failStat('stat:fail unavailable');
  await d.importOne(s); assert.equal(s.current().videos[0].byteSize, bytes);
  const invalid = device(), other = invalid.service(); await other.load();
  invalid.metadata({ size: undefined, duration: 12 }, { duration: 12, size: 43 * 1024 }, 0);
  await assert.rejects(invalid.importOne(other), /未能读取视频大小/);
  assert.equal(other.current().videos.length, 0); assert.equal(invalid.saved.length, 0);
});

test('本机和云端记录兼容原视频，并接受61秒/51MiB与新上限300秒/100MiB，仅本机保存', async () => {
  for (const local of [false, true]) for (const [bytes, duration] of [[50 * 1024 * 1024, 60], [51 * 1024 * 1024, 61], [MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS]]) {
    const d = device(); if (local) d.useLocal(); const s = d.service(); await s.load();
    d.metadata({ size: String(bytes), duration: String(duration) }, { duration: String(duration) }, bytes);
    await d.importOne(s);
    const reopened = d.service(); await reopened.load(); const video = reopened.current().videos[0];
    assert.equal(video.byteSize, bytes); assert.equal(video.durationSec, duration); assert.equal(video.status, 'ready');
    assert.equal(await reopened.videoUrl(video), d.saved[0]);
    assert.equal(d.cloud.videos.length, 0); assert.ok(d.requests.every(r => r.action === 'account.get'));
  }
});

test('视频大小按实际文件校验；超过新上限或任一可信时长超限在预约前明确拒绝', async () => {
  for (const [selected, info, actual, message] of [
    [{ size: 1000, duration: 10 }, { duration: 10 }, MAX_VIDEO_BYTES + 1, /超过 100 MB/],
    [{ size: 1000, duration: 30 }, { duration: String(MAX_VIDEO_SECONDS + 0.01) }, 1000, /超过 5 分钟/],
    [{ size: 1000, duration: String(MAX_VIDEO_SECONDS + 1) }, { duration: 30 }, 1000, /超过 5 分钟/],
  ] as const) {
    const d = device(), s = d.service(); await s.load(); d.metadata(selected, info, actual);
    await assert.rejects(d.importOne(s), message); assert.equal(s.current().videos.length, 0); assert.equal(d.saved.length, 0);
    assert.ok(!d.modals.some(m => m.title === '保存这段视频？')); assert.equal(d.cloud.sessions.length, 6);
  }
  const d = device(), s = d.service(); await s.load();
  d.metadata({ size: MAX_VIDEO_BYTES + 1, duration: 10 }, { duration: 10 }, 43 * 1024 * 1024);
  await d.importOne(s); assert.equal(s.current().videos[0].byteSize, 43 * 1024 * 1024);
});

test('缺失、0、空字符串、数组等未知时长不进入数字校验或留下视频预约', async () => {
  for (const duration of [undefined, 0, '', 'NaN', 'Infinity', NaN, true, [12], 0.001]) {
    const d = device(), s = d.service(); await s.load(); d.metadata({ size: 1000, duration }, { duration });
    await assert.rejects(d.importOne(s), /未能读取视频时长/); assert.equal(s.current().videos.length, 0); assert.equal(d.saved.length, 0);
    assert.ok(!d.modals.some(m => m.title === '保存这段视频？'));
  }
});

test('真实保存失败清理预约并保留训练；视频入口提示存储不足或临时文件失效', async () => {
  for (const [raw, expected] of [
    ['saveFile:fail the maximum size of the file storage is exceeded', /本机可用空间不足/],
    ['saveFile:fail file not exist', /视频临时文件已失效/],
  ] as const) {
    const d = device(), s = d.service(); await s.load(); d.failSave(raw); let failure;
    try { await d.importOne(s); } catch (e) { failure = e; }
    assert.ok(failure); s.notify(failure, 'video'); assert.equal(d.modals[d.modals.length - 1].title, '视频未能导入'); assert.match(d.modals[d.modals.length - 1].content, expected);
    assert.equal(s.current().videos.length, 0); assert.equal(d.files.size, 0); assert.equal(d.cloud.sessions.length, 6);
    assert.ok(d.requests.every(r => r.action === 'account.get'));
  }
});

test('超过5分钟可打开原生裁剪，编辑器毫秒转换为秒后重新校验保存',async()=>{
  const d=device(),s=d.service();await s.load();d.metadata({size:1000,duration:MAX_VIDEO_SECONDS+60},{duration:MAX_VIDEO_SECONDS+60});
  d.wx.showActionSheet=async()=>({tapIndex:0});let edited=false;
  d.wx.openVideoEditor=(o:any)=>{assert.equal(o.maxDuration,String(MAX_VIDEO_SECONDS));edited=true;d.metadata({}, {duration:0},1000);o.success({tempFilePath:'/temp/trimmed.mp4',size:1000,duration:45000});};
  await d.importOne(s);assert.ok(edited);assert.equal(s.current().videos[0].durationSec,45);assert.equal(s.current().videos[0].status,'ready');
});
test('超限压缩后读取输出实际字节，不误用压缩接口的kB字符串',async()=>{
  const d=device(),s=d.service();await s.load();d.metadata({size:MAX_VIDEO_BYTES+1,duration:30},{duration:30},MAX_VIDEO_BYTES+1);
  d.wx.showActionSheet=async()=>({tapIndex:0});d.wx.compressVideo=(o:any)=>{d.metadata({}, {duration:30},4000000);o.success({tempFilePath:'/temp/compressed.mp4',size:'3906.25'});};
  await d.importOne(s);assert.equal(s.current().videos[0].byteSize,4000000);assert.equal(s.current().videos[0].durationSec,30);
});
test('大小和时长同时超限可先压缩再裁剪，输出仍不合规时有界停止',async()=>{
  for(const succeeds of [true,false]){
    const d=device(),s=d.service();await s.load();d.metadata({duration:MAX_VIDEO_SECONDS+60},{duration:MAX_VIDEO_SECONDS+60},MAX_VIDEO_BYTES+1);
    let steps=0;d.wx.showActionSheet=async()=>{steps++;return{tapIndex:0};};
    d.wx.compressVideo=(o:any)=>{d.metadata({}, {duration:MAX_VIDEO_SECONDS+60},20*1024*1024);o.success({tempFilePath:'/temp/compressed.mp4'});};
    d.wx.openVideoEditor=(o:any)=>{const seconds=succeeds?45:MAX_VIDEO_SECONDS+60;d.metadata({}, {duration:seconds},20*1024*1024);o.success({tempFilePath:'/temp/trimmed.mp4',duration:seconds*1000,size:20*1024*1024});};
    if(succeeds){await d.importOne(s);assert.equal(s.current().videos[0].durationSec,45);assert.equal(s.current().videos[0].byteSize,20*1024*1024);}
    else{await assert.rejects(d.importOne(s),/超过 5 分钟/);assert.equal(s.current().videos.length,0);assert.equal(d.saved.length,0);}
    assert.equal(steps,2);
  }
});

test('取消处理或不支持编辑不写预约；视频诊断包含版本、步骤且不含路径',async()=>{
  const d=device(),s=d.service();await s.load();d.metadata({size:1000,duration:MAX_VIDEO_SECONDS+1},{duration:MAX_VIDEO_SECONDS+1});d.wx.showActionSheet=async()=>({tapIndex:2});
  await d.importOne(s);assert.equal(s.current().videos.length,0);
  d.wx.showActionSheet=async()=>({tapIndex:0});await assert.rejects(d.importOne(s),/不支持视频裁剪/);assert.equal(s.current().videos.length,0);
  const info=d.storage.get('panji.videoImportDiagnostics.v1');assert.ok(info.release.startsWith(release.version+' · '));assert.equal(info.stage,'读取视频信息');assert.ok(!JSON.stringify(info).includes('/temp/'));
});
test('缺少平台隐私声明或拒绝授权，不创建视频预约或文件，不损坏训练', async () => {
  const d = device(), s = d.service(); await s.load();
  d.failChoose('chooseMedia:fail api scope is not declared in the privacy agreement');
  const task = s.importVideo(null, null, () => undefined); await d.turn(); d.permission.success();
  await assert.rejects(task, (e: any) => /相册隐私声明尚未生效/.test(s.errorMessage(e)));
  assert.equal(s.current().videos.length, 0); assert.equal(d.saved.length, 0); assert.equal(d.cloud.sessions.length, 6);
  const denied = s.importVideo(null, null, () => undefined); await d.turn(); d.permission.fail({ errMsg: 'requirePrivacyAuthorize:fail user denied' });
  await assert.rejects(denied); assert.equal(d.chooseCount, 1); assert.equal(d.cloud.sessions.length, 6);
});
test('删除训练默认保留视频并解除关联，明确删除视频时清除当前设备副本', async () => {
  for (const deleteVideos of [false, true]) {
    const d = device(), s = d.service(); await s.load(); await d.importOne(s);
    const session = d.cloud.sessions[0]; await s.command('session.delete', { id: session._id, version: session.version, deleteVideos });
    assert.equal(s.current().videos[0].sessionId, null);
    assert.equal(s.current().videos[0].status, deleteVideos ? 'deleting' : 'ready');
    await s.cleanupVideos();
    assert.equal(s.current().videos.length, deleteVideos ? 0 : 1); assert.equal(d.files.size, deleteVideos ? 0 : 1);
    assert.equal(d.cloud.sessions.length, 5); assert.ok(d.requests.every(r => !r.action.startsWith('video.')));
  }
});
test('删除失败保留清理标记和配额，重试只删除攀迹保存的确定路径', async () => {
  const d = device(), s = d.service(); await s.load(); await d.importOne(s);
  const video = s.current().videos[0]; await s.command('video.delete', { id: video._id });
  d.failUnlink(true); await s.cleanupVideos(); assert.equal(s.current().videos[0].status, 'deleting');
  assert.equal(d.files.size, 1); d.failUnlink(false); await s.cleanupVideos();
  assert.equal(s.current().videos.length, 0); assert.deepEqual(d.deleted, d.saved);
});
test('设备元数据写入失败时不误报已保存；换微信身份不展示原用户视频', async () => {
  const d = device(), s = d.service(); await s.load(); d.failStorage(true);
  await assert.rejects(d.importOne(s), /本机空间不足/); assert.equal(s.current().videos.length, 0); assert.equal(d.files.size, 0);
  d.failStorage(false); await d.importOne(s);
  d.cloud = emptyState('another-synthetic-owner'); await s.load(); assert.equal(s.current().videos.length, 0);
});
test('云端删除账户后重开，清理当前设备副本并保留服务器待删除状态', async () => {
  const d = device(), s = d.service(); await s.load(); await d.importOne(s);
  d.cloud = { ...emptyState(d.cloud.ownerId), accountDeleting: true };
  await s.load(); assert.equal(s.current().videos.length, 0); assert.equal(s.current().accountDeleting, true); assert.equal(d.files.size, 0);
});
test('云端分批删除自动推进，小账户完成；大账户保留有界重试', async () => {
  for (const passes of [3, 9]) {
    const d = device(), s = d.service(); d.cloud = { ...emptyState('alice'), accountDeleting: true }; d.deferDeletion(passes);
    await s.load(); await s.cleanupVideos();
    assert.equal(d.cleanupCalls, Math.min(6, passes)); assert.equal(s.current().accountDeleting, passes > 6);
    if (passes > 6) { await s.cleanupVideos(); assert.equal(d.cleanupCalls, passes); assert.equal(s.current().accountDeleting, false); }
  }
});
