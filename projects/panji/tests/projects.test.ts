import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildSync } from 'esbuild';
import { DomainError, State, emptyState, exportData, publicState } from '../src/shared/domain';
import { linkedProject, projectHistory, projectSummaries } from '../src/shared/projects';
import { Repository } from '../cloudfunctions/panji/repository';
import { context, dispatch, fixture } from './fixtures';

const error = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;
function addProject(state: State, routeLabel = '屋檐蓝线') {
  return dispatch(state, 'project.save', { gymId: state.gyms[0]._id, routeLabel, gradeLabel: 'V3', notes: '末段换脚' });
}

test('旧数据没有 projects 仍可读取；同名线路始终独立建项，不按名称合并', () => {
  let s = fixture(); delete s.projects;
  assert.deepEqual(projectSummaries(s), []);
  s = addProject(s).state; s = addProject(s).state;
  assert.equal(s.projects!.length, 2); assert.notEqual(s.projects![0]._id, s.projects![1]._id);
  assert.equal(projectSummaries(s).every(p => p.attemptCount === 0), true);
});

test('项目按显式关联串起跨训练尝试、卡点与本机视频，不吸收同名的未关联尝试', () => {
  let s = addProject(fixture(), '测试蓝线').state; const projectId = s.projects![0]._id;
  const attempts = s.attempts.filter(a => s.sessions.find(t => t._id === a.sessionId)?.gymId === s.gyms[0]._id);
  for (const a of [attempts[0], attempts[attempts.length - 1]]) {
    s = dispatch(s, 'attempt.save', { ...a, id: a._id, projectId, notes: a === attempts[0] ? '第一次脚点太高' : '末次换脚更稳' }).state;
  }
  const target = s.attempts.find(a => a.projectId === projectId)!;
  s = dispatch(s, 'video.reserve', { sessionId: target.sessionId, byteSize: 100, durationSec: 5 }).state;
  const videoId = s.videos[0]._id;
  s = dispatch(s, 'video.ready', { id: videoId, localPath: '/synthetic.mp4' }, { trustedMedia: true }).state;
  s = dispatch(s, 'video.link', { id: videoId, sessionId: target.sessionId, attemptId: target._id }).state;
  const summary = projectSummaries(s)[0];
  assert.equal(summary.sessionCount, 2); assert.equal(summary.attemptCount, 2); assert.equal(summary.videoCount, 1);
  assert.equal(summary.lastNotes, '末次换脚更稳'); assert.equal(summary.lastDate, '2026-10-16');
  assert.deepEqual(projectHistory(s, projectId).map(h => h.session.sessionDate), ['2026-10-16', '2026-10-05']);
  assert.equal(linkedProject(s, target)?._id, projectId);
});

test('关联必须属于自己和同馆；新关联不能使用已归档项目；恢复和历史编辑保留', () => {
  let s = addProject(fixture()).state; const projectId = s.projects![0]._id, ownAttempt = s.attempts[0];
  const foreignGymAttempt = s.attempts.find(a => s.sessions.find(t => t._id === a.sessionId)?.gymId === s.gyms[1]._id)!;
  assert.throws(() => dispatch(s, 'attempt.save', { ...foreignGymAttempt, id: foreignGymAttempt._id, projectId }), error('VALIDATION_ERROR'));
  assert.throws(() => dispatch(s, 'attempt.save', { ...ownAttempt, id: ownAttempt._id, projectId: 'project_missing' }), error('NOT_FOUND'));
  s = dispatch(s, 'attempt.save', { ...ownAttempt, id: ownAttempt._id, projectId }).state;
  s = dispatch(s, 'project.status', { id: projectId, status: 'archived' }).state;
  s = dispatch(s, 'attempt.save', { ...ownAttempt, id: ownAttempt._id, projectId, notes: '历史补充' }).state;
  assert.throws(() => dispatch(s, 'attempt.save', { sessionId: ownAttempt.sessionId, routeLabel: '新尝试', result: 'failed', projectId }), error('VALIDATION_ERROR'));
  s = dispatch(s, 'project.status', { id: projectId, status: 'active' }).state;
  s = dispatch(s, 'attempt.save', { sessionId: ownAttempt.sessionId, routeLabel: '新尝试', result: 'failed', projectId }).state;
  assert.equal(projectSummaries(s)[0].attemptCount, 2);
  const foreign = { ...s, projects: s.projects!.map(p => ({ ...p, ownerId: 'bob' })) };
  assert.throws(() => dispatch(foreign, 'project.status', { id: projectId, status: 'completed' }), error('NOT_FOUND'));
  assert.throws(() => dispatch(foreign, 'attempt.save', { ...ownAttempt, id: ownAttempt._id, projectId }), error('NOT_FOUND'));
});

