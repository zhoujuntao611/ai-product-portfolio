import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildSync } from 'esbuild';
import { emptyState, execute, State } from '../src/shared/domain';
import { latestReusableSession, recentGyms, recentGrades, reuseSessionForm } from '../src/shared/quick-record';

function seed(): State {
  let state = emptyState('device'); let sequence = 0;
  const act = (action: string, data: Record<string, unknown>) => {
    state = execute(state, { action, data, requestId: 'quick_request_' + (++sequence) }, {
      ownerId: 'device', now: '2026-10-21T02:00:00Z', newId: prefix => prefix + '_' + (++sequence),
    }).state;
  };
  act('privacy.set', { privacy: true });
  for (const name of ['最早加入的馆', '最近训练的馆', '已归档的馆']) act('gym.save', { name, gradeSystem: '馆内标签' });
  for (const [index, date, grade] of [[0, '2026-10-10', 'V1'], [1, '2026-10-18', '蓝色'], [1, '2026-10-19', '紫色'], [2, '2026-10-20', '黑色']] as const) {
    act('session.save', { gymId: state.gyms[index]._id, sessionDate: date, durationMinutes: 75,
      trainingNotes: '热身后练脚步', feeling: '上次状态很好', perceivedEffort: 8 });
    act('attempt.save', { sessionId: state.sessions[state.sessions.length - 1]._id, routeLabel: '角落线', gradeLabel: grade, result: 'unknown' });
  }
  act('attempt.save', { sessionId: state.sessions[2]._id, routeLabel: '长线', gradeLabel: '蓝色', result: 'unknown' });
  act('attempt.save', { sessionId: state.sessions[2]._id, routeLabel: '另一条线', gradeLabel: '紫色', result: 'unknown' });
  act('attempt.save', { sessionId: state.sessions[2]._id, routeLabel: '未知难度', result: 'unknown' });
  act('gym.archive', { id: state.gyms[2]._id });
  return state;
}

const bundle = buildSync({ entryPoints: ['src/miniprogram/pages/session-edit/index.ts'], bundle: true, write: false,
  platform: 'neutral', format: 'cjs', target: 'es2018', define: { PANJI_CLOUD_ENV: '""' } }).outputFiles[0].text;

function device(state = seed()) {
  const storage = new Map<string, any>([['panji.data.v1', state]]); const modals: any[] = []; const toasts: string[] = []; const navigation: string[] = [];
  let confirm = true;
  const wx = {
    getStorageSync: (key: string) => structuredClone(storage.get(key) ?? ''),
    setStorageSync: (key: string, value: any) => storage.set(key, structuredClone(value)),
    removeStorageSync: (key: string) => storage.delete(key),
    showToast: ({ title }: any) => toasts.push(title),
    showModal: async (options: any) => { modals.push(options); return { confirm }; },
    redirectTo: ({ url }: any) => navigation.push(url),
  };
  const page = () => {
    let result: any;
    vm.runInNewContext(bundle, { wx, Page: (definition: any) => { result = definition; }, console, exports: {}, module: { exports: {} } });
    result.data = structuredClone(result.data);
    result.setData = (values: Record<string, any>) => {
      for (const [key, value] of Object.entries(values)) {
        const parts = key.split('.'); let target = result.data;
        for (const part of parts.slice(0, -1)) target = target[part]; target[parts[parts.length - 1]] = structuredClone(value);
      }
    };
    return result;
  };
  return { storage, modals, toasts, navigation, page, cancel: () => { confirm = false; } };
}
const field = (name: string, value: string) => ({ currentTarget: { dataset: { field: name } }, detail: { value } });

test('复用只复制安排字段，归档岩馆不成为新训练默认值，原训练不变', () => {
  const state = seed(); const original = structuredClone(state);
  const source = latestReusableSession(state)!;
  assert.equal(source.gymId, state.gyms[1]._id);
  assert.deepEqual(recentGyms(state).map(gym => gym._id), [state.gyms[1]._id, state.gyms[0]._id]);
  assert.deepEqual(reuseSessionForm(source, '2026-10-21'), {
    gymId: source.gymId, sessionDate: '2026-10-21', durationMinutes: '75', trainingNotes: '热身后练脚步', feeling: '', perceivedEffort: '',
  });
  assert.equal(reuseSessionForm({ ...source, durationMinutes: null }, '2026-10-21').durationMinutes, '');
  assert.deepEqual(state, original);
});

test('常用难度保留同馆原标签，按最近尝试去重，不混入别馆或未填难度', () => {
  const state = seed();
  assert.deepEqual(recentGrades(state, state.gyms[1]._id), ['紫色', '蓝色']);
  assert.deepEqual(recentGrades(state, state.gyms[0]._id), ['V1']);
  assert.deepEqual(recentGrades(state, state.gyms[1]._id, 1), ['紫色']);
  assert.deepEqual(recentGrades(state, state.gyms[1]._id, 0), []);
  assert.deepEqual(recentGrades(state, 'missing'), []);
});

