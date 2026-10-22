import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildSync } from 'esbuild';
import { emptyState, PRIVACY_VERSION, State, Video } from '../src/shared/domain';
import { validateVideoMarker, videoTimeLabel, reviewMarkers, scopedReviewVideos } from '../src/shared/video-review';

const base = (id: string) => ({ _id: id, ownerId: 'device', createdAt: '2026-10-20T03:00:00.000Z', updatedAt: '2026-10-20T03:00:00.000Z', schemaVersion: 1 });
function state(): State {
  const s = emptyState('device'); s.consent.privacyVersion = PRIVACY_VERSION;
  s.gyms.push({ ...base('gym'), name: '合成测试馆', city: '上海', gradeSystem: 'V', notes: '' });
  s.projects = [{ ...base('project'), gymId: 'gym', routeLabel: '蓝线', gradeLabel: 'V2', gradeSystem: 'V', notes: '', status: 'active' }];
  for (let i = 1; i <= 2; i++) {
    s.sessions.push({ ...base(`s${i}`), gymId: 'gym', gymSnapshot: { name: '合成测试馆', city: '上海', gradeSystem: 'V' }, sessionDate: `2026-10-${19 + i}`, durationMinutes: 60, trainingNotes: '', feeling: '', perceivedEffort: null, version: 1 });
    s.attempts.push({ ...base(`a${i}`), sessionId: `s${i}`, routeLabel: '蓝线', gradeLabel: 'V2', gradeSystem: 'V', result: 'failed', ordinal: 1, notes: '', projectId: 'project' });
    s.videos.push({ ...base(`v${i}`), sessionId: `s${i}`, attemptId: `a${i}`, byteSize: 10000, durationSec: 25.5, status: 'ready', fileId: '', objectKey: '', localPath: `/test/v${i}.mp4`, reservationExpiresAt: '' });
  }
  s.videos.push({ ...s.videos[0], ...base('loose'), sessionId: null, attemptId: null });
  return s;
}

test('关键点支持零秒、小数与结尾；拒绝空值、越界和非有限时间', () => {
  assert.deepEqual(validateVideoMarker(25.5, '0', ' 起步 '), { timeSec: 0, note: '起步' });
  assert.deepEqual(validateVideoMarker(25.5, '12.25', '换脚'), { timeSec: 12.25, note: '换脚' });
  assert.equal(validateVideoMarker(25.5, 25.5, '到顶').timeSec, 25.5);
  for (const value of ['', ' ', null, undefined, NaN, Infinity, -1, 25.6, '12秒', '0x10', '1e1']) assert.throws(() => validateVideoMarker(25.5, value, '片段'), /时间/);
  assert.throws(() => validateVideoMarker(25.5, 1, '   '), /写一句/);
  assert.throws(() => validateVideoMarker(25.5, 1, '字'.repeat(121)), /120/);
  assert.equal(videoTimeLabel(59.96), '01:00.0'); assert.equal(videoTimeLabel(12.25), '00:12.3');
});

test('旧视频无关键点可正常打开，标记排序不修改原记录，异常项隔离', () => {
  assert.deepEqual(reviewMarkers({ durationSec: 20 }), []);
  const video = { durationSec: 20, marks: [ { id: 'later', timeSec: 12, note: '掉落' }, { id: 'start', timeSec: 0, note: '起步' }, { id: 'bad', timeSec: NaN, note: '异常' } ] };
  assert.deepEqual(reviewMarkers(video).map(m => m.id), ['start', 'later']);
  assert.equal(video.marks[0].id, 'later');
});

