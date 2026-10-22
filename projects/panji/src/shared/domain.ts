import { catalogGym, linkedCatalogGym } from './gym-catalog';
export const PRIVACY_VERSION = '2026-10-19';
export const MAX_VIDEO_SECONDS = 300;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const VIDEO_LIMIT_LABEL = '每段 ≤ 5 分钟 · ≤ 100 MB';
export const VIDEO_QUOTA = 1024 * 1024 * 1024;
export type Result = 'completed' | 'failed' | 'unknown';
export interface Base { _id: string; ownerId: string; createdAt: string; updatedAt: string; schemaVersion: number }
export interface Gym extends Base { name: string; city: string; gradeSystem: string; notes: string; archivedAt?: string; catalogId?: string }
export interface Session extends Base {
  gymId: string; gymSnapshot: { name: string; city: string; gradeSystem: string };
  sessionDate: string; durationMinutes: number | null; trainingNotes: string; feeling: string;
  perceivedEffort: number | null; version: number;
}
export interface Attempt extends Base {
  sessionId: string; routeLabel: string; gradeLabel: string; gradeSystem: string;
  result: Result; ordinal: number; notes: string; projectId?: string;
}
export interface RouteProject extends Base {
  gymId: string; routeLabel: string; gradeLabel: string; gradeSystem: string; notes: string;
  status: 'active' | 'completed' | 'archived';
}
export interface Video extends Base {
  sessionId: string | null; attemptId: string | null; byteSize: number; durationSec: number;
  status: 'reserved' | 'ready' | 'deleting'; objectKey: string; fileId: string;
  reservationExpiresAt: string; uploadExpiresAt?: string; localPath?: string; deleteError?: string;
  localOnly?: boolean; marks?: { id: string; timeSec: number; note: string }[];
}
export interface ReviewOutput {
  summary: string;
  observations: { text: string; evidenceIds: string[] }[];
  hypotheses: { text: string; reason: string; uncertainty: string }[];
  actions: { text: string; metric: string; followupQuestion: string }[];
  limitations: string[];
}
export interface Review extends Base {
  mode: 'rule' | 'manual' | 'ai'; status: 'queued' | 'running' | 'ready' | 'failed' | 'stale';
  from: string; to: string; sourceVersions: { id: string; version: number }[];
  inputSnapshot?: ReviewInput; output?: ReviewOutput; errorCode?: string; errorMessage?: string;
  promptVersion: string; modelVersion: string; tokenUsage?: number;
  retryCount: number; leaseUntil?: string; feedback?: string;
}
export interface Goal extends Base {
  reviewId: string | null; text: string; status: 'active' | 'completed' | 'skipped' | 'cancelled';
  followupSessionId: string | null; userFeedback: string;
}
export interface Consent { privacyVersion: string; privacyAt: string; aiVersion: string; aiAt: string }
export interface Operation { id: string; fingerprint: string; value: unknown }
export interface State {
  schemaVersion: number; revision: number; ownerId: string; consent: Consent;
  gyms: Gym[]; sessions: Session[]; attempts: Attempt[]; videos: Video[];
  reviews: Review[]; goals: Goal[]; operations: Operation[]; accountDeleting: boolean;
  projects?: RouteProject[];
  aiUsage?: { day: string; count: number };
}
export interface Command { action: string; requestId: string; data: Record<string, unknown> }
export interface Context {
  ownerId: string; now: string; newId: (prefix: string) => string;
  trustedMedia?: boolean; trustedWorker?: boolean; aiEnabled?: boolean;
}
export class DomainError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'DomainError'; }
}
export function ensure(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new DomainError(code, message);
}
export function emptyState(ownerId: string): State {
  return { schemaVersion: 1, revision: 0, ownerId,
    consent: { privacyVersion: '', privacyAt: '', aiVersion: '', aiAt: '' },
    gyms: [], sessions: [], attempts: [], videos: [], reviews: [], goals: [], projects: [], operations: [], accountDeleting: false };
}
export function publicState(state: State): State {
  if (!state.accountDeleting) return state;
  // A cloud account tombstone hides all business data before physical deletion finishes.
  return { ...emptyState(state.ownerId), revision: state.revision, accountDeleting: true,
    videos: state.videos.map(v => ({ ...v, status: 'deleting', sessionId: null, attemptId: null, fileId: '', objectKey: '', localPath: undefined, marks: [] })) };
}
export function todayShanghai(now = new Date().toISOString()): string {
  return new Date(new Date(now).getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}
export function monday(date: string): string {
  const day = new Date(date + 'T00:00:00Z').getUTCDay();
  return shiftDate(date, -(day === 0 ? 6 : day - 1));
}
function text(data: Record<string, unknown>, key: string, max: number, required = false): string {
  const raw = data[key];
  ensure(raw === undefined || typeof raw === 'string', 'VALIDATION_ERROR', '请检查文字格式');
  const value = (raw as string || '').trim();
  const labels: Record<string, string> = { name: '岩馆名称', city: '城市', gradeSystem: '难度体系', notes: '备注', trainingNotes: '训练内容', feeling: '训练感受',
    routeLabel: '线路标识', gradeLabel: '难度标签', text: '目标', summary: '复盘内容', feedback: '反馈', userFeedback: '目标反馈' };
  ensure((!required || value.length > 0) && value.length <= max, 'VALIDATION_ERROR', `${labels[key] || '内容'}${!value.length ? '还没有填写' : `超过 ${max} 字限制`}`);
  return value;
}
function number(data: Record<string, unknown>, key: string, min: number, max: number, nullable = false): number | null {
  const raw = data[key];
  if (nullable && (raw === null || raw === undefined || raw === '')) return null;
  ensure(typeof raw === 'number' && Number.isFinite(raw) && raw >= min && raw <= max, 'VALIDATION_ERROR', '请填写有效数字');
  return raw;
}
function date(data: Record<string, unknown>, key: string): string {
  const value = text(data, key, 10, true);
  ensure(/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value,
    'VALIDATION_ERROR', '日期无效');
  return value;
}
function own<T extends Base>(items: T[], id: unknown, ctx: Context): T {
  const record = items.find(x => x._id === id && x.ownerId === ctx.ownerId);
  ensure(record, 'NOT_FOUND', '记录不存在或无权访问');
  return record;
}
function base(prefix: string, ctx: Context): Base {
  return { _id: ctx.newId(prefix), ownerId: ctx.ownerId, createdAt: ctx.now, updatedAt: ctx.now, schemaVersion: 1 };
}
export interface Stats {
  sessions: number; minutes: number; missingDuration: number; attempts: number;
  completed: number; failed: number; unknown: number; denominator: number; completionRate: number | null;
  weeks: { week: string; sessions: number; minutes: number; missing: number }[];
  grades: { gymId: string; gym: string; system: string; label: string; attempts: number; completed: number }[];
}
export function stats(state: State, from: string, to: string, gymId = ''): Stats {
  const sessions = state.sessions.filter(s => s.sessionDate >= from && s.sessionDate <= to && (!gymId || s.gymId === gymId));
  const ids = new Set(sessions.map(s => s._id));
  const attempts = state.attempts.filter(a => ids.has(a.sessionId));
  const completed = attempts.filter(a => a.result === 'completed').length;
  const failed = attempts.filter(a => a.result === 'failed').length;
  const missingDuration = sessions.filter(s => s.durationMinutes === null).length;
  const weeks: Stats['weeks'] = [];
  // Keep the axis even when a week has no records. Empty weeks do not imply ability changes.
  for (let week = monday(from), i = 0; week <= to && i < 540; week = shiftDate(week, 7), i++) {
    const group = sessions.filter(s => monday(s.sessionDate) === week);
    weeks.push({ week, sessions: group.length, minutes: group.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0), missing: group.filter(s => s.durationMinutes === null).length });
  }
  const groups: Record<string, Stats['grades'][number]> = {};
  for (const a of attempts) {
    const s = sessions.find(s => s._id === a.sessionId)!;
    const key = JSON.stringify([s.gymId, a.gradeSystem, a.gradeLabel]);
    groups[key] ||= { gymId: s.gymId, gym: s.gymSnapshot.name, system: a.gradeSystem, label: a.gradeLabel || '未填难度', attempts: 0, completed: 0 };
    groups[key].attempts++; if (a.result === 'completed') groups[key].completed++;
  }
  return { sessions: sessions.length, minutes: sessions.reduce((n, s) => n + (s.durationMinutes ?? 0), 0), missingDuration,
    attempts: attempts.length, completed, failed, unknown: attempts.length - completed - failed,
    denominator: completed + failed, completionRate: completed + failed ? Math.round(completed / (completed + failed) * 100) : null,
    weeks, grades: Object.values(groups) };
}
export interface ReviewInput {
  range: { from: string; to: string }; statistics: Stats;
  dataSummary: string; facts: ReviewOutput['observations'];
  records: { id: string; version: number; date: string; gymCode: string; minutes: number | null; notes: string; feeling: string;
    attempts: { result: Result; gradeLabel: string; gradeSystem: string; notes: string }[] }[];
  previousGoals: { text: string; status: string; feedback: string }[];
}
export function reviewInput(state: State, from: string, to: string, includeNotes: boolean): ReviewInput {
  const sessions = state.sessions.filter(s => s.sessionDate >= from && s.sessionDate <= to).sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
  ensure(sessions.length > 0, 'DATA_INSUFFICIENT', '这个范围还没有训练记录');
  ensure(sessions.length <= 30, 'VALIDATION_ERROR', '一次最多复盘 30 次训练，请缩小日期范围');
  const gymIds = [...new Set(sessions.map(s => s.gymId))];
  const statistics = stats(state, from, to);
  statistics.grades = statistics.grades.map(g => ({ ...g, gym: '岩馆' + (gymIds.indexOf(g.gymId) + 1), gymId: 'gym_' + (gymIds.indexOf(g.gymId) + 1) }));
  const input: ReviewInput = { range: { from, to }, statistics, dataSummary: '', facts: [],
    records: sessions.map(s => ({ id: s._id, version: s.version, date: s.sessionDate, gymCode: '岩馆' + (gymIds.indexOf(s.gymId) + 1),
      minutes: s.durationMinutes, notes: includeNotes ? s.trainingNotes : '', feeling: includeNotes ? s.feeling : '',
      attempts: state.attempts.filter(a => a.sessionId === s._id).map(a => ({ result: a.result, gradeLabel: a.gradeLabel, gradeSystem: a.gradeSystem, notes: includeNotes ? a.notes : '' })) })),
    previousGoals: includeNotes ? state.goals.slice(-5).map(g => ({ text: g.text, status: g.status, feedback: g.userFeedback })) : [] };
  const fixed = ruleReview(input); input.dataSummary = fixed.summary; input.facts = fixed.observations;
  return input;
}
export function ruleReview(input: ReviewInput): ReviewOutput {
  const s = input.statistics;
  return { summary: `这段时间，你记录了 ${s.sessions} 次训练。已填写的时长合计 ${s.minutes} 分钟。`,
    observations: [
      { text: `共记录 ${s.attempts} 次明确尝试，其中完成 ${s.completed} 次、未完成 ${s.failed} 次、结果未知 ${s.unknown} 次。`, evidenceIds: input.records.map(r => r.id) },
      ...(s.missingDuration ? [{ text: `${s.missingDuration} 次训练没有填写时长，未将其计为零分钟。`, evidenceIds: input.records.filter(r => r.minutes === null).map(r => r.id) }] : []),
    ], hypotheses: [], actions: [{ text: '下次训练后，记录一个值得保留的做法和一个想调整的地方。', metric: '完成一条训练备注', followupQuestion: '记录后，你更清楚下一次想练什么了吗？' }],
    limitations: [input.records.length < 2 ? '只有一次训练，仅作单次回顾，不评价趋势。' : '这是按记录自动整理的数据摘要，没有分析动作或视频。', '不同岩馆与难度体系分别统计，不能据此直接比较攀爬能力。'] };
}
export function validateOutput(raw: unknown, input: ReviewInput): ReviewOutput {
  ensure(raw && typeof raw === 'object' && !Array.isArray(raw), 'AI_INVALID_OUTPUT', '复盘结果格式不正确');
  const x = raw as Record<string, unknown>;
  ensure(typeof x.summary === 'string' && x.summary.length > 0 && x.summary.length <= 1200, 'AI_INVALID_OUTPUT', '复盘摘要无效');
  for (const key of ['observations', 'hypotheses', 'actions', 'limitations']) ensure(Array.isArray(x[key]), 'AI_INVALID_OUTPUT', '复盘字段不完整');
  const ids = new Set(input.records.map(r => r.id));
  const validText = (s: unknown, max = 600): s is string => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
  const obs = x.observations as ReviewOutput['observations'];
  ensure(obs.length <= 8 && obs.every(o => o && validText(o.text) && Array.isArray(o.evidenceIds) && o.evidenceIds.length > 0 && o.evidenceIds.every(id => ids.has(id))), 'AI_INVALID_OUTPUT', '复盘引用了范围之外的记录');
  ensure(x.summary === input.dataSummary && obs.length > 0 && obs.every(o => input.facts.some(f => f.text === o.text && JSON.stringify(f.evidenceIds) === JSON.stringify(o.evidenceIds))),
    'AI_INVALID_OUTPUT', '模型改写了确定性事实，已拦截本次输出');
  const hypotheses = x.hypotheses as ReviewOutput['hypotheses'];
  ensure(hypotheses.length <= 4 && hypotheses.every(h => h && validText(h.text) && validText(h.reason) && validText(h.uncertainty)), 'AI_INVALID_OUTPUT', '推测缺少依据或不确定性说明');
  const actions = x.actions as ReviewOutput['actions'];
  ensure(actions.length >= 1 && actions.length <= 2 && actions.every(a => a && validText(a.text, 240) && validText(a.metric, 160) && validText(a.followupQuestion, 160)), 'AI_INVALID_OUTPUT', '建议需要包含一至两个可核对目标');
  ensure((x.limitations as unknown[]).length <= 8 && (x.limitations as unknown[]).every(s => validText(s)), 'AI_INVALID_OUTPUT', '复盘限制说明无效');
  const encoded = JSON.stringify(raw);
  ensure(encoded.length <= 6000, 'AI_INVALID_OUTPUT', '复盘过长');
  // Structural validation is only one gate; model outputs still need human evaluation before public release.
  ensure(!/视频(?:显示|表明|看出)|诊断为|确诊|服用.{0,12}(?:药|毫克)|治愈|受伤概率\s*\d/.test(encoded), 'AI_INVALID_OUTPUT', '复盘包含未经支持的诊断或视频结论');
  return { summary: x.summary, observations: obs, hypotheses, actions, limitations: x.limitations as string[] };
}
function invalidate(state: State, sessionId: string, deleted = false): void {
  const affected = state.reviews.filter(r => r.sourceVersions.some(s => s.id === sessionId));
  for (const r of affected) {
    r.status = 'stale'; delete r.inputSnapshot; delete r.output;
    if (deleted) r.sourceVersions = r.sourceVersions.filter(s => s.id !== sessionId);
  }
  const reviewIds = new Set(affected.map(r => r._id));
  for (const g of state.goals.filter(g => g.reviewId && reviewIds.has(g.reviewId))) {
    if (g.status === 'active') g.status = 'cancelled';
    // Goals may contain copied source text. Remove derived text when its source is deleted.
    if (deleted) { g.text = '来源记录已删除'; g.userFeedback = ''; }
  }
  // Cached responses must not retain deleted or outdated record contents.
  state.operations = [];
}
export function execute(original: State, cmd: Command, ctx: Context): { state: State; value: unknown } {
  ensure(original.ownerId === ctx.ownerId, 'FORBIDDEN', '无权访问数据');
  ensure(typeof cmd.requestId === 'string' && /^[\w-]{8,100}$/.test(cmd.requestId), 'VALIDATION_ERROR', '请求编号无效');
  const fingerprint = JSON.stringify([cmd.action, cmd.data]);
  const cached = original.operations.find(x => x.id === cmd.requestId);
  if (cached) {
    ensure(cached.fingerprint === fingerprint, 'VERSION_CONFLICT', '保存内容已变化，请重新保存');
    return { state: original, value: cached.value };
  }
  ensure(!original.accountDeleting || ['video.purged', 'privacy.set'].includes(cmd.action), 'ACCOUNT_DELETING', '数据正在删除，请稍后重试');
  const state: State = JSON.parse(JSON.stringify(original));
  const d = cmd.data || {};
  let value: unknown = null;
  const touchSession = (id: string) => {
    const s = own(state.sessions, id, ctx); s.version++; s.updatedAt = ctx.now; invalidate(state, id);
  };
  switch (cmd.action) {
    case 'privacy.set': {
      if (d.privacy === true) { state.consent.privacyVersion = PRIVACY_VERSION; state.consent.privacyAt = ctx.now; }
      if (d.ai === true) { ensure(state.consent.privacyAt, 'CONSENT_REQUIRED', '请先阅读隐私说明'); state.consent.aiVersion = PRIVACY_VERSION; state.consent.aiAt = ctx.now; }
      if (d.ai === false) {
        state.consent.aiVersion = ''; state.consent.aiAt = '';
        for (const r of state.reviews.filter(r => r.status === 'queued' || r.status === 'running')) { r.status = 'failed'; r.errorCode = 'CONSENT_REVOKED'; delete r.inputSnapshot; }
      }
      value = state.consent; break;
    }
    case 'gym.import': {
      const entry = catalogGym(d.catalogId);
      ensure(entry, 'NOT_FOUND', '岩馆资料不存在，请刷新名录');
      const existing = linkedCatalogGym(entry, state.gyms);
      if (existing) {
        ensure(existing.ownerId === ctx.ownerId, 'FORBIDDEN', '岩馆归属不匹配');
        existing.catalogId = entry.id; delete existing.archivedAt; existing.updatedAt = ctx.now; value = existing;
      } else {
        const g: Gym = { ...base('gym',ctx), name:entry.name, city:entry.city, catalogId:entry.id,
          gradeSystem:'馆内原标签', notes:'' };
        state.gyms.push(g);value=g;
      }
      break;
    }
    case 'gym.save': {
      const fields = { name: text(d, 'name', 50, true), city: text(d, 'city', 50), gradeSystem: text(d, 'gradeSystem', 30, true), notes: text(d, 'notes', 500) };
      if (d.id) { const g = own(state.gyms, d.id, ctx); Object.assign(g, fields, { updatedAt: ctx.now }); value = g; }
      else { const g: Gym = { ...base('gym', ctx), ...fields }; state.gyms.push(g); value = g; }
      break;
    }
    case 'gym.archive': {
      const g = own(state.gyms, d.id, ctx); g.archivedAt = d.archived === false ? undefined : ctx.now; g.updatedAt = ctx.now; value = g; break;
    }
    case 'project.save': {
      const projects = state.projects || (state.projects = []);
      const old = d.id ? own(projects, d.id, ctx) : undefined;
      const gym = own(state.gyms, d.gymId, ctx);
      ensure(!gym.archivedAt || old?.gymId === gym._id, 'VALIDATION_ERROR', '已归档岩馆不能新增线路项目');
      ensure(!old || old.gymId === gym._id, 'VALIDATION_ERROR', '线路项目不能更换岩馆，请另建项目');
      ensure(old || projects.length < 80, 'QUOTA_EXCEEDED', '最多保存 80 个线路项目，请先删除不再需要的项目');
      const project: RouteProject = { ...(old || base('project', ctx)), gymId: gym._id,
        routeLabel: text(d, 'routeLabel', 80, true), gradeLabel: text(d, 'gradeLabel', 30),
        gradeSystem: old?.gradeSystem || gym.gradeSystem, notes: text(d, 'notes', 1000),
        status: old?.status || 'active', updatedAt: ctx.now };
      if (old) projects[projects.indexOf(old)] = project; else projects.push(project);
      value = project; break;
    }
    case 'project.status': {
      const project = own(state.projects || [], d.id, ctx);
      ensure(['active', 'completed', 'archived'].includes(d.status as string), 'VALIDATION_ERROR', '请选择有效的线路状态');
      project.status = d.status as RouteProject['status']; project.updatedAt = ctx.now; value = project; break;
    }
    case 'project.delete': {
      const project = own(state.projects || [], d.id, ctx);
      state.projects = (state.projects || []).filter(p => p._id !== project._id);
      // A missing project is a logical unlink. Preserve historical attempt records and avoid a large cloud transaction.
      state.operations = []; value = { deletedId: project._id }; break;
    }
    case 'session.save': {
      const old = d.id ? own(state.sessions, d.id, ctx) : undefined;
      if (old) ensure(old.version === d.version, 'VERSION_CONFLICT', '这次训练已更新，请返回后重新编辑');
      const g = own(state.gyms, d.gymId, ctx);
      ensure(!g.archivedAt || old?.gymId === g._id, 'VALIDATION_ERROR', '已归档岩馆不能用于新训练');
      const sessionDate = date(d, 'sessionDate');
      ensure(sessionDate <= todayShanghai(ctx.now), 'VALIDATION_ERROR', '训练日期不能晚于今天');
      const durationMinutes = number(d, 'durationMinutes', 1, 1440, true);
      const perceivedEffort = number(d, 'perceivedEffort', 1, 10, true);
      ensure(durationMinutes === null || Number.isInteger(durationMinutes), 'VALIDATION_ERROR', '训练时长请填整数分钟');
      ensure(perceivedEffort === null || Number.isInteger(perceivedEffort), 'VALIDATION_ERROR', '强度请填 1–10 的整数');
      if (old && old.gymId !== g._id) ensure(!state.attempts.some(a => a.sessionId === old._id), 'VALIDATION_ERROR', '已有尝试记录，不能更换岩馆；请新建训练');
      const record: Session = { ...(old || base('session', ctx)), gymId: g._id,
        gymSnapshot: old?.gymId === g._id ? old.gymSnapshot : { name: g.name, city: g.city, gradeSystem: g.gradeSystem },
        sessionDate, durationMinutes, trainingNotes: text(d, 'trainingNotes', 2000), feeling: text(d, 'feeling', 1000), perceivedEffort,
        version: (old?.version || 0) + 1, updatedAt: ctx.now };
      if (old) { state.sessions[state.sessions.indexOf(old)] = record; invalidate(state, old._id); }
      else state.sessions.push(record);
      value = record; break;
    }
    case 'session.delete': {
      const s = own(state.sessions, d.id, ctx);
      if (d.version !== undefined) ensure(s.version === d.version, 'VERSION_CONFLICT', '训练已经变更，请刷新后删除');
      invalidate(state, s._id, true);
      state.sessions = state.sessions.filter(x => x._id !== s._id); state.attempts = state.attempts.filter(x => x.sessionId !== s._id);
      for (const v of state.videos.filter(x => x.sessionId === s._id)) { v.sessionId = null; v.attemptId = null; if (d.deleteVideos === true) v.status = 'deleting'; }
      for (const g of state.goals.filter(g => g.followupSessionId === s._id)) { g.followupSessionId = null; g.userFeedback = ''; if (g.status === 'completed' || g.status === 'skipped') g.status = 'active'; }
      value = { deletedId: s._id }; break;
    }
    case 'attempt.save': {
      const s = own(state.sessions, d.sessionId, ctx);
      const old = d.id ? own(state.attempts, d.id, ctx) : undefined;
      if (old) ensure(old.sessionId === s._id, 'VALIDATION_ERROR', '尝试不属于这次训练');
      const projectId = d.projectId === undefined
        ? ((state.projects || []).some(p => p._id === old?.projectId && p.ownerId === ctx.ownerId) ? old?.projectId : undefined)
        : text(d, 'projectId', 100);
      if (projectId) {
        const project = own(state.projects || [], projectId, ctx);
        ensure(project.gymId === s.gymId, 'VALIDATION_ERROR', '线路项目不属于本次训练的岩馆');
        ensure(project.status !== 'archived' || old?.projectId === projectId, 'VALIDATION_ERROR', '该线路已归档，请先恢复再记录');
      }
      ensure(['completed', 'failed', 'unknown'].includes(d.result as string), 'VALIDATION_ERROR', '请选择尝试结果');
      const a: Attempt = { ...(old || base('attempt', ctx)), sessionId: s._id, routeLabel: text(d, 'routeLabel', 80, true),
        gradeLabel: text(d, 'gradeLabel', 30), gradeSystem: s.gymSnapshot.gradeSystem, result: d.result as Result,
        ordinal: old?.ordinal || Math.max(0, ...state.attempts.filter(x => x.sessionId === s._id).map(x => x.ordinal)) + 1,
        notes: text(d, 'notes', 1000), updatedAt: ctx.now };
      if (projectId) a.projectId = projectId; else delete a.projectId;
      if (old) state.attempts[state.attempts.indexOf(old)] = a; else state.attempts.push(a);
      touchSession(s._id); value = a; break;
    }
    case 'attempt.delete': {
      const a = own(state.attempts, d.id, ctx); state.attempts = state.attempts.filter(x => x._id !== a._id);
      for (const v of state.videos.filter(x => x.attemptId === a._id)) v.attemptId = null;
      touchSession(a.sessionId); value = { deletedId: a._id }; break;
    }
    case 'video.reserve': {
      if (d.sessionId) own(state.sessions, d.sessionId, ctx);
      const byteSize = number(d, 'byteSize', 1, MAX_VIDEO_BYTES)!;
      const durationSec = number(d, 'durationSec', 0.01, MAX_VIDEO_SECONDS)!;
      const used = state.videos.reduce((n, v) => n + v.byteSize, 0);
      ensure(used + byteSize <= VIDEO_QUOTA, 'QUOTA_EXCEEDED', '视频空间不足，请先清理旧视频');
      const b = base('video', ctx);
      const v: Video = { ...b, sessionId: (d.sessionId as string) || null, attemptId: null, byteSize, durationSec, status: 'reserved',
        objectKey: `panji/${ctx.ownerId}/${b._id}.mp4`, fileId: '', reservationExpiresAt: new Date(Date.parse(ctx.now) + 24 * 3600000).toISOString() };
      state.videos.push(v); value = v; break;
    }
    case 'video.ready': {
      ensure(ctx.trustedMedia, 'FORBIDDEN', '文件需要经过服务端确认');
      const v = own(state.videos, d.id, ctx);
      if (v.status === 'ready') { value = v; break; }
      ensure(v.status === 'reserved' && v.reservationExpiresAt > ctx.now, 'UPLOAD_EXPIRED', '上传预约已过期，请重新选择');
      v.fileId = text(d, 'fileId', 500); v.localPath = text(d, 'localPath', 1000);
      ensure(v.fileId || v.localPath, 'VALIDATION_ERROR', '未找到视频文件');
      v.status = 'ready'; v.updatedAt = ctx.now; value = v; break;
    }
    case 'video.link': {
      const v = own(state.videos, d.id, ctx); ensure(v.status === 'ready', 'VALIDATION_ERROR', '视频尚未上传完成');
      if (!d.sessionId) { v.sessionId = null; v.attemptId = null; }
      else {
        const s = own(state.sessions, d.sessionId, ctx);
        if (d.attemptId) { const a = own(state.attempts, d.attemptId, ctx); ensure(a.sessionId === s._id, 'VALIDATION_ERROR', '尝试不属于所选训练'); }
        v.sessionId = s._id; v.attemptId = (d.attemptId as string) || null;
      }
      v.updatedAt = ctx.now; value = v; break;
    }
    case 'video.mark': {
      const v = own(state.videos, d.id, ctx); ensure(v.status === 'ready', 'VALIDATION_ERROR', '请先保存视频，再添加关键点');
      const timeSec = number(d, 'timeSec', 0, v.durationSec)!;
      const note = text(d, 'note', 120, true);
      const marks = v.marks || []; const old = d.markerId ? marks.find(m => m.id === d.markerId) : undefined;
      if (d.markerId) ensure(old, 'NOT_FOUND', '关键点不存在或已删除');
      ensure(old || marks.length < 30, 'VALIDATION_ERROR', '每段视频最多记录30个关键点');
      if (old) state.operations = []; // Superseded notes must not survive in earlier request fingerprints.
      const marker = { id: old?.id || ctx.newId('mark'), timeSec, note };
      v.marks = [...marks.filter(m => m.id !== old?.id), marker].sort((a,b) => a.timeSec - b.timeSec);
      v.updatedAt = ctx.now; value = marker; break;
    }
    case 'video.unmark': {
      const v = own(state.videos, d.id, ctx); ensure(v.status === 'ready', 'VALIDATION_ERROR', '视频暂不可编辑');
      ensure((v.marks || []).some(m => m.id === d.markerId), 'NOT_FOUND', '关键点不存在或已删除');
      v.marks = (v.marks || []).filter(m => m.id !== d.markerId); state.operations = [];
      v.updatedAt = ctx.now; value = { deletedId: d.markerId }; break;
    }
    case 'video.delete': {
      const v = own(state.videos, d.id, ctx); v.status = 'deleting'; v.updatedAt = ctx.now; value = v; break;
    }
    case 'video.purged': {
      ensure(ctx.trustedMedia, 'FORBIDDEN', '无权确认文件删除');
      own(state.videos, d.id, ctx); state.videos = state.videos.filter(x => x._id !== d.id); state.operations = [];
      if (state.accountDeleting && !state.videos.length) state.accountDeleting = false;
      value = { deletedId: d.id }; break;
    }
    case 'review.create': {
      const from = date(d, 'from'), to = date(d, 'to');
      ensure(from <= to && to <= todayShanghai(ctx.now), 'VALIDATION_ERROR', '请选择有效的复盘范围');
      ensure(['rule', 'manual', 'ai'].includes(d.mode as string), 'VALIDATION_ERROR', '复盘方式无效');
      const input = reviewInput(state, from, to, d.includeNotes === true);
      if (d.mode === 'ai') {
        ensure(ctx.aiEnabled, 'AI_UNAVAILABLE', 'AI 服务尚未配置，可以先使用数据摘要或手写复盘');
        ensure(state.consent.aiVersion === PRIVACY_VERSION, 'CONSENT_REQUIRED', '请先确认 AI 数据处理说明');
        const day = todayShanghai(ctx.now);
        const count = Math.max(state.aiUsage?.day === day ? state.aiUsage.count : 0,
          state.reviews.filter(r => r.mode === 'ai' && todayShanghai(r.createdAt) === day).length);
        ensure(count < 3, 'AI_RATE_LIMIT', '今天的 AI 复盘次数已用完，明天再试；仍可使用数据摘要');
        state.aiUsage = { day, count: count + 1 };
      }
      const r: Review = { ...base('review', ctx), mode: d.mode as Review['mode'], status: d.mode === 'ai' ? 'queued' : 'ready', from, to,
        sourceVersions: input.records.map(s => ({ id: s.id, version: s.version })), inputSnapshot: input,
        promptVersion: 'panji-review-v1', modelVersion: d.mode === 'ai' ? '' : 'deterministic-v1', retryCount: 0 };
      if (d.mode !== 'ai') {
        r.output = ruleReview(input);
        if (d.mode === 'manual') { r.output.summary = text(d, 'summary', 2000, true); r.output.actions = [] ; r.modelVersion = 'manual'; }
      }
      state.reviews.push(r); value = r; break;
    }
    case 'review.claim': {
      ensure(ctx.trustedWorker, 'FORBIDDEN', '无权领取复盘任务');
      const r = own(state.reviews, d.id, ctx);
      ensure(r.mode === 'ai' && (r.status === 'queued' || (r.status === 'running' && (r.leaseUntil || '') < ctx.now)), 'VERSION_CONFLICT', '任务已由其他工作进程领取');
      ensure(state.consent.aiVersion === PRIVACY_VERSION, 'CONSENT_REQUIRED', 'AI 授权已撤回');
      ensure(r.retryCount < 3, 'AI_TIMEOUT', '复盘尝试次数已达上限');
      r.status = 'running'; r.retryCount++; r.leaseUntil = new Date(Date.parse(ctx.now) + 90000).toISOString(); value = r; break;
    }
    case 'review.result': {
      ensure(ctx.trustedWorker, 'FORBIDDEN', '无权提交复盘结果');
      const r = own(state.reviews, d.id, ctx);
      ensure(r.status === 'running' && r.leaseUntil === d.leaseUntil, 'VERSION_CONFLICT', '复盘任务已失效');
      ensure(state.consent.aiVersion === PRIVACY_VERSION, 'CONSENT_REQUIRED', 'AI 授权已撤回');
      ensure(r.inputSnapshot && r.sourceVersions.every(v => state.sessions.some(s => s._id === v.id && s.version === v.version)), 'VERSION_CONFLICT', '来源训练已变更');
      r.output = validateOutput(d.output, r.inputSnapshot); r.status = 'ready'; r.modelVersion = text(d, 'modelVersion', 100, true);
      r.tokenUsage = number(d, 'tokenUsage', 0, 1000000) || 0; delete r.leaseUntil; r.updatedAt = ctx.now; value = r; break;
    }
    case 'review.fail': {
      ensure(ctx.trustedWorker, 'FORBIDDEN', '无权提交复盘结果');
      const r = own(state.reviews, d.id, ctx);
      if (r.status === 'running' && r.leaseUntil === d.leaseUntil) { r.status = 'failed'; r.errorCode = text(d, 'errorCode', 60, true);
        r.errorMessage = text(d, 'errorMessage', 160); delete r.leaseUntil; }
      value = r; break;
    }
    case 'review.feedback': {
      const r = own(state.reviews, d.id, ctx); r.feedback = text(d, 'feedback', 500, true); r.updatedAt = ctx.now; value = r; break;
    }
    case 'review.delete': {
      const r = own(state.reviews, d.id, ctx); state.reviews = state.reviews.filter(x => x._id !== r._id);
      for (const g of state.goals.filter(g => g.reviewId === r._id)) { g.reviewId = null; }
      state.operations = []; value = { deletedId: r._id }; break;
    }
    case 'goal.save': {
      if (d.reviewId) { const r = own(state.reviews, d.reviewId, ctx); ensure(r.status === 'ready', 'VERSION_CONFLICT', '复盘已过期，请重新生成'); }
      const g: Goal = { ...base('goal', ctx), reviewId: (d.reviewId as string) || null, text: text(d, 'text', 240, true), status: 'active', followupSessionId: null, userFeedback: text(d, 'userFeedback', 500) };
      state.goals.push(g); value = g; break;
    }
    case 'goal.followup': {
      const g = own(state.goals, d.id, ctx);
      ensure(['completed', 'skipped', 'active', 'cancelled'].includes(d.status as string), 'VALIDATION_ERROR', '目标状态无效');
      if (d.status === 'completed' || d.status === 'skipped') {
        const session = own(state.sessions, d.sessionId, ctx);
        ensure(session.sessionDate >= todayShanghai(g.createdAt), 'VALIDATION_ERROR', '请选择目标建立当天或之后的训练');
        g.followupSessionId = session._id;
      } else g.followupSessionId = null;
      g.status = d.status as Goal['status']; g.userFeedback = text(d, 'userFeedback', 500); g.updatedAt = ctx.now; value = g; break;
    }
    case 'account.delete': {
      const videos = state.videos.map(v => ({ ...v, status: 'deleting' as const, sessionId: null, attemptId: null, marks: [] }));
      Object.assign(state, emptyState(ctx.ownerId), { videos, revision: state.revision, accountDeleting: videos.length > 0 });
      value = { pendingVideos: videos.length }; break;
    }
    default: throw new DomainError('VALIDATION_ERROR', '不支持的操作');
  }
  state.revision = original.revision + 1;
  // Do not cache sensitive response payloads. Replays only need record IDs.
  const cacheValue = value && typeof value === 'object' && '_id' in value ? { _id: (value as Base)._id }
    : cmd.action === 'video.mark' && value && typeof value === 'object' && 'id' in value ? { id: (value as { id: string }).id } : value;
  state.operations.push({ id: cmd.requestId, fingerprint, value: cacheValue });
  state.operations = state.operations.slice(-80);
  // Fingerprints contain submitted notes. Erase all cached requests on destructive operations.
  if (['account.delete', 'session.delete', 'review.delete', 'video.purged', 'project.delete'].includes(cmd.action)) state.operations = [];
  return { state, value };
}

export function exportData(state: State): Record<string, unknown> {
  const { operations: _operations, ...data } = state;
  const projects = new Set((data.projects || []).filter(p => p.ownerId === state.ownerId).map(p => p._id));
  return { product: '攀迹', exportedAt: new Date().toISOString(), formatVersion: 1,
    ...data, attempts: data.attempts.map(a => {
      if (!a.projectId || projects.has(a.projectId)) return a;
      const { projectId: _projectId, ...record } = a; return record;
    }), videos: data.videos.map(({ localPath: _path, ...video }) => ({ ...video, fileId: '', objectKey: '' })) };
}