test('项目改名不覆盖历史尝试；标完成不捏造尝试结果；项目不能换馆', () => {
  let s = addProject(fixture()).state; const projectId = s.projects![0]._id;
  const original = s.attempts[0];
  s = dispatch(s, 'attempt.save', { ...original, id: original._id, projectId, result: 'failed' }).state;
  s = dispatch(s, 'project.status', { id: projectId, status: 'completed' }).state;
  s = dispatch(s, 'project.save', { id: projectId, gymId: s.gyms[0]._id, routeLabel: '新名称', gradeLabel: 'V4', notes: '改卡点' }).state;
  assert.equal(s.projects![0].status, 'completed'); assert.equal(s.attempts[0].routeLabel, original.routeLabel);
  assert.equal(s.attempts[0].gradeLabel, original.gradeLabel); assert.equal(s.attempts[0].result, 'failed');
  assert.equal(projectSummaries(s)[0].completedCount, 0);
  assert.throws(() => dispatch(s, 'project.save', { id: projectId, gymId: s.gyms[1]._id, routeLabel: '换馆' }), error('VALIDATION_ERROR'));
});

test('删除有超过20条尝试的项目不批改历史；逻辑解除与导出一致，原尝试和视频保留', () => {
  let s = addProject(fixture()).state; const projectId = s.projects![0]._id;
  for (let i = 0; i < 25; i++) s = dispatch(s, 'attempt.save', { sessionId: s.sessions[0]._id, projectId, routeLabel: '项目尝试 ' + i, result: 'failed' }).state;
  const attempts = structuredClone(s.attempts), sessions = structuredClone(s.sessions);
  s = dispatch(s, 'project.delete', { id: projectId }).state;
  assert.deepEqual(s.attempts, attempts); assert.deepEqual(s.sessions, sessions); assert.equal(s.projects!.length, 0);
  assert.deepEqual(projectHistory(s, projectId), []); assert.deepEqual(s.operations, []);
  const old = s.attempts.find(a => a.projectId === projectId)!;
  assert.equal(linkedProject(s, old), undefined);
  assert.equal(JSON.stringify(exportData(s)).includes(projectId), false);
  assert.throws(() => dispatch(s, 'attempt.save', { ...old, id: old._id, projectId }), error('NOT_FOUND'));
  const { projectId: _projectId, ...withoutProject } = old;
  s = dispatch(s, 'attempt.save', { ...withoutProject, id: old._id }).state;
  assert.equal(s.attempts.find(a => a._id === old._id)!.projectId, undefined);
});

test('项目配额80，归档仍计入；单项可修改，删除后释放配额；账号删除和墓碑清空项目', () => {
  let s = fixture();
  for (let i = 0; i < 80; i++) s = addProject(s, '合成项目' + i).state;
  const projectId = s.projects![0]._id;
  s = dispatch(s, 'project.status', { id: projectId, status: 'archived' }).state;
  assert.throws(() => addProject(s), error('QUOTA_EXCEEDED'));
  s = dispatch(s, 'project.save', { id: projectId, gymId: s.gyms[0]._id, routeLabel: '更新项目' }).state;
  s = dispatch(s, 'project.delete', { id: projectId }).state; s = addProject(s).state;
  assert.equal(s.projects!.length, 80);
  assert.deepEqual(publicState({ ...s, accountDeleting: true }).projects, []);
  const exported = exportData(s); assert.equal((exported.projects as unknown[]).length, 80);
  s = dispatch(s, 'account.delete', {}).state; assert.deepEqual(s.projects, []);
  assert.equal(JSON.stringify(s).includes('合成项目'), false);
});