test('线路视频按有效线路和训练关联跨次汇集；删除、跨岩馆和其他用户不串线', () => {
  const s = state();
  assert.deepEqual(scopedReviewVideos(s, { projectId: 'project' }).map(v => v._id).sort(), ['v1', 'v2']);
  assert.deepEqual(scopedReviewVideos(s, { projectId: 'project', sessionId: 's1' }).map(v => v._id), ['v1']);
  assert.deepEqual(scopedReviewVideos(s, { unlinkedOnly: true }).map(v => v._id), ['loose']);
  s.sessions[1].gymId = 'other-gym'; assert.deepEqual(scopedReviewVideos(s, { projectId: 'project' }).map(v => v._id), ['v1']);
  s.videos[0].ownerId = 'other'; assert.deepEqual(scopedReviewVideos(s, { projectId: 'project' }), []);
  s.projects = []; assert.throws(() => scopedReviewVideos(s, { projectId: 'project' }), /已删除/);
});

function pageDevice(seed = state(), cloud = false) {
  const storage = new Map<string, any>([['panji.data.v1', structuredClone(seed)]]);
  if (cloud) storage.set('panji.mode.v1', 'cloud');
  const controls: { player: string; action: string; value?: number }[] = [], errors: string[] = [], toasts: string[] = [], scrolls: string[] = [];
  const videoRequests: { id: string; resolve: (url: string) => void; reject: (message: string) => void }[] = [], cloudCalls: string[] = [];
  const wx: any = {
    getStorageSync: (key: string) => structuredClone(storage.get(key) || ''),
    setStorageSync: (key: string, value: any) => storage.set(key, structuredClone(value)),
    showToast: ({ title }: any) => toasts.push(title), showModal: async ({ content }: any) => { errors.push(content); return { confirm: true }; },
    pageScrollTo: ({ selector }: any) => scrolls.push(selector),
    createVideoContext: (player: string) => ({ pause: () => controls.push({ player, action: 'pause' }),
      seek: (value: number) => controls.push({ player, action: 'seek', value }), playbackRate: (value: number) => controls.push({ player, action: 'rate', value }) }),
    cloud: { init: () => undefined, callFunction: async ({ data }: any) => {
      cloudCalls.push(data.action);
      if (data.action === 'account.get') return { result: { ok: true, data: { state: structuredClone(storage.get('panji.data.v1')), capabilities: {} } } };
      if (data.action === 'video.play') return new Promise((resolve, reject) => videoRequests.push({ id: data.data.id,
        resolve: url => resolve({ result: { ok: true, data: { url } } }), reject: message => reject(new Error(message)) }));
      throw new Error('Unexpected cloud test action: ' + data.action);
    } },
  };
  let p: any;
  const bundle = buildSync({ entryPoints: ['src/miniprogram/pages/videos/index.ts'], bundle: true, write: false, platform: 'neutral', format: 'cjs', target: 'es2018', define: { PANJI_CLOUD_ENV: cloud ? '"test-environment"' : '""' } }).outputFiles[0].text;
  vm.runInNewContext(bundle, { wx, Page: (definition: any) => { p = definition; }, console, setTimeout, clearTimeout, exports: {}, module: { exports: {} } });
  p.data = structuredClone(p.data);
  p.setData = (values: Record<string, any>, callback?: () => void) => {
    for (const [key, value] of Object.entries(values)) {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.'); let target = p.data;
      for (const part of parts.slice(0, -1)) target = target[part]; target[parts[parts.length - 1]!] = structuredClone(value);
    }
    callback?.();
  };
  return { p, storage, controls, errors, toasts, scrolls, videoRequests, cloudCalls, saved: () => storage.get('panji.data.v1') as State };
}
const tap = (data: Record<string, unknown>) => ({ currentTarget: { dataset: data } });

