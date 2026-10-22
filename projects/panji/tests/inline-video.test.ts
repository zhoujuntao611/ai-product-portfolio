import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildSync } from 'esbuild';
import { emptyState, PRIVACY_VERSION, State } from '../src/shared/domain';

const base = (id: string) => ({ _id: id, ownerId: 'device', createdAt: '2026-10-22T03:00:00.000Z', updatedAt: '2026-10-22T03:00:00.000Z', schemaVersion: 1 });
function seed(): State {
  const state = emptyState('device'); state.consent.privacyVersion = PRIVACY_VERSION;
  state.gyms.push({ ...base('gym'), name: '合成测试馆', city: '', gradeSystem: 'V', notes: '' });
  for (const id of ['session', 'another-session']) state.sessions.push({ ...base(id), gymId: 'gym', gymSnapshot: { name: '合成测试馆', city: '', gradeSystem: 'V' },
    sessionDate: '2026-10-22', durationMinutes: 60, trainingNotes: '', feeling: '', perceivedEffort: null, version: 1 });
  for (let index = 1; index <= 2; index++) state.attempts.push({ ...base('attempt-' + index), sessionId: 'session', routeLabel: '同名蓝线',
    gradeLabel: 'V3', gradeSystem: 'V', result: 'failed', ordinal: index, notes: '' });
  for (const [id, sessionId, attemptId] of [
    ['v1', 'session', 'attempt-1'], ['v2', 'session', 'attempt-2'], ['session-video', 'session', null],
    ['orphan', 'session', 'missing-attempt'], ['other-session', 'another-session', 'attempt-1'],
    ['reserved', 'session', 'attempt-1'], ['foreign', 'session', 'attempt-1'],
  ]) state.videos.push({ ...base(id!), sessionId: sessionId!, attemptId, byteSize: 100, durationSec: 125.5,
    status: id === 'reserved' ? 'reserved' : 'ready', fileId: '', objectKey: '', localPath: '/test/' + id + '.mp4', reservationExpiresAt: '',
    ownerId: id === 'foreign' ? 'other' : 'device' });
  return state;
}
const bundles = new Map<boolean, string>();
function device(state = seed(), cloud = false) {
  const storage = new Map<string, any>([['panji.data.v1', structuredClone(state)]]);
  if (cloud) storage.set('panji.mode.v1', 'cloud');
  const pauses: string[] = [], cloudCalls: string[] = [], navigation: string[] = [];
  const videoRequests: { id: string; resolve: (url: string) => void; reject: () => void }[] = [];
  let p: any;
  const wx: any = {
    env: { USER_DATA_PATH: '/device' },
    getStorageSync: (key: string) => structuredClone(storage.get(key) || ''),
    setStorageSync: (key: string, value: any) => storage.set(key, structuredClone(value)),
    showToast: () => undefined, showModal: async () => ({ confirm: true }),
    createVideoContext: (player: string) => ({ pause: () => pauses.push(player) }),
    navigateTo: ({ url }: any) => navigation.push(url), pageScrollTo: () => undefined,
    getFileSystemManager: () => ({ readFile: () => { throw new Error('Must not read video contents to render'); } }),
    cloud: { init: () => undefined, callFunction: async ({ data }: any) => {
      cloudCalls.push(data.action);
      if (data.action === 'account.get') return { result: { ok: true, data: { state: structuredClone(storage.get('panji.data.v1')), capabilities: {} } } };
      if (data.action === 'video.play') return new Promise((resolve, reject) => videoRequests.push({ id: data.data.id,
        resolve: url => resolve({ result: { ok: true, data: { url } } }), reject: () => reject(new Error('Network failed')) }));
      throw new Error('Unexpected cloud action: ' + data.action);
    } },
  };
  if (!bundles.has(cloud)) bundles.set(cloud, buildSync({ entryPoints: ['src/miniprogram/pages/session-detail/index.ts'], bundle: true, write: false,
    platform: 'neutral', format: 'cjs', target: 'es2018', define: { PANJI_CLOUD_ENV: cloud ? '"test-environment"' : '""' } }).outputFiles[0].text);
  vm.runInNewContext(bundles.get(cloud)!, { wx, Page: (definition: any) => { p = definition; }, console, exports: {}, module: { exports: {} } });
  p.data = structuredClone(p.data);
  p.setData = (values: Record<string, any>, callback?: () => void) => {
    for (const [key, value] of Object.entries(values)) {
      const parts = key.split('.'); let target = p.data;
      for (const part of parts.slice(0, -1)) target = target[part]; target[parts[parts.length - 1]] = structuredClone(value);
    }
    callback?.();
  };
  p.onLoad({ id: 'session' });
  return { p, wx, storage, pauses, cloudCalls, videoRequests, navigation, saved: () => storage.get('panji.data.v1') as State };
}
const tap = (id: string) => ({ currentTarget: { dataset: { id } } });
async function settle() { for (let pass = 0; pass < 8; pass++) await Promise.resolve(); }

