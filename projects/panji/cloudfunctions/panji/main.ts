import { randomBytes } from 'node:crypto';
import { State, Command, Context, DomainError, ensure, execute, Video, Review, publicState, PRIVACY_VERSION } from '../../src/shared/domain';
import { Repository, accountCollection } from './repository';
import { capabilities, generate } from './ai';
import { inspectMp4, readBoundedVideo, uploadSignatureExpiry } from './media';
import { invocationIdentity } from './identity';
import { catalogGym, catalogSummary, catalogUpdatedAt } from '../../src/shared/gym-catalog';
const cloud: any = require('wx-server-sdk');
const tcb: any = require('@cloudbase/node-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db: any = cloud.database();
const storage = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV });
const repo = new Repository(db);
const newId = (prefix: string) => prefix + '_' + randomBytes(16).toString('hex');
const allowed = new Set(['privacy.set', 'gym.save', 'gym.import', 'gym.archive', 'session.save', 'session.delete', 'attempt.save', 'attempt.delete',
  'project.save', 'project.status', 'project.delete', 'video.reserve', 'video.link', 'video.mark', 'video.unmark', 'video.delete', 'review.create', 'review.delete', 'review.feedback', 'goal.save', 'goal.followup', 'account.delete']);
function ctx(ownerId: string, extra: Partial<Context> = {}): Context { return { ownerId, now: new Date().toISOString(), newId, aiEnabled: capabilities().aiAvailable, ...extra }; }
async function mutate(ownerId: string, command: Command, extra: Partial<Context> = {}) {
  const before = await repo.read(ownerId); const result = execute(before, command, ctx(ownerId, extra));
  if (before.accountDeleting && command.action === 'video.purged') result.state.accountDeleting = true;
  if (command.action === 'video.reserve' && result.state !== before) {
    ensure(process.env.PANJI_UPLOADS_ENABLED === 'true', 'UPLOADS_DISABLED', '视频上传暂未开通，仍可记录训练');
    const v = result.value as Video;
    const metadata = await storage.getUploadMetadata({ cloudPath: v.objectKey });
    ensure(metadata.data?.fileId, 'UPLOAD_UNAVAILABLE', '无法创建上传位置');
    const saved = result.state.videos.find(x => x._id === v._id)!; saved.fileId = metadata.data.fileId;
    (result.value as Video).fileId = saved.fileId;
  }
  await repo.commit(before, result.state);
  return result;
}
function ownVideo(state: State, id: unknown): Video {
  const v = state.videos.find(v => v._id === id && v.ownerId === state.ownerId);
  ensure(v, 'NOT_FOUND', '视频不存在或无权访问'); return v;
}
async function signedUrl(fileId: string): Promise<string> {
  const response = await cloud.getTempFileURL({ fileList: [{ fileID: fileId, maxAge: 600 }] });
  const file = response.fileList?.[0];
  ensure(file?.status === 0 && file.tempFileURL, 'VIDEO_UNAVAILABLE', '视频尚不可用，请重新上传或稍后重试');
  return file.tempFileURL;
}
async function cleanup(ownerId: string): Promise<void> {
  await repo.deleteBusinessBatch(ownerId);
  const state = await repo.read(ownerId);
  const eligible = state.videos.filter(v => state.accountDeleting || v.status === 'deleting' || (v.status === 'reserved' && v.reservationExpiresAt < new Date().toISOString())).slice(0, 3);
  for (const v of eligible) {
    try {
      if (v.fileId) {
        const response = await cloud.deleteFile({ fileList: [v.fileId] });
        const file = response.fileList?.[0];
        ensure(file && (file.status === 0 || /not exist|not found/i.test(file.errMsg || '')), 'DELETE_RETRY', '视频删除仍需重试');
      }
      // A still-valid upload ticket can recreate an object. Keep the cleanup marker
      // and repeat deletion after its expiry before releasing the reserved quota.
      if (v.uploadExpiresAt && v.uploadExpiresAt > new Date().toISOString()) continue;
      await mutate(ownerId, { action: 'video.purged', requestId: newId('purge'), data: { id: v._id } }, { trustedMedia: true });
    } catch { /* Keep metadata and quota until physical deletion succeeds. No private data in logs. */ }
  }
  await repo.finishDeletion(ownerId);
}
async function work(ownerId: string, reviewId?: string): Promise<void> {
  if (!reviewId) await cleanup(ownerId);
  if (!capabilities().aiAvailable) return;
  const state = await repo.read(ownerId);
  const candidate = state.reviews.find(r => (!reviewId || r._id === reviewId) && r.mode === 'ai' && (r.status === 'queued' || (r.status === 'running' && (r.leaseUntil || '') < new Date().toISOString())));
  if (!candidate) return;
  let job: Review | null = null;
  try {
    const claimed = await mutate(ownerId, { action: 'review.claim', requestId: newId('claim'), data: { id: candidate._id } }, { trustedWorker: true }); job = claimed.value as Review;
    const result = await generate(job, async () => {
      const latest = await repo.read(ownerId);
      const active = latest.reviews.find(r => r._id === job!._id);
      ensure(!latest.accountDeleting && latest.consent.aiVersion === PRIVACY_VERSION && active?.status === 'running' && active.leaseUntil === job!.leaseUntil,
        'CONSENT_REQUIRED', '复盘授权或任务状态已更新，本次不再发送数据');
      ensure(job!.sourceVersions.every(v => latest.sessions.some(s => s._id === v.id && s.version === v.version)), 'VERSION_CONFLICT', '训练记录已修改，本次不再发送数据');
    });
    await mutate(ownerId, { action: 'review.result', requestId: newId('result'), data: { id: job._id, leaseUntil: job.leaseUntil, ...result } }, { trustedWorker: true });
  } catch (e) {
    if (job) {
      try { await mutate(ownerId, { action: 'review.fail', requestId: newId('failed'), data: { id: job._id, leaseUntil: job.leaseUntil,
        errorCode: e instanceof DomainError ? e.code : 'AI_UPSTREAM_ERROR',
        errorMessage: e instanceof DomainError ? e.message : '模型服务暂时未能完成请求' } }, { trustedWorker: true }); } catch { /* Next timer invocation reclaims an expired lease. */ }
    } else if (candidate.retryCount >= 3) {
      // Expired final leases must not spin forever.
      try { await mutate(ownerId, { action: 'review.fail', requestId: newId('failed'), data: { id: candidate._id, leaseUntil: candidate.leaseUntil, errorCode: 'AI_TIMEOUT' } }, { trustedWorker: true }); } catch { /* Retry safely. */ }
    }
  }
}
exports.main = async (event: any, context: any) => {
  try {
    const wxContext = invocationIdentity(tcb.parseContext(context));
    if (!wxContext.OPENID && event?.Type === 'Timer' && event.TriggerName === 'panji-maintenance') {
      // Only the platform timer/admin IAM identity may invoke this path. No public HTTP trigger.
      const accounts = await db.collection(accountCollection).where({ maintenance: true, nextMaintenanceAt: db.command.lte(new Date().toISOString()) }).orderBy('nextMaintenanceAt', 'asc').limit(2).get();
      for (const account of accounts.data) {
        try { await work(account.ownerId); }
        finally { await db.collection(accountCollection).doc(account.ownerId).update({ data: { nextMaintenanceAt: new Date(Date.now() + 60000).toISOString() } }); }
      }
      return { ok: true, data: { processed: accounts.data.length } };
    }
    ensure(typeof wxContext.OPENID === 'string' && wxContext.OPENID.length > 0, 'AUTH_REQUIRED', '请通过微信小程序访问');
    const ownerId = wxContext.OPENID;
    ensure(event && typeof event.action === 'string' && typeof event.data === 'object' && event.data !== null && !Array.isArray(event.data), 'VALIDATION_ERROR', '请求格式无效');
    ensure(JSON.stringify(event).length < 32000, 'VALIDATION_ERROR', '请求内容过长');
    const action = event.action; const data = event.data;
    // Public metadata only; lets deployed clients verify matching directory snapshots.
    if (action === 'catalog.get') return { ok:true,data:{updatedAt:catalogUpdatedAt,summary:catalogSummary(),entry:catalogGym(data.id)||null} };
    if (action === 'account.get') return { ok: true, data: { state: publicState(await repo.read(ownerId)), capabilities: {
      ...capabilities(), uploadsAvailable: process.env.PANJI_UPLOADS_ENABLED === 'true',
    } } };
    if (action === 'account.delete') {
      await repo.beginDeletion(ownerId, event.requestId);
      const state = publicState(await repo.read(ownerId));
      return { ok: true, data: { state, value: { deletionQueued: state.accountDeleting, pendingVideos: state.videos.length } } };
    }
    if (action === 'video.play') {
      const state = await repo.read(ownerId); const v = ownVideo(state, data.id);
      ensure(v.status === 'ready' && !state.accountDeleting, 'NOT_FOUND', '视频尚不可用或已删除');
      return { ok: true, data: { url: await signedUrl(v.fileId), requestedMaxAgeSeconds: 600 } };
    }
    if (action === 'video.cleanup') { await cleanup(ownerId); return { ok: true, data: { retried: true } }; }
    if (action === 'review.process') {
      ensure(capabilities().aiAvailable, 'AI_UNAVAILABLE', 'AI 复盘暂不可用');
      ensure(typeof data.id === 'string' && data.id.length <= 100, 'VALIDATION_ERROR', '复盘编号无效');
      const before = await repo.read(ownerId);
      ensure(before.reviews.some(r => r._id === data.id), 'NOT_FOUND', '复盘不存在或无权访问');
      await work(ownerId, data.id);
      return { ok: true, data: { state: publicState(await repo.read(ownerId)) } };
    }
    if (action === 'video.uploadTicket') {
      ensure(process.env.PANJI_UPLOADS_ENABLED === 'true', 'UPLOADS_DISABLED', '视频上传暂未开通');
      const before = await repo.read(ownerId); const v = ownVideo(before, data.id);
      ensure(!before.accountDeleting && v.status === 'reserved' && v.reservationExpiresAt > new Date().toISOString(), 'UPLOAD_EXPIRED', '上传预约已过期或取消');
      const response = await storage.getUploadMetadata({ cloudPath: v.objectKey }); const ticket = response.data;
      ensure(ticket?.fileId === v.fileId && typeof ticket.url === 'string' && ticket.url.startsWith('https://') && ticket.authorization && ticket.token && ticket.cosFileId,
        'UPLOAD_UNAVAILABLE', '无法取得指定文件的安全上传凭证');
      const expiresAt = uploadSignatureExpiry(ticket.authorization);
      const after: State = JSON.parse(JSON.stringify(before)); const reserved = after.videos.find(x => x._id === v._id)!;
      reserved.uploadExpiresAt = !reserved.uploadExpiresAt || expiresAt > reserved.uploadExpiresAt ? expiresAt : reserved.uploadExpiresAt;
      after.revision++; await repo.commit(before, after);
      return { ok: true, data: { url: ticket.url, fileId: ticket.fileId, key: v.objectKey,
        authorization: ticket.authorization, token: ticket.token, cosFileId: ticket.cosFileId, expiresAt } };
    }
    if (action === 'video.complete') {
      const before = await repo.read(ownerId); const v = ownVideo(before, data.id);
      ensure(!before.accountDeleting, 'ACCOUNT_DELETING', '数据正在删除');
      ensure(data.fileId === v.fileId && v.fileId.startsWith('cloud://') && v.fileId.endsWith('/' + v.objectKey), 'FORBIDDEN', '文件不属于当前上传预约');
      if (v.status !== 'ready') {
        ensure(v.status === 'reserved' && v.reservationExpiresAt > new Date().toISOString(), 'UPLOAD_EXPIRED', '上传预约已过期');
        const bytes = await readBoundedVideo(await signedUrl(v.fileId)); const inspected = inspectMp4(bytes);
        ensure(inspected.byteSize === v.byteSize, 'VALIDATION_ERROR', '视频大小与上传预约不一致，请重新上传');
        const fresh = await repo.read(ownerId); const reserved = ownVideo(fresh, v._id);
        ensure(reserved.status === 'reserved', 'VERSION_CONFLICT', '视频状态已变化');
        const result = execute(fresh, { action: 'video.ready', requestId: event.requestId, data: { id: v._id, fileId: v.fileId } }, ctx(ownerId, { trustedMedia: true }));
        const verified = result.state.videos.find(x => x._id === v._id)!; verified.durationSec = inspected.durationSec;
        await repo.commit(fresh, result.state); return { ok: true, data: { state: result.state, value: result.value } };
      }
      return { ok: true, data: { state: before, value: v } };
    }
    ensure(allowed.has(action), 'FORBIDDEN', '不支持的操作');
    if (action === 'review.create' && data.mode === 'ai') ensure(process.env.PANJI_AI_ENABLED === 'true', 'AI_UNAVAILABLE', 'AI 服务尚未开通');
    const result = await mutate(ownerId, { action, data, requestId: event.requestId });
    return { ok: true, data: { ...result, state: publicState(result.state) } };
  } catch (e) {
    // Never echo stack traces, request content, temporary URLs or upstream credentials.
    return { ok: false, error: { code: e instanceof DomainError ? e.code : 'SERVICE_UNAVAILABLE',
      message: e instanceof DomainError ? e.message : '云端暂时无法完成操作，请稍后重试' } };
  }
};