test('真实视频页添加、修改、定位和删除标记；无效输入保留草稿，重开仍可读取', async () => {
  const d = pageDevice(), p = d.p; p.onLoad({}); await p.onShow(); await p.play(tap({ id: 'v1' }));
  p.timeUpdate({ detail: { currentTime: 12.25 } }); p.addMarker();
  assert.equal(p.data.markerTime, '12.3'); assert.equal(d.controls[d.controls.length - 1]?.action, 'pause');
  p.markerField({ ...tap({ field: 'markerTime' }), detail: { value: '99' } });
  p.quickMarker(tap({ note: '换脚更稳' })); await p.saveMarker();
  assert.equal(d.saved().videos[0].marks, undefined); assert.equal(p.data.markerVideoId, 'v1'); assert.match(d.errors[d.errors.length - 1] || '', /时间/);
  p.markerField({ ...tap({ field: 'markerTime' }), detail: { value: '12.3' } });
  await Promise.all([p.saveMarker(), p.saveMarker()]);
  assert.equal(d.saved().videos[0].marks?.length, 1); const marker = d.saved().videos[0].marks![0];
  p.seekMarker(tap({ id: marker.id })); assert.deepEqual(d.controls[d.controls.length - 1], { player: 'panji-main-video', action: 'seek', value: 12.3 });
  p.editMarker(tap({ id: marker.id })); p.quickMarker(tap({ note: '提前转髋后换脚更稳' })); await p.saveMarker();
  assert.equal(d.saved().videos[0].marks?.length, 1); assert.equal(d.saved().videos[0].marks![0].id, marker.id);
  assert.equal(d.saved().videos[0].marks![0].note, '提前转髋后换脚更稳');
  const reopened = pageDevice(d.saved()); reopened.p.onLoad({}); await reopened.p.onShow();
  assert.equal(reopened.p.data.videos.find((v: Video) => v._id === 'v1').marks.length, 1);
  await p.removeMarker(tap({ id: marker.id })); assert.equal(d.saved().videos[0].marks?.length, 0);
  assert.equal(d.saved().videos[0].status, 'ready');
});

test('真实页面倍速和双视频独立控制调用原生播放器；取消与离开会关闭播放器', async () => {
  const d = pageDevice(), p = d.p; p.onLoad({ projectId: 'project' }); await p.onShow();
  assert.equal(p.data.videos.length, 2); assert.match(p.data.importHint, /2026-10-21/);
  await p.play(tap({ id: 'v1' })); p.rate(tap({ rate: 0.5 }));
  assert.deepEqual(d.controls[d.controls.length - 1], { player: 'panji-main-video', action: 'rate', value: 0.5 });
  p.toggleCompare(tap({ id: 'v1' })); p.toggleCompare(tap({ id: 'v2' })); await p.startCompare();
  assert.equal(p.data.compareOpen, true); assert.equal(p.data.playingId, '');
  assert.deepEqual(Array.from(p.data.compareItems, (x: any) => x.url), ['/test/v1.mp4', '/test/v2.mp4']);
  p.rate(tap({ slot: 1, rate: 0.8 })); assert.deepEqual(d.controls[d.controls.length - 1], { player: 'panji-compare-1', action: 'rate', value: 0.8 });
  assert.equal(p.data.compareItems[0].rate, 1); assert.equal(p.data.compareItems[1].rate, 0.8);
  p.seekCompare(tap({ slot: 0, time: 8.5 })); assert.deepEqual(d.controls[d.controls.length - 1], { player: 'panji-compare-0', action: 'seek', value: 8.5 });
  p.clearCompare(); assert.equal(p.data.compareOpen, false); assert.equal(p.data.compareIds.length, 0);
  await p.play(tap({ id: 'v1' })); p.onHide(); assert.equal(p.data.playingId, ''); assert.equal(p.data.compareItems.length, 0);
});

