import { config } from '../../config';
import { State, emptyState, execute, todayShanghai, PRIVACY_VERSION, Video } from '../../shared/domain';
import { DeviceMedia, emptyDeviceMedia, validateDeviceMedia, mergeDeviceMedia, executeDeviceMedia } from '../../shared/device-media';
import { prepareVideo } from './video-preparation';
import { releaseLabel } from './release';

declare const PANJI_CLOUD_ENV: string;
const ENV = typeof PANJI_CLOUD_ENV === 'string' ? PANJI_CLOUD_ENV : '';
const KEY = 'panji.data.v1';
const MODE = 'panji.mode.v1';
type Mode = 'local' | 'cloud';
export interface Capabilities { aiAvailable: boolean; provider: string; model: string; privacyUrl: string; retention: string; uploadsAvailable?: boolean }
let state: State | null = null;
let capabilities: Capabilities = { aiAvailable: false, provider: '', model: '', privacyUrl: '', retention: '' };
let chain: Promise<unknown> = Promise.resolve();
let cloudReady = false;
export function id(prefix = 'req'): string { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`; }
export function mode(): Mode { return ENV && wx.getStorageSync(MODE) === 'cloud' ? 'cloud' : 'local'; }
export function configured(): boolean { return !!ENV; }
export function caps(): Capabilities { return capabilities; }
export function current(): State { if (!state) throw new Error('记录尚未载入'); return state; }
export function today(): string { return todayShanghai(); }
export function isCloud(): boolean { return mode() === 'cloud'; }
export async function processReview(reviewId: string): Promise<void> {
  if (isCloud()) await rpc('review.process', { id: reviewId });
}
function mediaKey(ownerId: string): string { return `panji.deviceVideos.${ownerId}.v1`; }
function readDeviceMedia(ownerId: string): DeviceMedia {
  const journal = wx.getStorageSync(mediaKey(ownerId)) || emptyDeviceMedia(ownerId);
  validateDeviceMedia(journal, ownerId); return journal;
}
function saveDeviceMedia(journal: DeviceMedia): void {
  try { wx.setStorageSync(mediaKey(journal.ownerId), journal); }
  catch { throw new Error('本机空间不足，视频信息未保存，请先导出记录并清理空间'); }
}
function mergeCloudState(cloud: State): State {
  const before = readDeviceMedia(cloud.ownerId);
  const result = mergeDeviceMedia(cloud, before);
  if (JSON.stringify(before) !== JSON.stringify(result.journal)) saveDeviceMedia(result.journal);
  return result.state;
}
function deviceVideoCommand(action: string, data: Record<string, unknown>, requestId: string): any {
  const before = current();
  const result = executeDeviceMedia(before, readDeviceMedia(before.ownerId), { action, data, requestId },
    { ownerId: before.ownerId, now: new Date().toISOString(), newId: id, aiEnabled: false });
  saveDeviceMedia(result.journal); state = result.state; return result.value;
}
async function unlinkDeviceFile(video: Video): Promise<void> {
  const filePath = `${wx.env.USER_DATA_PATH}/panji-video-${video._id}.mp4`;
  try { await new Promise<void>((resolve, reject) => wx.getFileSystemManager().unlink({ filePath, success: () => resolve(), fail: reject })); }
  catch (error) { if (!/no such file|not exist|ENOENT/i.test((error as { errMsg?: string }).errMsg || '')) throw error; }
}
async function rpc(action: string, data: Record<string, unknown> = {}, requestId = id()): Promise<any> {
  if (!cloudReady) { wx.cloud.init({ env: ENV, traceUser: false }); cloudReady = true; }
  const response = await wx.cloud.callFunction({ name: config.cloudFunction, data: { action, data, requestId } });
  const result = response.result as { ok: boolean; data: unknown; error?: { message: string; code: string } };
  if (!result || !result.ok) {
    const error = new Error(result?.error?.message || '云端暂时无法连接，请稍后重试') as Error & { code: string };
    error.code = result?.error?.code || 'NETWORK_ERROR'; throw error;
  }
  return result.data;
}
export async function load(): Promise<State> {
  if (mode() === 'cloud') {
    const data = await rpc('account.get'); state = mergeCloudState(data.state); capabilities = data.capabilities;
    if (!state.consent.privacyVersion) {
      for (const video of [...state.videos].filter(v => v.localOnly && v.status === 'deleting')) {
        try { await unlinkDeviceFile(video); deviceVideoCommand('video.purged', { id: video._id }, id('purge')); }
        catch { /* Keep a visible cleanup marker if a device file cannot be removed. */ }
      }
    }
  } else {
    const raw = wx.getStorageSync(KEY);
    if (raw) {
      if (raw.schemaVersion !== 1 || !Array.isArray(raw.sessions) || !Array.isArray(raw.gyms)) throw new Error('本机数据格式需要升级，请先导出并联系维护者，暂不覆盖原记录');
      state = raw as State;
    } else state = emptyState('device');
    capabilities = { aiAvailable: false, provider: '', model: '', privacyUrl: '', retention: '' };
  }
  return current();
}
export async function command(action: string, data: Record<string, unknown>, requestId = id()): Promise<any> {
  const run = async () => {
    if (isCloud()) {
      const deviceVideo = action === 'video.reserve' || (action.startsWith('video.') && current().videos.some(v => v._id === data.id && v.localOnly));
      if (deviceVideo) return deviceVideoCommand(action, data, requestId);
      const linked = action === 'session.delete' && data.deleteVideos === true ? current().videos.filter(v => v.localOnly && v.sessionId === data.id).map(v => v._id) : [];
      const result = await rpc(action, data, requestId);
      if (linked.length) {
        const journal = readDeviceMedia(result.state.ownerId);
        for (const v of journal.videos.filter(v => linked.includes(v._id))) v.status = 'deleting';
        saveDeviceMedia(journal);
      }
      state = mergeCloudState(result.state); return result.value;
    }
    const raw = wx.getStorageSync(KEY) as State || emptyState('device');
    const next = execute(raw, { action, data, requestId }, { ownerId: 'device', now: new Date().toISOString(), newId: id,
      trustedMedia: action === 'video.ready' || action === 'video.purged', aiEnabled: false });
    try { wx.setStorageSync(KEY, next.state); } catch { throw new Error('本机空间不足，记录未保存。请先导出数据并清理空间'); }
    state = next.state; return next.value;
  };
  const result = chain.then(run, run); chain = result.catch(() => undefined); return result;
}
export async function setMode(next: Mode): Promise<void> {
  if (next === 'cloud') { if (!ENV) throw new Error('请先配置小程序 AppID 和云环境'); await rpc('account.get'); }
  wx.setStorageSync(MODE, next); state = null; await load();
}
export async function consent(privacy: boolean, ai?: boolean): Promise<void> {
  await command('privacy.set', { privacy, ...(typeof ai === 'boolean' ? { ai } : {}) });
}
export function errorMessage(error: unknown): string {
  const e = error as { message?: string; errMsg?: string };
  const raw = e?.message || e?.errMsg || '';
  if (/api scope is not declared in the privacy agreement/i.test(raw)) return '视频导入暂时不可用，小程序的相册隐私声明尚未生效。训练记录已保留，可继续记录。';
  if (/privacy permission is not authorized|privacy authorization|requirePrivacyAuthorize:fail/i.test(raw)) return '尚未同意微信隐私指引。可稍后再次选择视频，训练记录已保留。';
  if (/cancel/.test(raw)) return '';
  if (/(?:openVideoEditor|compressVideo):fail.*(?:not support|not available|not implement)/i.test(raw)) return '当前微信环境不支持此视频处理，请先在手机相册裁剪或压缩后重新导入。';
  if (/maximum.*size|exceed.*(?:storage|quota)|no space|ENOSPC|storage.*(?:full|limit)/i.test(raw)) return '本机可用空间不足，请先清理攀迹中的旧视频后重试；相册原片不会删除。';
  if (/saveFile:fail.*(?:not exist|not found|no such file)/i.test(raw)) return '视频临时文件已失效，请重新从相册选择；云端相册中的视频请先下载到手机。';
  return e?.message || e?.errMsg || '操作未完成，请重试';
}
export function notify(error: unknown, context?: 'video'): void {
  const message = errorMessage(error);
  if (message) {const diagnostic=context==='video'?wx.getStorageSync('panji.videoImportDiagnostics.v1'):null;
    wx.showModal({ title: context === 'video' ? '视频未能导入' : '这一步还没完成', content: message+(context==='video'?`\n\n版本 ${releaseLabel}${diagnostic?.stage?' · '+diagnostic.stage:''}`:''), showCancel: false });}
}
export function toast(title: string): void { wx.showToast({ title, icon: 'none' }); }
export async function confirm(title: string, content: string, confirmText = '确定'): Promise<boolean> {
  return (await wx.showModal({ title, content, confirmText, confirmColor: '#1e5147' })).confirm;
}
export async function withLoading<T>(label: string, task: () => Promise<T>): Promise<T> {
  wx.showLoading({ title: label, mask: true }); try { return await task(); } finally { wx.hideLoading(); }
}
export async function ensurePrivacy(): Promise<boolean> {
  if (current().consent.privacyVersion === PRIVACY_VERSION) return true;
  const accepted = await confirm('开始记录你的攀岩', '攀迹保存你主动填写的训练、岩馆和目标。本机模式仅存于当前微信设备，清理缓存可能丢失；云端模式按微信身份保存。视频仅供本人回看，不发送给 AI。隐私说明可随时在“我的”查看。', '同意记录');
  if (accepted) await consent(true); return accepted;
}
export async function cleanupVideos(): Promise<void> {
  // Device files do not depend on the availability of the cloud storage service.
  // Only contact that service when cloud files/account deletion actually need it.
  if (isCloud() && (current().accountDeleting || current().videos.some(v => !v.localOnly))) {
    // Each server pass removes one collection batch. Finish small deletions in
    // the foreground, with a bound so large accounts still offer a retry.
    for (let pass = 0; pass < 6; pass++) {
      await rpc('video.cleanup'); await load();
      if (!current().accountDeleting) break;
    }
  }
  const videos = [...current().videos];
  for (const video of videos) {
    if (isCloud() && !video.localOnly) continue;
    const expired = video.status === 'reserved' && video.reservationExpiresAt < new Date().toISOString();
    if (video.status !== 'deleting' && !expired) continue;
    try { await unlinkDeviceFile(video); } catch { continue; }
    await command('video.purged', { id: video._id });
  }
}
export async function importVideo(sessionId: string | null, attemptId: string | null, progress: (n: number) => void, options?: {edit?:boolean}): Promise<void> {
  let stage='选择视频';
  let diagnosticMetadata: {byteSize:number;durationSec:number}|undefined;
  const diagnostic=(message:string,code='')=>{try{wx.setStorageSync('panji.videoImportDiagnostics.v1',{release:releaseLabel,stage,message,code,...diagnosticMetadata});}catch{/* Do not replace the real import error. */}};
  try {
  if (!(await ensurePrivacy())) return;
  if (typeof wx.requirePrivacyAuthorize === 'function') await new Promise<void>((resolve, reject) => wx.requirePrivacyAuthorize({ success: () => resolve(), fail: reject }));
  const selected = await wx.chooseMedia({ count: 1, mediaType: ['video'], sourceType: ['album'] });
  const file = selected.tempFiles?.[0];
  if (!file) return;
  stage='读取视频信息';
  const metadata = await prepareVideo(file, options?.edit); if(!metadata)return;
  diagnosticMetadata={byteSize:metadata.byteSize,durationSec:metadata.durationSec};
  stage='确认保存';
  if (!(await confirm('保存这段视频？', `${metadata.durationSec.toFixed(1)} 秒 · ${(metadata.byteSize / 1024 / 1024).toFixed(1)} MB\n版本 ${releaseLabel}\n\n视频仅保存在当前微信设备，换手机或清理缓存可能丢失；训练记录按当前记录位置保存。请确认拍摄内容已获同意。视频不会上传或发送给 AI。`, '确认保存'))) return;
  let reservation: Video | null = null;
  let savedPath = '';
  try {
    stage='登记视频';
    reservation = await command('video.reserve', { sessionId, byteSize: metadata.byteSize, durationSec: metadata.durationSec });
    // A repeated reservation response is resolved from the refreshed state by its ID.
    reservation = current().videos.find(v => v._id === reservation!._id)!;
    stage='保存文件';
    savedPath = await new Promise<string>((resolve, reject) => wx.getFileSystemManager().saveFile({ tempFilePath: metadata.filePath,
      filePath: `${wx.env.USER_DATA_PATH}/panji-video-${reservation!._id}.mp4`, success: res => resolve(res.savedFilePath), fail: reject }));
    stage='确认文件';await command('video.ready', { id: reservation._id, localPath: savedPath }); progress(100);
    if (attemptId) {stage='关联尝试';await command('video.link', { id: reservation._id, sessionId, attemptId });}
    stage='已保存';diagnostic('视频已保存');
    toast('视频已保存');
  } catch (error) {
    if (reservation) {
      // Uploaded files whose confirmation failed remain reserved for retry/cleanup;
      // never mark a potentially completed file as physically deleted.
      if (savedPath) {
        try { await command('video.ready', { id: reservation._id, localPath: savedPath }); } catch { /* Preserve file; cleanup can retry. */ }
      } else {
        try { await command('video.delete', { id: reservation._id }); await cleanupVideos(); } catch { /* Reservation will expire. */ }
      }
    }
    throw error;
  }
  }catch(error){if(errorMessage(error))diagnostic('视频导入未完成',(error as {code?:string}).code||'VIDEO_IMPORT_FAILED');throw error;}
}
export async function videoUrl(video: Video): Promise<string> {
  if (video.status !== 'ready') throw new Error('视频尚未完成保存');
  if (!isCloud() || video.localOnly) return video.localPath || '';
  const result = await rpc('video.play', { id: video._id }); return result.url;
}
export async function refreshReview(): Promise<void> { await load(); }
export const resultLabels: Record<string, string> = { completed: '完成', failed: '未完成', unknown: '未知' };
