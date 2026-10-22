import type { State, Video } from './domain';
import { linkedProject } from './projects';

export interface VideoMarker { id: string; timeSec: number; note: string }
export const VIDEO_MARK_LIMIT = 30;
export const VIDEO_MARK_NOTE_MAX = 120;
// WeChat VideoContext supports 0.8 rather than 0.75.
export const VIDEO_PLAYBACK_RATES = [0.5, 0.8, 1, 1.25, 1.5, 2] as const;

export function videoTimeLabel(value: number): string {
  const tenths = Math.max(0, Math.round((Number.isFinite(value) ? value : 0) * 10));
  const minutes = Math.floor(tenths / 600), seconds = Math.floor(tenths / 10) % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths % 10}`;
}

export function validateVideoMarker(durationSec: number, rawTime: unknown, rawNote: unknown): { timeSec: number; note: string } {
  const validText = typeof rawTime === 'string' && /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(rawTime.trim());
  const timeSec = typeof rawTime === 'number' ? rawTime : validText ? Number((rawTime as string).trim()) : NaN;
  if (!Number.isFinite(durationSec) || durationSec <= 0 || !Number.isFinite(timeSec) || timeSec < 0 || timeSec > durationSec) {
    throw new Error('标记时间需在视频时长范围内，请填写秒数');
  }
  if (typeof rawNote !== 'string' || !rawNote.trim()) throw new Error('写一句这个片段值得注意的地方');
  const note = rawNote.trim();
  if (note.length > VIDEO_MARK_NOTE_MAX) throw new Error(`片段备注最多 ${VIDEO_MARK_NOTE_MAX} 字`);
  return { timeSec, note };
}

export function reviewMarkers(video: Pick<Video, 'durationSec' | 'marks'>): (VideoMarker & { timeLabel: string })[] {
  if (!Array.isArray(video.marks)) return [];
  return video.marks.filter(m => m && typeof m.id === 'string' && m.id.length > 0 &&
    Number.isFinite(m.timeSec) && m.timeSec >= 0 && m.timeSec <= video.durationSec && typeof m.note === 'string')
    .map(m => ({ ...m, timeLabel: videoTimeLabel(m.timeSec) })).sort((a, b) => a.timeSec - b.timeSec);
}

export function scopedReviewVideos(state: State, scope: { sessionId?: string; projectId?: string; unlinkedOnly?: boolean }): Video[] {
  if (scope.projectId && !(state.projects || []).some(p => p._id === scope.projectId && p.ownerId === state.ownerId)) throw new Error('这条线路项目已删除，请返回线路清单');
  const projectAttempts = scope.projectId ? new Map(state.attempts.filter(a => a.ownerId === state.ownerId && linkedProject(state, a)?._id === scope.projectId).map(a => [a._id, a.sessionId])) : null;
  return state.videos.filter(v => v.ownerId === state.ownerId && (!scope.sessionId || v.sessionId === scope.sessionId) &&
    (!scope.unlinkedOnly || !v.sessionId) && (!projectAttempts || (!!v.attemptId && projectAttempts.get(v.attemptId) === v.sessionId)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
