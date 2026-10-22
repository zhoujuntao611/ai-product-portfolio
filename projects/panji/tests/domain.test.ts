import test from 'node:test';
import assert from 'node:assert/strict';
import { execute, emptyState, stats, todayShanghai, monday, shiftDate, reviewInput, ruleReview, validateOutput,
  MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS, VIDEO_QUOTA, exportData, State, DomainError } from '../src/shared/domain';
import { fixture, dispatch, context, time } from './fixtures';

const range = ['2026-10-05', '2026-10-18'] as const;
function error(code: string) { return (e: unknown) => e instanceof DomainError && e.code === code; }
function createReview(s: State, mode = 'rule') { return dispatch(s, 'review.create', { from: range[0], to: range[1], mode }, { aiEnabled: true }); }

test('6 次合成训练跨两周可手算；缺失时长和未知结果保留口径', () => {
  const s = fixture(); const actual = stats(s, ...range);
  assert.equal(actual.sessions, 6); assert.equal(actual.minutes, 345); assert.equal(actual.missingDuration, 1);
  assert.equal(actual.attempts, 12); assert.equal(actual.completed, 6); assert.equal(actual.failed, 3); assert.equal(actual.unknown, 3);
  assert.equal(actual.denominator, 9); assert.equal(actual.completionRate, 67);
  assert.deepEqual(actual.weeks.map(w => [w.week, w.sessions]), [['2026-10-05', 3], ['2026-10-12', 3]]);
  assert.equal(actual.grades.length, 2);
});
test('上海午夜与自然周边界独立于宿主时区', () => {
  assert.equal(todayShanghai('2026-10-11T15:59:59Z'), '2026-10-11');
  assert.equal(todayShanghai('2026-10-11T16:00:00Z'), '2026-10-12');
  assert.equal(monday('2026-10-11'), '2026-10-05'); assert.equal(monday('2026-10-12'), '2026-10-12');
  assert.equal(shiftDate('2026-01-01', -1), '2025-12-31');
});
test('零记录与零分母返回 null，不生成 NaN 或负面趋势', () => {
  const result = stats(emptyState('alice'), ...range);
  assert.equal(result.completionRate, null); assert.equal(result.sessions, 0); assert.equal(result.weeks.length, 2);
});
test('同一 requestId 保存幂等；变更内容不能复用请求编号', () => {
  const s = fixture(); const data = { gymId: s.gyms[0]._id, sessionDate: '2026-10-19' };
  const cmd = { action: 'session.save', requestId: 'same_request_001', data };
  const first = execute(s, cmd, context()); const replay = execute(first.state, cmd, context());
  assert.equal(replay.state.sessions.length, s.sessions.length + 1); assert.equal(replay.state.revision, first.state.revision);
  assert.equal((replay.value as any)._id, (first.value as any)._id);
  assert.throws(() => execute(first.state, { ...cmd, data: { ...data, trainingNotes: '另一个内容' } }, context()), error('VERSION_CONFLICT'));
});
test('旧版本编辑不能覆盖新记录', () => {
  const s = fixture(); const old = s.sessions[0];
  assert.throws(() => dispatch(s, 'session.save', { ...old, id: old._id, version: old.version - 1 }), error('VERSION_CONFLICT'));
});
test('输入校验拒绝无效日期、未来日期、0分钟与非整数强度', () => {
  const s = fixture();
  for (const data of [{ sessionDate: '2026-02-30' }, { sessionDate: '2026-10-20' }, { sessionDate: '2026-10-19', durationMinutes: 0 }, { sessionDate: '2026-10-19', perceivedEffort: 1.5 }]) {
    assert.throws(() => dispatch(s, 'session.save', { gymId: s.gyms[0]._id, ...data }), error('VALIDATION_ERROR'));
  }
});
test('岩馆修改不重写历史快照，归档馆保留统计', () => {
  let s = fixture(); const before = s.sessions[0].gymSnapshot;
  s = dispatch(s, 'gym.save', { id: s.gyms[0]._id, name: '改名', gradeSystem: '别的体系' }).state;
  assert.deepEqual(s.sessions[0].gymSnapshot, before); assert.equal(stats(s, ...range).sessions, 6);
  assert.throws(() => dispatch(s, 'session.save', { gymId: s.gyms[1]._id, sessionDate: '2026-10-19' }), error('VALIDATION_ERROR'));
});
test('含有尝试的训练不能直接换馆', () => {
  const s = fixture(); const session = s.sessions[1];
  assert.throws(() => dispatch(s, 'session.save', { ...session, id: session._id, gymId: s.gyms[0]._id }), error('VALIDATION_ERROR'));
});
test('ownerId 不能从客户端伪造，其他用户不能读写记录', () => {
  const s = fixture();
  assert.throws(() => dispatch(s, 'session.delete', { id: s.sessions[0]._id }, { ownerId: 'bob' }), error('FORBIDDEN'));
  const foreign = { ...s, gyms: s.gyms.map(g => ({ ...g, ownerId: 'bob' })) };
  assert.throws(() => dispatch(foreign, 'session.save', { gymId: foreign.gyms[0]._id, sessionDate: '2026-10-19', ownerId: 'alice' }), error('NOT_FOUND'));
});
test('视频配额包括预约和待删除，超限预约被拒绝', () => {
  let s = fixture();
  const count = Math.floor(VIDEO_QUOTA / MAX_VIDEO_BYTES);
  for (let i = 0; i < count; i++) s = dispatch(s, 'video.reserve', { byteSize: MAX_VIDEO_BYTES, durationSec: MAX_VIDEO_SECONDS }).state;
  assert.equal(s.videos.reduce((n, v) => n + v.byteSize, 0), count * MAX_VIDEO_BYTES);
  assert.throws(() => dispatch(s, 'video.reserve', { byteSize: MAX_VIDEO_BYTES, durationSec: MAX_VIDEO_SECONDS }), error('QUOTA_EXCEEDED'));
  s = dispatch(s, 'video.delete', { id: s.videos[0]._id }).state;
  assert.throws(() => dispatch(s, 'video.reserve', { byteSize: MAX_VIDEO_BYTES, durationSec: MAX_VIDEO_SECONDS }), error('QUOTA_EXCEEDED'));
});
test('视频预约接受原上限、61秒/51MiB与300秒/100MiB，新上限严格生效', () => {
  for (const [byteSize, durationSec] of [[50 * 1024 * 1024, 60], [51 * 1024 * 1024, 61], [MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS]]) {
    const result = dispatch(fixture(), 'video.reserve', { byteSize, durationSec });
    assert.equal(result.state.videos[0].byteSize, byteSize); assert.equal(result.state.videos[0].durationSec, durationSec);
  }
  for (const data of [{ byteSize: MAX_VIDEO_BYTES + 1, durationSec: 10 }, { byteSize: 1000, durationSec: MAX_VIDEO_SECONDS + 0.01 }]) {
    assert.throws(() => dispatch(fixture(), 'video.reserve', data), error('VALIDATION_ERROR'));
  }
});
test('客户端不能自行确认上传或删除，过期预约不能完成', () => {
  const reserved = dispatch(fixture(), 'video.reserve', { byteSize: 100, durationSec: 5 }); const v = reserved.state.videos[0];
  assert.throws(() => dispatch(reserved.state, 'video.ready', { id: v._id, localPath: '/saved.mp4' }), error('FORBIDDEN'));
  assert.throws(() => dispatch(reserved.state, 'video.purged', { id: v._id }), error('FORBIDDEN'));
  assert.throws(() => dispatch(reserved.state, 'video.ready', { id: v._id, localPath: '/saved.mp4' }, { trustedMedia: true, now: '2026-10-21T00:00:00Z' }), error('UPLOAD_EXPIRED'));
});
test('重复上传确认不重复结算；不能关联其他训练的尝试', () => {
  let s = dispatch(fixture(), 'video.reserve', { byteSize: 100, durationSec: 5 }).state; const v = s.videos[0];
  s = dispatch(s, 'video.ready', { id: v._id, localPath: '/saved.mp4' }, { trustedMedia: true }).state;
  s = dispatch(s, 'video.ready', { id: v._id, localPath: '/saved.mp4' }, { trustedMedia: true }).state;
  assert.equal(s.videos.length, 1); assert.equal(s.videos[0].byteSize, 100);
  assert.throws(() => dispatch(s, 'video.link', { id: v._id, sessionId: s.sessions[1]._id, attemptId: s.attempts[0]._id }), error('VALIDATION_ERROR'));
});
test('删除训练默认保留视频并解除关联；明确选择时排队删除', () => {
  for (const deleteVideos of [false, true]) {
    let s = fixture(); const sid = s.sessions[0]._id;
    s = dispatch(s, 'video.reserve', { sessionId: sid, byteSize: 100, durationSec: 5 }).state;
    s = dispatch(s, 'video.ready', { id: s.videos[0]._id, localPath: '/saved.mp4' }, { trustedMedia: true }).state;
    s = dispatch(s, 'session.delete', { id: sid, deleteVideos }).state;
    assert.equal(s.videos[0].sessionId, null); assert.equal(s.videos[0].attemptId, null);
    assert.equal(s.videos[0].status, deleteVideos ? 'deleting' : 'ready');
    assert.equal(s.attempts.some(a => a.sessionId === sid), false);
  }
});
test('修改训练和尝试均让旧复盘失效、清除快照、取消依赖目标', () => {
  for (const attempt of [false, true]) {
    let s = createReview(fixture()).state; const rid = s.reviews[0]._id;
    s = dispatch(s, 'goal.save', { reviewId: rid, text: '来源建议' }).state;
    const session = s.sessions[0];
    if (attempt) s = dispatch(s, 'attempt.save', { ...s.attempts[0], id: s.attempts[0]._id }).state;
    else s = dispatch(s, 'session.save', { ...session, id: session._id, trainingNotes: '改过的备注' }).state;
    assert.equal(s.reviews[0].status, 'stale'); assert.equal(s.reviews[0].inputSnapshot, undefined); assert.equal(s.reviews[0].output, undefined);
    assert.equal(s.goals[0].status, 'cancelled');
  }
});
test('删除来源清理复盘派生文字与含旧内容的幂等缓存', () => {
  let s = createReview(fixture()).state;
  s = dispatch(s, 'goal.save', { reviewId: s.reviews[0]._id, text: '私密派生内容', userFeedback: '私密反馈' }).state;
  s = dispatch(s, 'session.delete', { id: s.sessions[0]._id }).state;
  const json = JSON.stringify(s); assert.equal(json.includes('私密派生内容'), false); assert.equal(json.includes('私密反馈'), false);
  assert.equal(s.operations.length, 0); assert.equal(s.reviews[0].output, undefined);
});
test('目标必须在建立当日或以后的训练核对，删除核对训练会撤销旧结果', () => {
  let s = fixture(); s = dispatch(s, 'goal.save', { text: '下次记录休息间隔' }).state;
  assert.throws(() => dispatch(s, 'goal.followup', { id: s.goals[0]._id, status: 'completed', sessionId: s.sessions[0]._id }), error('VALIDATION_ERROR'));
  s = dispatch(s, 'session.save', { gymId: s.gyms[0]._id, sessionDate: '2026-10-19' }).state;
  const sid = s.sessions[s.sessions.length - 1]._id;
  s = dispatch(s, 'goal.followup', { id: s.goals[0]._id, status: 'completed', sessionId: sid, userFeedback: '做到了' }).state;
  assert.equal(s.goals[0].status, 'completed');
  s = dispatch(s, 'session.delete', { id: sid }).state; assert.equal(s.goals[0].status, 'active'); assert.equal(s.goals[0].userFeedback, '');
});
test('AI 输入去除微信身份和岩馆名；备注默认不进入输入', () => {
  const s = fixture(); const input = reviewInput(s, ...range, false); const raw = JSON.stringify(input);
  assert.equal(raw.includes('测试岩馆甲'), false); assert.equal(raw.includes('alice'), false); assert.equal(raw.includes('合成备注'), false);
  assert.equal(input.records[0].notes, ''); assert.equal(input.previousGoals.length, 0);
  assert.equal(reviewInput(s, ...range, true).records[0].notes.includes('合成备注'), true);
});
test('一次训练仅单次回顾，没有数据不能生成复盘', () => {
  const s = fixture(); const input = reviewInput(s, '2026-10-05', '2026-10-05', false);
  assert.ok(ruleReview(input).limitations[0].includes('单次回顾'));
  assert.throws(() => reviewInput(s, '2026-01-01', '2026-01-02', false), error('DATA_INSUFFICIENT'));
});
test('AI 未配置或未授权时拒绝创建；每天最多三次', () => {
  let s = fixture();
  assert.throws(() => dispatch(s, 'review.create', { from: range[0], to: range[1], mode: 'ai' }), error('AI_UNAVAILABLE'));
  const revoked = dispatch(s, 'privacy.set', { ai: false }).state;
  assert.throws(() => createReview(revoked, 'ai'), error('CONSENT_REQUIRED'));
  for (let i = 0; i < 3; i++) s = createReview(s, 'ai').state;
  assert.throws(() => createReview(s, 'ai'), error('AI_RATE_LIMIT'));
});
test('AI 工作租约阻止重复领取；来源修改或撤回授权后不得写入结果', () => {
  for (const revoke of [false, true]) {
    let s = createReview(fixture(), 'ai').state; const rid = s.reviews[0]._id;
    s = dispatch(s, 'review.claim', { id: rid }, { trustedWorker: true }).state; const job = s.reviews[0];
    assert.throws(() => dispatch(s, 'review.claim', { id: rid }, { trustedWorker: true }), error('VERSION_CONFLICT'));
    if (revoke) s = dispatch(s, 'privacy.set', { ai: false }).state;
    else s = dispatch(s, 'session.save', { ...s.sessions[0], id: s.sessions[0]._id, trainingNotes: '已经变了' }).state;
    assert.throws(() => dispatch(s, 'review.result', { id: rid, leaseUntil: job.leaseUntil, output: ruleReview(job.inputSnapshot!), modelVersion: 'test', tokenUsage: 10 }, { trustedWorker: true }), error('VERSION_CONFLICT'));
  }
});
test('账号数据删除立即移除业务内容，物理文件未清理前保留配额和待删除状态', () => {
  let s = fixture(); s = dispatch(s, 'video.reserve', { byteSize: 100, durationSec: 5 }).state;
  s = dispatch(s, 'account.delete', {}).state;
  assert.equal(s.sessions.length, 0); assert.equal(s.gyms.length, 0); assert.equal(s.operations.length, 0);
  assert.equal(s.videos[0].status, 'deleting'); assert.equal(s.accountDeleting, true);
  s = dispatch(s, 'video.purged', { id: s.videos[0]._id }, { trustedMedia: true }).state;
  assert.equal(s.accountDeleting, false); assert.equal(s.videos.length, 0);
});
test('数据导出不含播放地址、云路径和本机视频路径', () => {
  let s = dispatch(fixture(), 'video.reserve', { byteSize: 100, durationSec: 5 }).state;
  s = dispatch(s, 'video.ready', { id: s.videos[0]._id, localPath: '/private/device.mp4' }, { trustedMedia: true }).state;
  const data = exportData(s); const raw = JSON.stringify(data);
  assert.equal(raw.includes('/private/device.mp4'), false); assert.equal('operations' in data, false);
});