function memoryDatabase() {
  let records = new Map<string, any>();
  const api = (values: Map<string, any>) => ({ collection(name: string) { return {
    ownerId: '', offset: 0, max: 100,
    where(filter: any) { this.ownerId = filter.ownerId; return this; }, orderBy() { return this; },
    skip(value: number) { this.offset = value; return this; }, limit(value: number) { this.max = value; return this; },
    async get() { return { data: [...values.entries()].filter(([key, v]) => key.startsWith(name + '/') && v.ownerId === this.ownerId)
      .map(([key, v]) => ({ ...structuredClone(v), _id: key.slice(name.length + 1) })).slice(this.offset, this.offset + this.max) }; },
    doc(id: string) { const key = name + '/' + id; return {
      async get() { if (!values.has(key)) throw new Error('document does not exist'); return { data: { ...structuredClone(values.get(key)), _id: id } }; },
      async set({ data }: any) { values.set(key, structuredClone(data)); }, async remove() { values.delete(key); },
    }; },
  }; } });
  return { collection(name: string) { return api(records).collection(name); },
    async runTransaction(fn: any) { const draft = structuredClone(records); await fn(api(draft)); records = draft; } };
}

test('项目存入账号元数据、尝试保留显式关联，旧账号和跨用户读取兼容', async () => {
  const repo = new Repository(memoryDatabase()); let before = await repo.read('alice');
  let after = dispatch(before, 'gym.save', { name: '合成馆', gradeSystem: 'V' }).state;
  // Persist a genuine pre-project account shape, then add new metadata without another collection.
  delete after.projects; await repo.commit(before, after); before = await repo.read('alice');
  assert.deepEqual(projectSummaries(before), []);
  after = addProject(before).state; await repo.commit(before, after); before = await repo.read('alice');
  const project = before.projects![0]; assert.equal(project.routeLabel, '屋檐蓝线');
  assert.deepEqual((await repo.read('bob')).projects, []);
  after = dispatch(before, 'session.save', { gymId: before.gyms[0]._id, sessionDate: context().now.slice(0, 10) }).state;
  after = dispatch(after, 'attempt.save', { sessionId: after.sessions[0]._id, projectId: project._id, routeLabel: '蓝线', result: 'failed' }).state;
  await repo.commit(before, after);
  assert.equal(projectSummaries(await repo.read('alice'))[0].attemptCount, 1);
  await repo.beginDeletion('alice', 'delete_projects_001');
  assert.deepEqual(publicState(await repo.read('alice')).projects, []);
  for (let i = 0; i < 5; i++) await repo.deleteBusinessBatch('alice');
  assert.equal(await repo.finishDeletion('alice'), true); assert.deepEqual((await repo.read('alice')).projects, []);
});

const detailBundle = buildSync({ entryPoints: ['src/miniprogram/pages/session-detail/index.ts'], bundle: true, write: false,
  platform: 'neutral', format: 'cjs', target: 'es2018', define: { PANJI_CLOUD_ENV: '""' } }).outputFiles[0].text;
function detailDevice() {
  let state = emptyState('device');
  state = dispatch(state, 'gym.save', { name: '合成馆', gradeSystem: 'V 等级' }, { ownerId: 'device' }).state;
  state = dispatch(state, 'session.save', { gymId: state.gyms[0]._id, sessionDate: '2026-10-19' }, { ownerId: 'device' }).state;
  state = dispatch(state, 'project.save', { gymId: state.gyms[0]._id, routeLabel: '蓝线屋檐', gradeLabel: 'V3' }, { ownerId: 'device' }).state;
  const storage = new Map<string, any>([['panji.data.v1', state]]); const messages: any[] = [];
  let page: any;
  const wx = { getStorageSync: (key: string) => structuredClone(storage.get(key) ?? ''),
    setStorageSync: (key: string, value: any) => storage.set(key, structuredClone(value)), removeStorageSync: (key: string) => storage.delete(key),
    pageScrollTo: () => undefined, showToast: () => undefined, showModal: async (options: any) => { messages.push(options); return { confirm: true }; },
  };
  vm.runInNewContext(detailBundle, { wx, Page: (definition: any) => { page = definition; }, console, exports: {}, module: { exports: {} } });
  page.data = structuredClone(page.data);
  page.setData = (values: Record<string, any>, done?: () => void) => {
    for (const [key, value] of Object.entries(values)) {
      const parts = key.split('.'); let target = page.data;
      for (const part of parts.slice(0, -1)) target = target[part]; target[parts[parts.length - 1]] = structuredClone(value);
    } done?.();
  };
  return { page, storage, messages, state };
}