test('连续打开云端旧视频时，仅最后选择生效；离开后地址或错误返回均不重开播放器', async () => {
  const d = pageDevice(state(), true), p = d.p; p.onLoad({}); await p.onShow();
  const first = p.play(tap({ id: 'v1' })), second = p.play(tap({ id: 'v2' }));
  d.videoRequests[1].resolve('https://test.invalid/v2'); await second;
  d.videoRequests[0].resolve('https://test.invalid/v1'); await first;
  assert.equal(p.data.playingId, 'v2'); assert.equal(p.data.playingUrl, 'https://test.invalid/v2');
  const hidden = p.play(tap({ id: 'v1' })); p.onHide();
  d.videoRequests[2].resolve('https://test.invalid/hidden'); await hidden;
  assert.equal(p.data.playingId, ''); assert.equal(p.data.playingUrl, '');
  await p.onShow(); const unloaded = p.play(tap({ id: 'v1' })); p.onUnload();
  d.videoRequests[3].reject('Delayed network error'); await unloaded;
  assert.equal(p.data.playingId, ''); assert.equal(d.errors.length, 0);
});

test('对比请求尚未完成时清空、换片或离开，延迟结果不会恢复旧选择或播放器', async () => {
  for (const change of ['clear', 'selection', 'hide', 'unload'] as const) {
    const d = pageDevice(state(), true), p = d.p; p.onLoad({}); await p.onShow();
    p.toggleCompare(tap({ id: 'v1' })); p.toggleCompare(tap({ id: 'v2' }));
    const pending = p.startCompare(); assert.equal(p.data.comparing, true);
    if (change === 'clear') p.clearCompare();
    else if (change === 'selection') p.toggleCompare(tap({ id: 'v2' }));
    else if (change === 'hide') p.onHide();
    else p.onUnload();
    d.videoRequests[0].resolve('https://test.invalid/v1'); d.videoRequests[1].resolve('https://test.invalid/v2'); await pending;
    assert.equal(p.data.compareOpen, false, change); assert.equal(p.data.compareItems.length, 0, change);
    assert.equal(p.data.comparing, false, change); assert.equal(d.errors.length, 0, change);
  }
});

test('旧对比请求结束不解除新请求的忙碌状态；最终仅显示新请求的结果', async () => {
  const d = pageDevice(state(), true), p = d.p; p.onLoad({}); await p.onShow();
  p.toggleCompare(tap({ id: 'v1' })); p.toggleCompare(tap({ id: 'v2' })); const older = p.startCompare();
  p.clearCompare(); p.toggleCompare(tap({ id: 'v2' })); p.toggleCompare(tap({ id: 'v1' })); const newer = p.startCompare();
  d.videoRequests[0].resolve('https://test.invalid/old-v1'); d.videoRequests[1].resolve('https://test.invalid/old-v2'); await older;
  assert.equal(p.data.comparing, true); assert.equal(p.data.compareOpen, false);
  d.videoRequests[2].resolve('https://test.invalid/new-v2'); d.videoRequests[3].resolve('https://test.invalid/new-v1'); await newer;
  assert.equal(p.data.comparing, false); assert.equal(p.data.compareOpen, true);
  assert.deepEqual(Array.from(p.data.compareItems, (item: any) => item._id), ['v2', 'v1']);
  assert.deepEqual(Array.from(p.data.compareItems, (item: any) => item.url), ['https://test.invalid/new-v2', 'https://test.invalid/new-v1']);
});

test('训练和线路范围忽略冲突的待整理参数；全库仍可只查看未关联视频', async () => {
  for (const query of [{ sessionId: 's1', unlinked: '1' }, { projectId: 'project', unlinked: '1' }]) {
    const d = pageDevice(), p = d.p; p.onLoad(query); await p.onShow();
    assert.equal(p.data.scoped, true); assert.equal(p.data.unlinkedOnly, false);
    assert.equal(p.data.videos.length, query.sessionId ? 1 : 2);
    p.toggle(); assert.equal(p.data.unlinkedOnly, false);
  }
  const d = pageDevice(), p = d.p; p.onLoad({ unlinked: '1' }); await p.onShow();
  assert.equal(p.data.scoped, false); assert.equal(p.data.unlinkedOnly, true);
  assert.deepEqual(Array.from(p.data.videos, (video: Video) => video._id), ['loose']);
});