// These are synthetic schema/reference regression cases, not real-model or user-effect evidence.
const cases: [string, (o: any) => unknown, boolean][] = [
  ['完整数据摘要', o => o, true],
  ['允许空推测', o => ({ ...o, hypotheses: [] }), true],
  ['两个行动', o => ({ ...o, actions: [o.actions[0], { ...o.actions[0], text: '另一个小目标' }] }), true],
  ['伪造引用', o => ({ ...o, observations: [{ text: '伪造', evidenceIds: ['not-a-record'] }] }), false],
  ['改写统计摘要', o => ({ ...o, summary: '你记录了99次训练' }), false],
  ['有合法引用但伪造统计事实', o => ({ ...o, observations: [{ text: '完成率达到100%', evidenceIds: o.observations[0].evidenceIds }] }), false],
  ['引用为空', o => ({ ...o, observations: [{ text: '未引用', evidenceIds: [] }] }), false],
  ['缺少摘要', o => ({ ...o, summary: undefined }), false],
  ['空摘要', o => ({ ...o, summary: '' }), false],
  ['缺少观察字段', o => ({ ...o, observations: undefined }), false],
  ['没有行动', o => ({ ...o, actions: [] }), false],
  ['过多行动', o => ({ ...o, actions: [o.actions[0], o.actions[0], o.actions[0]] }), false],
  ['缺少核对指标', o => ({ ...o, actions: [{ text: '尝试', followupQuestion: '结果如何' }] }), false],
  ['推测缺少不确定性', o => ({ ...o, hypotheses: [{ text: '推测', reason: '备注' }] }), false],
  ['伪视频结论', o => ({ ...o, summary: '视频显示你的肩部无力' }), false],
  ['伤病确诊', o => ({ ...o, summary: '已经确诊手指损伤' }), false],
  ['药物处方', o => ({ ...o, summary: '请服用某药20毫克' }), false],
  ['虚构受伤概率', o => ({ ...o, summary: '受伤概率 90%' }), false],
  ['限制字段类型错误', o => ({ ...o, limitations: '没有限制' }), false],
  ['空限制文字', o => ({ ...o, limitations: [''] }), false],
  ['输出过长', o => ({ ...o, summary: '长'.repeat(1201) }), false],
  ['不是对象', () => null, false],
  ['数组对象', () => [], false],
  ['正常谨慎推测', o => ({ ...o, hypotheses: [{ text: '可以观察休息间隔', reason: '用户备注提到后半段握力下降', uncertainty: '没有休息时长记录，暂不能确定原因' }] }), true],
];
for (const [name, mutate, valid] of cases) test('合成复盘协议评测：' + name, () => {
  const input = reviewInput(fixture(), ...range, true); const output = mutate(ruleReview(input));
  if (valid) assert.ok(validateOutput(output, input)); else assert.throws(() => validateOutput(output, input), error('AI_INVALID_OUTPUT'));
});
