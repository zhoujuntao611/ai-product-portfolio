import { State, Video, Operation, Command, Context, execute, ensure } from './domain';

export interface DeviceMedia {
  schemaVersion: 1; ownerId: string; videos: Video[]; operations: Operation[];
}
export function emptyDeviceMedia(ownerId: string): DeviceMedia {
  return { schemaVersion: 1, ownerId, videos: [], operations: [] };
}
export function validateDeviceMedia(value: DeviceMedia, ownerId: string): void {
  ensure(value?.schemaVersion === 1 && value.ownerId === ownerId && Array.isArray(value.videos) && Array.isArray(value.operations),
    'DEVICE_MEDIA_INVALID', '本机视频信息无法读取，请先导出记录并联系维护者');
  ensure(value.videos.every(v => v.ownerId === ownerId && v.localOnly === true && /^video_[\w-]{1,100}$/.test(v._id)),
    'DEVICE_MEDIA_INVALID', '本机视频归属信息不匹配');
}
export function mergeDeviceMedia(cloud: State, original: DeviceMedia): { state: State; journal: DeviceMedia } {
  validateDeviceMedia(original, cloud.ownerId);
  const journal: DeviceMedia = JSON.parse(JSON.stringify(original));
  const reset = cloud.accountDeleting || !cloud.consent.privacyVersion;
  for (const video of journal.videos) {
    if (reset) { video.status = 'deleting'; video.sessionId = null; video.attemptId = null; video.marks = []; }
    else {
      if (video.sessionId && !cloud.sessions.some(s => s._id === video.sessionId)) video.sessionId = null;
      if (video.attemptId && !cloud.attempts.some(a => a._id === video.attemptId && a.sessionId === video.sessionId)) video.attemptId = null;
    }
  }
  if (reset) journal.operations = [];
  ensure(!cloud.videos.some(v => journal.videos.some(local => local._id === v._id)), 'DEVICE_MEDIA_INVALID', '视频编号冲突，请联系维护者');
  return { journal, state: { ...cloud, videos: [...cloud.videos, ...journal.videos], operations: [...cloud.operations, ...journal.operations].slice(-80) } };
}
export function executeDeviceMedia(state: State, journal: DeviceMedia, command: Command, context: Context) {
  validateDeviceMedia(journal, state.ownerId);
  ensure(['video.reserve','video.ready','video.link','video.mark','video.unmark','video.delete','video.purged'].includes(command.action), 'FORBIDDEN', '不支持的本机视频操作');
  if (command.action !== 'video.reserve') ensure(journal.videos.some(v => v._id === command.data.id), 'FORBIDDEN', '视频不属于当前设备');
  const result = execute(state, command, { ...context, trustedMedia: ['video.ready','video.purged'].includes(command.action) });
  // Device cleanup cannot finish a deletion that is still pending on the server.
  result.state.accountDeleting = state.accountDeleting;
  if (command.action === 'video.reserve') {
    const video = result.state.videos.find(v => v._id === (result.value as Video)._id)!;
    video.localOnly = true; (result.value as Video).localOnly = true;
  }
  const operationIds = new Set([...journal.operations.map(op => op.id), command.requestId]);
  const next: DeviceMedia = { ...journal, videos: result.state.videos.filter(v => v.localOnly),
    operations: result.state.operations.filter(op => operationIds.has(op.id)) };
  validateDeviceMedia(next, state.ownerId);
  return { ...result, journal: next };
}