test('从相册或裁剪返回时上传中的页面不重新加载账户，导入完成后正常刷新', async () => {
  const d = pageDevice(state(), true), p = d.p; p.onLoad({}); await p.onShow();
  assert.equal(d.cloudCalls.filter(action => action === 'account.get').length, 1);
  p.setData({ uploading: true, progress: 35 }); p.onHide(); await p.onShow();
  assert.equal(d.cloudCalls.filter(action => action === 'account.get').length, 1);
  assert.equal(p.data.uploading, true); assert.equal(p.data.progress, 35); assert.equal(p.data.loading, false);
  p.setData({ uploading: false }); await p.onShow();
  assert.equal(d.cloudCalls.filter(action => action === 'account.get').length, 2);
});

test('从训练进入视频工具时直接展开指定视频并滚到卡片，仅首次进入聚焦', async () => {
  const d = pageDevice(), p = d.p; p.onLoad({ sessionId: 's2', videoId: 'v2' }); await p.onShow();
  assert.equal(p.data.playingId, 'v2'); assert.equal(p.data.playingUrl, '/test/v2.mp4');
  assert.deepEqual(d.scrolls, ['#video-card-v2']); assert.equal(p.pendingVideoId, '');
  p.rate(tap({ rate: 0.5 })); await p.reload();
  assert.equal(p.data.playbackRate, 0.5); assert.deepEqual(d.scrolls, ['#video-card-v2']);
  p.onHide(); await p.onShow(); assert.equal(p.data.playingId, ''); assert.deepEqual(d.scrolls, ['#video-card-v2']);
});

test('指定视频必须在当前训练或项目范围内且为本人可回看状态；无效链接不取地址或强行展开', async () => {
  const cases: { query: Record<string, string>; alter?: (s: State) => void }[] = [
    { query: { sessionId: 's1', videoId: 'v2' } },
    { query: { projectId: 'project', videoId: 'loose' } },
    { query: { unlinked: '1', videoId: 'v1' } },
    { query: { videoId: 'v1' }, alter: s => { s.videos[0].ownerId = 'other'; } },
    { query: { videoId: 'v1' }, alter: s => { s.videos[0].status = 'reserved'; } },
    { query: { videoId: 'v1' }, alter: s => { s.videos[0].status = 'deleting'; } },
    { query: { videoId: 'missing' } },
    { query: { projectId: 'missing', videoId: 'v1' } },
  ];
  for (const sample of cases) {
    const s = state(); sample.alter?.(s); const d = pageDevice(s, true), p = d.p;
    p.onLoad(sample.query); await p.onShow();
    assert.equal(p.data.playingId, '', JSON.stringify(sample.query));
    assert.equal(d.videoRequests.length, 0); assert.equal(d.scrolls.length, 0);
  }
});

test('入口聚焦云视频请求未完成时离开、清空对比或手动换片，延迟返回不抢回焦点', async () => {
  for (const change of ['hide', 'unload', 'clear', 'manual'] as const) {
    const d = pageDevice(state(), true), p = d.p;
    p.onLoad({ videoId: 'v1' }); const showing = p.onShow();
    for (let pass = 0; pass < 8; pass++) await Promise.resolve();
    assert.equal(d.videoRequests[0]?.id, 'v1');
    let manual: Promise<void> | undefined;
    if (change === 'hide') p.onHide();
    else if (change === 'unload') p.onUnload();
    else if (change === 'clear') p.clearCompare();
    else manual = p.play(tap({ id: 'v2' }));
    d.videoRequests[0].resolve('https://test.invalid/stale-focus'); await showing;
    assert.equal(p.data.playingId, ''); assert.deepEqual(d.scrolls, []);
    if (manual) {
      d.videoRequests[1].resolve('https://test.invalid/manual'); await manual;
      assert.equal(p.data.playingId, 'v2'); assert.deepEqual(d.scrolls, []);
    }
    assert.equal(p.pendingVideoId, '');
  }
});