test('新表单默认最近训练的可用岩馆；显式复用生成今天的独立记录', async () => {
  const d = device(); const p = d.page(); p.onLoad({}); await p.onShow();
  const before = structuredClone(d.storage.get('panji.data.v1'));
  assert.equal(p.data.form.gymId, before.gyms[1]._id); assert.equal(p.data.form.trainingNotes, '');
  await p.reuseLast();
  assert.equal(d.modals.length, 0); assert.equal(p.data.form.sessionDate, p.data.today);
  assert.equal(p.data.form.feeling, ''); assert.equal(p.data.form.perceivedEffort, '');
  assert.equal(p.data.reused, true); assert.equal(p.data.form.durationMinutes, '75');
  await p.save();
  const after = d.storage.get('panji.data.v1');
  assert.deepEqual(after.sessions.slice(0, -1), before.sessions);
  assert.equal(after.sessions.length, before.sessions.length + 1);
  assert.equal(after.sessions.at(-1).feeling, ''); assert.equal(after.sessions.at(-1).perceivedEffort, null);
});

test('草稿恢复优先于默认岩馆；取消复用保留全部输入与草稿', async () => {
  const d = device(); const p = d.page(); p.onLoad({}); await p.onShow();
  p.recentGym({ currentTarget: { dataset: { id: d.storage.get('panji.data.v1').gyms[0]._id } } });
  p.field(field('trainingNotes', '未保存的新安排')); p.field(field('feeling', '本次感受'));
  const reopened = d.page(); reopened.onLoad({}); await reopened.onShow();
  assert.equal(reopened.data.recovered, true); assert.equal(reopened.data.form.gymId, p.data.form.gymId);
  const before = structuredClone(d.storage.get('panji.draft.local.new'));
  d.cancel(); await reopened.reuseLast();
  assert.equal(d.modals.length, 1); assert.deepEqual(d.storage.get('panji.draft.local.new'), before);
  assert.equal(reopened.data.form.trainingNotes, '未保存的新安排'); assert.equal(reopened.data.form.feeling, '本次感受');
});

test('编辑已有训练不能复用覆盖；旧编辑页重显或复用不会抢占新草稿', async () => {
  const d = device(); const old = d.page(); old.onLoad({}); await old.onShow();
  const newer = d.page(); newer.onLoad({}); await newer.onShow(); newer.field(field('trainingNotes', '最新草稿'));
  const before = structuredClone(d.storage.get('panji.draft.local.new'));
  await old.onShow(); await old.reuseLast(); old.onUnload();
  assert.deepEqual(d.storage.get('panji.draft.local.new'), before);
  assert.ok(d.toasts.includes('请返回最新打开的训练表单继续填写'));
  const edit = d.page(); edit.onLoad({ id: d.storage.get('panji.data.v1').sessions[0]._id }); await edit.onShow();
  const form = structuredClone(edit.data.form); await edit.reuseLast(); assert.deepEqual(edit.data.form, form);
});

test('目录明确选择的岩馆优先于最近使用，但不替换已写内容', async () => {
  const d = device(); const state = d.storage.get('panji.data.v1');
  d.storage.set('panji.selectedGym', state.gyms[0]._id);
  const p = d.page(); p.onLoad({}); await p.onShow();
  assert.equal(p.data.form.gymId, state.gyms[0]._id); assert.equal(d.storage.has('panji.selectedGym'), false);
  p.field(field('trainingNotes', '本次安排')); p.onHide(); await p.onShow();
  assert.equal(p.data.form.trainingNotes, '本次安排'); assert.equal(p.data.form.gymId, state.gyms[0]._id);
});

test('从线路项目新建训练时选中对应岩馆，保存后只向同馆有效项目传递关联', async () => {
  const state = seed();
  state.projects = [{ ...state.gyms[0], _id: 'project_quick', gymId: state.gyms[0]._id,
    routeLabel: '红色屋檐', gradeLabel: 'V3', status: 'active' }];
  const d = device(state); const p = d.page();
  p.onLoad({ projectId: 'project_quick', gymId: state.gyms[0]._id }); await p.onShow();
  assert.equal(p.data.form.gymId, state.gyms[0]._id); assert.match(p.data.projectHint, /红色屋檐/);
  await p.save(); assert.match(d.navigation[0], /&projectId=project_quick$/);

  const another = device(state); const other = another.page();
  other.onLoad({ projectId: 'project_quick', gymId: state.gyms[0]._id }); await other.onShow();
  other.recentGym({ currentTarget: { dataset: { id: state.gyms[1]._id } } });
  await other.save(); assert.doesNotMatch(another.navigation[0], /projectId=/);
});

test('线路项目入口不会覆盖其他岩馆的未保存草稿', async () => {
  const state = seed();
  state.projects = [{ ...state.gyms[0], _id: 'project_quick', gymId: state.gyms[0]._id,
    routeLabel: '红色屋檐', gradeLabel: 'V3', status: 'active' }];
  const d = device(state); const draft = d.page(); draft.onLoad({}); await draft.onShow();
  draft.field(field('trainingNotes', '正在填写的草稿'));
  const fromProject = d.page(); fromProject.onLoad({ projectId: 'project_quick', gymId: state.gyms[0]._id }); await fromProject.onShow();
  assert.equal(fromProject.data.form.gymId, state.gyms[1]._id); assert.equal(fromProject.data.form.trainingNotes, '正在填写的草稿');
  assert.ok(d.toasts.includes('已保留草稿，请确认项目岩馆'));
  await fromProject.save(); assert.doesNotMatch(d.navigation[0], /projectId=/);
});