test('从项目进入训练详情：尝试默认关联，连续保存保留项目、每次结果重新选择', async () => {
  const d = detailDevice(), p = d.page, project = d.state.projects![0];
  p.onLoad({ id: d.state.sessions[0]._id, projectId: project._id }); await p.onShow();
  assert.equal(p.data.formOpen, true); assert.equal(p.data.attempt.routeLabel, project.routeLabel);
  assert.equal(p.data.attempt.gradeLabel, 'V3'); assert.equal(p.data.attempt.projectId, project._id);
  p.result({ currentTarget: { dataset: { value: 'failed' } } }); await p.saveAndContinue();
  assert.equal(d.messages.length, 0); assert.equal(p.data.formOpen, true); assert.equal(p.data.attempt.result, 'unknown');
  assert.equal(p.data.attempt.projectId, project._id); assert.equal(p.data.attempt.routeLabel, project.routeLabel);
  p.result({ currentTarget: { dataset: { value: 'completed' } } }); await p.saveAttempt();
  const saved = d.storage.get('panji.data.v1');
  assert.equal(saved.attempts.length, 2); assert.deepEqual(saved.attempts.map((a: any) => a.projectId), [project._id, project._id]);
  assert.deepEqual(saved.attempts.map((a: any) => a.result), ['failed', 'completed']);
  assert.equal(projectSummaries(saved)[0].completedCount, 1);
});

test('编辑旧尝试选择项目仅关联，不重写原来的线路名和难度；删除项目后列表解除', async () => {
  const d = detailDevice(), p = d.page, project = d.state.projects![0];
  let s = dispatch(d.state, 'attempt.save', { sessionId: d.state.sessions[0]._id, routeLabel: '原始红线', gradeLabel: '原标签', result: 'failed' }, { ownerId: 'device' }).state;
  d.storage.set('panji.data.v1', s); p.onLoad({ id: s.sessions[0]._id }); await p.onShow();
  p.editAttempt({ currentTarget: { dataset: { id: s.attempts[0]._id } } }); p.selectProject({ detail: { value: 1 } });
  assert.equal(p.data.attempt.routeLabel, '原始红线'); assert.equal(p.data.attempt.gradeLabel, '原标签'); await p.saveAttempt();
  s = d.storage.get('panji.data.v1'); assert.equal(s.attempts[0].projectId, project._id);
  s = dispatch(s, 'project.delete', { id: project._id }, { ownerId: 'device' }).state; d.storage.set('panji.data.v1', s);
  await p.onShow(); assert.equal(p.data.attempts[0].linkedProjectId, ''); assert.equal(p.data.attempts[0].projectLabel, '');
  p.editAttempt({ currentTarget: { dataset: { id: s.attempts[0]._id } } }); assert.equal(p.data.attempt.projectId, '');
});

test('从相册返回且视频尚在保存时不启动训练重载，避免确认期间读取旧状态', async () => {
  const d = detailDevice(), p = d.page; p.onLoad({ id: d.state.sessions[0]._id }); await p.onShow();
  const before = structuredClone(p.data.session); p.setData({ uploading: true, progress: 35 });
  // Returning from the native album can trigger onShow before importVideo has committed its local media.
  d.storage.set('panji.data.v1', { ...d.state, sessions: [] }); await p.onShow();
  assert.deepEqual(p.data.session, before); assert.equal(p.data.error, ''); assert.equal(p.data.progress, 35); assert.equal(p.data.loading, false);
});
