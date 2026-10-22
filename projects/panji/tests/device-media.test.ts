import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyDeviceMedia, mergeDeviceMedia, executeDeviceMedia } from '../src/shared/device-media';
import { emptyState, exportData, Video } from '../src/shared/domain';
import { fixture, dispatch, context } from './fixtures';

function reserved() {
  const cloud = fixture(), journal = emptyDeviceMedia(cloud.ownerId);
  const command = { action: 'video.reserve', requestId: 'device_reserve_01', data: { sessionId: cloud.sessions[0]._id, byteSize: 1000, durationSec: 10 } };
  return { cloud, command, ...executeDeviceMedia(cloud, journal, command, context()) };
}
test('设备视频合并重读、预约重放不重复创建，云端原始记录不变', () => {
  const first = reserved(); const video = first.value as Video;
  assert.equal(video.localOnly, true); assert.equal(first.cloud.videos.length, 0);
  const merged = mergeDeviceMedia(first.cloud, first.journal);
  const replay = executeDeviceMedia(merged.state, merged.journal, first.command, context());
  assert.equal(replay.state.videos.length, 1); assert.equal((replay.value as Video)._id, video._id);
  assert.equal(mergeDeviceMedia(first.cloud, emptyDeviceMedia(first.cloud.ownerId)).state.videos.length, 0);
  assert.throws(() => mergeDeviceMedia(emptyState('bob'), first.journal), /无法读取/);
});
test('其他设备删除训练或尝试后，本机视频保留且解除失效关联', () => {
  const first = reserved(), id = (first.value as Video)._id;
  const ready = executeDeviceMedia(first.state, first.journal, { action: 'video.ready', requestId: 'device_ready_01', data: { id, localPath: '/device/video.mp4' } }, context());
  const linked = executeDeviceMedia(ready.state, ready.journal, { action: 'video.link', requestId: 'device_link_01', data: { id, sessionId: first.cloud.sessions[0]._id, attemptId: first.cloud.attempts[0]._id } }, context());
  const noAttempt = dispatch(first.cloud, 'attempt.delete', { id: first.cloud.attempts[0]._id }).state;
  assert.equal(mergeDeviceMedia(noAttempt, linked.journal).state.videos[0].attemptId, null);
  const noSession = dispatch(noAttempt, 'session.delete', { id: first.cloud.sessions[0]._id }).state;
  const merged = mergeDeviceMedia(noSession, linked.journal);
  assert.equal(merged.state.videos[0].sessionId, null); assert.equal(merged.state.videos[0].status, 'ready');
  assert.ok(!JSON.stringify(exportData(merged.state)).includes('/device/'));
});
test('设备操作不得修改云端视频；设备清理不能解除云端删除状态', () => {
  const first = reserved(), id = (first.value as Video)._id;
  assert.throws(() => executeDeviceMedia(first.state, emptyDeviceMedia('alice'), { action: 'video.delete', requestId: 'remote_delete_01', data: { id } }, context()), /不属于当前设备/);
  const deleting = mergeDeviceMedia({ ...emptyState('alice'), accountDeleting: true }, first.journal);
  assert.equal(deleting.state.videos[0].status, 'deleting'); assert.equal(deleting.journal.operations.length, 0);
  const purged = executeDeviceMedia(deleting.state, deleting.journal, { action: 'video.purged', requestId: 'device_purged_01', data: { id } }, context());
  assert.equal(purged.state.videos.length, 0); assert.equal(purged.state.accountDeleting, true);
});
