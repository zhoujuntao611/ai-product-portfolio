import test from 'node:test';
import assert from 'node:assert/strict';
import { Repository, accountCollection, collections, missingDocument } from '../cloudfunctions/panji/repository';
import { emptyState, publicState } from '../src/shared/domain';
import { dispatch } from './fixtures';
test('部署缺少集合时不能伪装成用户还没有记录', () => {
  assert.equal(missingDocument({ errMsg: 'document.get:fail collection pj_accounts does not exist', code: 'DATABASE_COLLECTION_NOT_EXIST' }), false);
  assert.equal(missingDocument({ message: 'document.get: Db or Table not exist: pj_accounts' }), false);
  assert.equal(missingDocument({ message: 'document does not exist' }), true);
  assert.equal(missingDocument({ code: 'DATABASE_DOCUMENT_NOT_EXIST' }), true);
});
function fakeDatabase() {
  let records = new Map<string, any>(); let chain = Promise.resolve();
  const api = (data: Map<string, any>) => ({ collection(name: string) {
    const query = { ownerId: '', offset: 0, max: 100,
      where(filter: any) { this.ownerId = filter.ownerId; return this; }, orderBy() { return this; },
      skip(n: number) { this.offset = n; return this; }, limit(n: number) { this.max = n; return this; },
      async get() { return { data: [...data.entries()].filter(([k, v]) => k.startsWith(name + '/') && v.ownerId === this.ownerId).map(([k, v]) => ({ ...structuredClone(v), _id: k.slice(name.length + 1) })).slice(this.offset, this.offset + this.max) }; },
      doc(id: string) { const key = `${name}/${id}`; return {
        async get() { if (!data.has(key)) throw new Error('document does not exist'); return { data: { ...structuredClone(data.get(key)), _id: id } }; },
        async set({ data: value }: any) { data.set(key, structuredClone(value)); }, async remove() { data.delete(key); },
      }; },
    }; return query;
  } });
  const db: any = { collection(name: string) { return api(records).collection(name); }, async runTransaction(fn: any) {
    const run = chain.then(async () => { const draft = structuredClone(records); await fn(api(draft)); records = draft; });
    chain = run.catch(() => undefined); return run;
  } }; return db;
}
test('分集合持久化后可重新读取，两个用户互相隔离', async () => {
  const repo = new Repository(fakeDatabase());
  for (const ownerId of ['alice', 'bob']) {
    const before = await repo.read(ownerId); const after = dispatch(before, 'gym.save', { name: ownerId, gradeSystem: 'V 等级' }, { ownerId }).state;
    await repo.commit(before, after);
  }
  const a = await repo.read('alice'), b = await repo.read('bob');
  assert.equal(a.gyms.length, 1); assert.equal(a.gyms[0].name, 'alice'); assert.equal(b.gyms[0].name, 'bob');
});
test('并发修订只允许一个提交成功，失败不留下半条记录', async () => {
  const repo = new Repository(fakeDatabase()); const before = await repo.read('alice');
  const one = dispatch(before, 'gym.save', { name: '甲', gradeSystem: 'V 等级' }).state;
  const two = dispatch(before, 'gym.save', { name: '乙', gradeSystem: 'V 等级' }).state;
  const results = await Promise.allSettled([repo.commit(before, one), repo.commit(before, two)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal((await repo.read('alice')).gyms.length, 1);
});
test('超过100条记录分页读取，删除后不会在新读取中恢复', async () => {
  const repo = new Repository(fakeDatabase()); let before = await repo.read('alice'), after = before;
  for (let i = 0; i < 105; i++) after = dispatch(after, 'gym.save', { name: '测试' + i, gradeSystem: 'V 等级' }).state;
  await repo.commit(before, after); before = await repo.read('alice'); assert.equal(before.gyms.length, 105);
  after = dispatch(before, 'account.delete', {}).state; await repo.commit(before, after);
  assert.equal((await repo.read('alice')).gyms.length, 0);
});
test('云端全量删除先隐藏，再按20条分批；新写入被阻止，完成后删除请求重放不误删新记录', async () => {
  const repo = new Repository(fakeDatabase()); let before = await repo.read('alice'), after = before;
  for (let i = 0; i < 105; i++) after = dispatch(after, 'gym.save', { name: '私密测试馆' + i, gradeSystem: 'V 等级' }).state;
  await repo.commit(before, after);
  await repo.beginDeletion('alice', 'delete_request_001');
  before = await repo.read('alice');
  assert.equal(before.accountDeleting, true); assert.equal(before.gyms.length, 105);
  assert.equal(publicState(before).gyms.length, 0); assert.equal(JSON.stringify(publicState(before)).includes('私密测试馆'), false);
  assert.throws(() => dispatch(before, 'gym.save', { name: '禁止新增', gradeSystem: 'V 等级' }));
  await repo.deleteBusinessBatch('alice'); assert.equal((await repo.read('alice')).gyms.length, 85);
  assert.equal(await repo.finishDeletion('alice'), false);
  for (let i = 0; i < 5; i++) await repo.deleteBusinessBatch('alice');
  assert.equal(await repo.finishDeletion('alice'), true);
  before = await repo.read('alice'); assert.equal(before.gyms.length, 0); assert.equal(before.accountDeleting, false);
  after = dispatch(before, 'gym.save', { name: '删除后新建的岩馆', gradeSystem: 'V 等级' }).state; await repo.commit(before, after);
  await repo.beginDeletion('alice', 'delete_request_001');
  assert.equal((await repo.read('alice')).accountDeleting, false); assert.equal((await repo.read('alice')).gyms.length, 1);
});