test('训练内按明确尝试关联原地显示视频，同名线路、别次训练和其他用户不串线', async () => {
  const d = device(), p = d.p; await p.onShow();
  assert.equal(p.data.videoCount, 4); assert.equal(p.data.formOpen, false);
  assert.deepEqual(Array.from(p.data.attempts, (a: any) => [a._id, a.videos, a.clips.map((v: any) => v._id)]),
    [['attempt-1', 1, ['v1']], ['attempt-2', 1, ['v2']]]);
  assert.deepEqual(Array.from(p.data.sessionClips, (v: any) => v._id), ['session-video', 'orphan']);
  assert.equal(p.data.attempts[0].clips[0].url, '/test/v1.mp4');
  assert.equal(p.data.attempts[0].clips[0].playerId, 'inline-video-v1');
  assert.equal(p.data.attempts[0].clips[0].durationLabel, '2:05');
  assert.equal(d.cloudCalls.length, 0); assert.equal(d.navigation.length, 0);
});

test('原生播放事件暂停其他所有视频，离开和卸载暂停全部且不会跳页', async () => {
  const d = device(), p = d.p; await p.onShow(); d.pauses.length = 0;
  p.inlinePlay(tap('v1'));
  assert.deepEqual(d.pauses.sort(), ['inline-video-orphan', 'inline-video-session-video', 'inline-video-v2']);
  d.pauses.length = 0; p.inlinePlay(tap('v2')); assert.ok(d.pauses.includes('inline-video-v1'));
  d.pauses.length = 0; p.onHide(); assert.equal(d.pauses.length, 4); assert.equal(p.playingInlineId, '');
  d.pauses.length = 0; p.inlinePlay(tap('v1')); assert.equal(d.pauses.length, 4);
  await p.onShow(); d.pauses.length = 0; p.onUnload(); assert.equal(d.pauses.length, 4);
  assert.equal(d.navigation.length, 0);
});

test('原地视频工具入口携带具体视频并暂停播放；全库入口不强制指定视频', async () => {
  const d = device(), p = d.p; await p.onShow(); d.pauses.length = 0;
  p.videos(tap('v2'));
  assert.equal(d.navigation[0], '/pages/videos/index?sessionId=session&videoId=v2');
  assert.equal(d.pauses.length, 4);
  p.videos(tap('session-video'));
  assert.equal(d.navigation[1], '/pages/videos/index?sessionId=session&videoId=session-video');
  p.videos(); assert.equal(d.navigation[2], '/pages/videos/index?sessionId=session');
  p.videos(tap('other-session')); assert.equal(d.navigation[3], '/pages/videos/index?sessionId=session');
});

test('删除尝试保留的视频下移到整次训练；重新关联、解除关联和删视频后不残留', async () => {
  const d = device(), p = d.p; await p.onShow();
  await p.deleteAttempt(tap('attempt-1'));
  assert.equal(p.data.attempts.length, 1); assert.equal(p.data.videoCount, 4);
  assert.ok(p.data.sessionClips.some((v: any) => v._id === 'v1'));
  const after = structuredClone(d.saved());
  after.videos.find(v => v._id === 'session-video')!.attemptId = 'attempt-2';
  after.videos.find(v => v._id === 'v1')!.sessionId = null;
  after.videos.find(v => v._id === 'v2')!.status = 'deleting';
  d.storage.set('panji.data.v1', after); await p.onShow();
  assert.equal(p.data.videoCount, 2);
  assert.deepEqual(Array.from(p.data.attempts[0].clips, (v: any) => v._id), ['session-video']);
  assert.deepEqual(Array.from(p.data.sessionClips, (v: any) => v._id), ['orphan']);
  assert.ok(d.pauses.includes('inline-video-v2'));
});

