import test from 'node:test';
import assert from 'node:assert/strict';
import {gymCatalog,catalogGym,searchCatalog} from '../src/shared/gym-catalog';
import additions from '../infrastructure/gym-catalog-oct22-additions.json';
import reviews from '../infrastructure/gym-catalog-oct22-rechecks.json';
import exclusions from '../infrastructure/gym-catalog-oct22-exclusions.json';
import osm from '../infrastructure/gym-catalog-osm.json';
import {emptyState} from '../src/shared/domain';
import {dispatch} from './fixtures';

test('10月22日新增场所有独立稳定编号与一手来源，同址异名只计一处',()=>{
  assert.equal(additions.length,11);assert.equal(gymCatalog.length,228);
  assert.equal(new Set(additions.map(g=>g.id)).size,11);
  for(const entry of additions){
    assert.equal(catalogGym(entry.id)?.id,entry.id);
    assert.equal(entry.checkedAt,'2026-10-22');assert.match(entry.sourceUrl,/^https:\/\//);
    assert.ok(entry.address.length>entry.city.length);
    assert.equal((entry.facilities as string[]).includes('kilter'),false);
  }
  const wujie=catalogGym('oct22-sh-wujie-king88')!;
  assert.equal(wujie.address.includes('88号'),true);
  assert.deepEqual(searchCatalog('上海 Park').map(g=>g.id),[wujie.id]);
  assert.deepEqual(searchCatalog('上海 爬客').map(g=>g.id),[wujie.id]);
  assert.ok(catalogGym('oct22-sh-climbism-oriental')?.address.includes('13号门'));
  assert.equal(searchCatalog('攀岩主义 东体馆')[0]?.id,'oct22-sh-climbism-oriental');
});

test('原场馆复核补门牌、现名与条件，旧名仍可检索；不从旧品牌推断现设施',()=>{
  assert.equal(reviews.length,13);assert.equal(new Set(reviews.map(r=>r.id)).size,8);
  assert.match(catalogGym('osm-node-4583627411')!.address,/49號/);
  assert.match(catalogGym('osm-node-5132063921')!.address,/41號.*2樓/);
  const current=catalogGym('osm-node-11121831487')!;
  assert.match(current.name,/First Climb/);assert.match(current.address,/8號.*G14/);
  assert.ok(searchCatalog('香港攀爬樂園 元朗').some(g=>g.id===current.id));
  assert.deepEqual(current.facilities,[]);assert.match(current.accessNote||'',/會員/);
  for(const {id}of reviews)assert.equal(catalogGym(id)!.checkedAt,'2026-10-22');
});

test('冲突条目从默认目录暂隐藏，开放原始分区和用户历史引用保留',()=>{
  assert.equal(exclusions.length,2);
  const sourceEntries=Array.isArray(osm)?osm:osm.entries;
  for(const record of exclusions)for(const id of record.ids){
    assert.equal(catalogGym(id),undefined);assert.ok(sourceEntries.some(g=>g.id===id));
  }
  let state=dispatch(emptyState('alice'),'gym.save',{name:'旧场馆私人昵称',city:'上海',notes:'自己的记录',gradeSystem:'颜色'}).state;
  state.gyms[0].catalogId='osm-node-5162048437';
  state=dispatch(state,'session.save',{gymId:state.gyms[0]._id,sessionDate:'2026-10-19'}).state;
  const saved=structuredClone(state.sessions[0]);
  state=dispatch(state,'gym.import',{catalogId:'oct22-sh-wujie-king88'}).state;
  assert.equal(state.gyms.length,2);assert.equal(state.gyms[0].name,'旧场馆私人昵称');
  assert.deepEqual(state.sessions[0],saved);
});
