import test from 'node:test';
import assert from 'node:assert/strict';
import { gymCatalog, catalogGym, catalogCities, catalogSummary, searchCatalog, hasFacility, linkedCatalogGym } from '../src/shared/gym-catalog';
import { emptyState, DomainError } from '../src/shared/domain';
import { dispatch } from './fixtures';
import banana from '../infrastructure/gym-catalog-banana.json';
import curated from '../infrastructure/gym-catalog-curated.json';

test('扩充名录有唯一编号、可追溯来源；已关闭门店不展示', () => {
  assert.ok(gymCatalog.length >= 160);
  assert.equal(new Set(gymCatalog.map(g => g.id)).size, gymCatalog.length);
  assert.ok(catalogCities().length >= 60);
  for (const g of gymCatalog) {
    assert.ok(g.name && g.city && g.address && g.sourceName);
    assert.ok(/^https:\/\//.test(g.sourceUrl));
    assert.ok(!g.sourceDate || /^\d{4}-\d{2}-\d{2}$/.test(g.sourceDate));
    assert.match(g.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(new Set(g.facilities).size, g.facilities.length);
  }
  assert.equal(catalogGym('banana-bj-768'), undefined);
  assert.equal(catalogGym('banana-cs-capitaland'), undefined);
  assert.ok(gymCatalog.filter(g => g.brand === '香蕉攀岩'&&g.facilities.includes('kilter')).every(g => g.sources?.some(s=>s.url==='https://settercloset.com/pages/kb-locator')));
  assert.deepEqual(catalogGym('banana-cd-youfang')?.facilities, []);
  for(const original of [...banana.entries,...curated])assert.equal(catalogGym(original.id)?.id,original.id);
  assert.equal(catalogGym('osm-node-4583629247'),undefined);
  assert.equal(catalogGym('kilter-22029742'),undefined);
  for(const entry of gymCatalog){for(const alias of entry.alternateIds||[])assert.equal(catalogGym(alias)?.id,entry.id);}
});

test('城市、关键词和设施联合筛选；未知设施不冒充已确认', () => {
  const k = searchCatalog(' K 板 ', '上海', 'kilter');
  assert.ok(k.length >= 3);
  assert.ok(k.every(g => g.city === '上海' && g.facilities.includes('kilter')));
  assert.equal(searchCatalog('不存在的岩馆').length, 0);
  assert.ok(searchCatalog('', '东莞', 'rope').some(g => g.facilities.includes('rope')));
  assert.ok(gymCatalog.filter(g => g.facilities.includes('lead')).every(g => hasFacility(g, 'rope')));
  assert.equal(catalogSummary().total, gymCatalog.length);
  assert.ok(catalogSummary().kilter >= 4);
});

test('分开的城市和品牌词可联合搜索，闭店冲突待核实条目隐藏但其他分店可选',()=>{
  const matches=searchCatalog('上海 香蕉');
  assert.ok(matches.length>0);assert.ok(matches.every(g=>g.city==='上海'&&g.brand==='香蕉攀岩'));
  assert.equal(catalogGym('kilter-22029877'),undefined);
  assert.ok(catalogGym('kilter-22029876')?.facilities.includes('moon'));
  assert.ok(catalogGym('osm-node-8330698331')?.facilities.includes('lead'));
  assert.ok(catalogGym('hylonomus-8bb1a135f7ed57df')?.address.includes('51号'));
  assert.ok(catalogGym('banana-sh-yananxi')?.address.includes('658号'));
  assert.ok(searchCatalog('', '西宁').length>0);
});

test('同城同名的不同分馆分别导入，跨来源别名仍可读到原编号',()=>{
  const branches=gymCatalog.filter(g=>g.city==='天津'&&g.name==='Top攀岩馆');
  assert.equal(branches.length,2);assert.notEqual(branches[0].address,branches[1].address);
  let s=emptyState('alice');
  for(const branch of branches)s=dispatch(s,'gym.import',{catalogId:branch.id}).state;
  assert.equal(s.gyms.length,2);assert.notEqual(s.gyms[0]._id,s.gyms[1]._id);
  assert.equal(catalogGym('hylonomus-c1bfb03ca55832c7')?.id,'bj-rockhour-xisanqi');
  assert.equal(catalogGym('hylonomus-ee7a0d031618db2e')?.id,'sh-rockhour-gatem');
  const rock=catalogGym('bj-rockhour-xisanqi')!;
  assert.ok(rock.address.includes('27号'));assert.ok(rock.sources!.length>=2);
});

test('岩馆库导入由服务端资料决定，重复选择不重复创建', () => {
  const entry = gymCatalog[0];
  let state = emptyState('alice');
  state = dispatch(state, 'gym.import', { catalogId: entry.id, name: '伪造名字', ownerId: 'bob', gradeSystem: 'V99' }).state;
  const g = state.gyms[0];
  assert.equal(g.ownerId, 'alice'); assert.equal(g.name, entry.name);
  assert.equal(g.gradeSystem, '馆内原标签'); assert.equal(g.catalogId, entry.id);
  state = dispatch(state, 'gym.import', { catalogId: entry.id }).state;
  assert.equal(state.gyms.length, 1); assert.equal(state.gyms[0]._id, g._id);
  assert.throws(() => dispatch(state, 'gym.import', { catalogId: 'missing' }), (e: unknown) => e instanceof DomainError && e.code === 'NOT_FOUND');
  assert.throws(() => dispatch(state, 'gym.import', { catalogId: entry.id }, { ownerId: 'bob' }), (e: unknown) => e instanceof DomainError && e.code === 'FORBIDDEN');
});

test('已有同馆资料可关联并恢复；保留私人难度、备注和历史快照', () => {
  const entry = gymCatalog[0];
  let s = dispatch(emptyState('alice'), 'gym.save', { name: entry.name, city: entry.city+'市', gradeSystem: '自定义颜色', notes: '我的私人备注' }).state;
  const id = s.gyms[0]._id;
  s = dispatch(s, 'session.save', { gymId: id, sessionDate: '2026-10-18' }).state;
  const snapshot = structuredClone(s.sessions[0].gymSnapshot);
  s = dispatch(s, 'gym.archive', { id }).state;
  s = dispatch(s, 'gym.import', { catalogId: entry.id }).state;
  assert.equal(s.gyms.length, 1); assert.equal(s.gyms[0]._id, id);
  assert.equal(s.gyms[0].archivedAt, undefined); assert.equal(s.gyms[0].gradeSystem, '自定义颜色');
  assert.equal(s.gyms[0].notes, '我的私人备注'); assert.deepEqual(s.sessions[0].gymSnapshot, snapshot);
  s = dispatch(s, 'gym.save', { id, name: '私人昵称', city: entry.city, gradeSystem: '颜色', notes: '' }).state;
  s = dispatch(s, 'gym.import', { catalogId: entry.id }).state;
  assert.equal(s.gyms.length, 1); assert.equal(s.gyms[0].name, '私人昵称');
  assert.equal(linkedCatalogGym(entry, [{ name: entry.name, city: '另一个城市' }]), undefined);
});