test('云端旧视频异步取地址，旧重载和后台返回的地址或错误不能恢复旧播放器', async () => {
  const state = seed(); state.videos = state.videos.filter(v => ['v1', 'v2'].includes(v._id));
  const d = device(state, true), p = d.p; await p.onShow();
  assert.equal(p.data.attempts[0].clips[0].loading, true); assert.equal(p.data.attempts[0].clips[0].url, '');
  assert.equal(d.videoRequests.length, 2);
  await p.reload(); assert.equal(d.videoRequests.length, 4);
  d.videoRequests[2].resolve('https://test.invalid/current'); await settle();
  d.videoRequests[0].resolve('https://test.invalid/stale'); await settle();
  assert.equal(p.data.attempts[0].clips[0].url, 'https://test.invalid/current');
  d.videoRequests[1].reject(); await settle(); assert.equal(p.data.attempts[1].clips[0].error, '');
  p.onHide(); d.videoRequests[3].resolve('https://test.invalid/hidden'); await settle();
  assert.equal(p.data.attempts[1].clips[0].url, '');
  await p.onShow(); p.onUnload(); d.videoRequests[4].reject(); d.videoRequests[5].resolve('https://test.invalid/unloaded'); await settle();
  assert.equal(p.data.attempts[0].clips[0].url, ''); assert.equal(p.data.attempts[0].clips[0].error, '');
});

test('云端模式的本机视频直接用路径显示，不获取云端地址或读取大文件', async () => {
  const state = seed(); const video = { ...state.videos[0], _id: 'video_local', localOnly: true };
  state.videos = [];
  const d = device(state, true); d.storage.set('panji.deviceVideos.device.v1', { schemaVersion: 1, ownerId: 'device', videos: [video], operations: [] });
  await d.p.onShow(); assert.equal(d.p.data.videoCount, 1);
  assert.equal(d.p.data.attempts[0].clips[0].url, '/test/v1.mp4');
  assert.deepEqual(d.cloudCalls, ['account.get']); assert.equal(d.videoRequests.length, 0);
});

test('导入返回相册只刷新一次，新增视频立即出现在所属线路且不打开尝试表单', async () => {
  const state = seed(); state.videos = [];
  const d = device(state), p = d.p;
  const bytes = 80 * 1024 * 1024;
  d.wx.chooseMedia = async () => { p.onHide(); await p.onShow(); return { tempFiles: [{ tempFilePath: '/temp/two-minutes.mp4', fileType: 'video', size: bytes, duration: 120 }] }; };
  d.wx.getVideoInfo = async () => ({ duration: 120 });
  d.wx.getFileSystemManager = () => ({ stat: ({ success }: any) => success({ stats: { size: bytes } }),
    saveFile: ({ filePath, success }: any) => success({ savedFilePath: filePath }) });
  await p.onShow(); await p.video(tap('attempt-1'));
  assert.equal(p.data.uploading, false); assert.equal(p.data.videoCount, 1); assert.equal(p.data.formOpen, false);
  assert.equal(p.data.attempts[0].clips.length, 1); assert.equal(p.data.attempts[1].clips.length, 0);
  assert.equal(p.data.attempts[0].clips[0].durationLabel, '2:00');
  assert.match(p.data.attempts[0].clips[0].url, /^\/device\/panji-video-video_/);
});

test('播放失败可重试；训练删除后的刷新清空旧视频与计数', async () => {
  const d = device(), p = d.p; await p.onShow();
  p.inlineError(tap('v1')); assert.equal(p.data.attempts[0].clips[0].url, ''); assert.match(p.data.attempts[0].clips[0].error, /MP4/);
  await p.reload(); assert.equal(p.data.attempts[0].clips[0].url, '/test/v1.mp4');
  d.storage.set('panji.data.v1', { ...d.saved(), sessions: [] }); await p.onShow();
  assert.match(p.data.error, /不存在/); assert.equal(p.data.videoCount, 0); assert.equal(p.data.sessionClips.length, 0); assert.equal(p.data.attempts.length, 0);
});
