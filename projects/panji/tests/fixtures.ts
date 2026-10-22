import { emptyState, execute, State, Context, Command } from '../src/shared/domain';
let sequence = 0;
export const time = '2026-10-19T04:00:00.000Z';
export function context(extra: Partial<Context> = {}): Context {
  return { ownerId: 'alice', now: time, newId: prefix => prefix + '_' + (++sequence), ...extra };
}
export function dispatch(state: State, action: string, data: Record<string, unknown>, extra: Partial<Context> = {}) {
  return execute(state, { action, data, requestId: 'request_' + (++sequence) }, context(extra));
}
export function fixture(): State {
  let s = emptyState('alice');
  s = dispatch(s, 'privacy.set', { privacy: true, ai: true }).state;
  s = dispatch(s, 'gym.save', { name: '测试岩馆甲（合成）', city: '测试城市', gradeSystem: 'V 等级' }).state;
  s = dispatch(s, 'gym.save', { name: '测试岩馆乙（合成）', gradeSystem: '颜色等级' }).state;
  const dates = ['2026-10-05', '2026-10-07', '2026-10-11', '2026-10-12', '2026-10-16', '2026-10-18'];
  const durations = [60, null, 90, 45, 120, 30];
  for (let i = 0; i < dates.length; i++) {
    const made = dispatch(s, 'session.save', { gymId: s.gyms[i % 2]._id, sessionDate: dates[i], durationMinutes: durations[i], trainingNotes: i === 0 ? '合成备注：后半段握力下降' : '合成测试记录' });
    s = made.state; const session = s.sessions[s.sessions.length - 1];
    for (const result of (i < 3 ? ['completed', 'failed', 'unknown'] : ['completed'])) {
      s = dispatch(s, 'attempt.save', { sessionId: session._id, routeLabel: '测试蓝线', gradeLabel: i % 2 ? '蓝色' : 'V2', result }).state;
    }
  }
  s = dispatch(s, 'gym.archive', { id: s.gyms[1]._id }).state;
  return s;
}
