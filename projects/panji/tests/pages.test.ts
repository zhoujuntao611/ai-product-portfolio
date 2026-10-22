import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildSync } from 'esbuild';
import ts from 'typescript';

// Runs the real page scripts with a WeChat API test double. This is not a device test.
function device() {
  const storage = new Map<string, any>();
  const navigation: string[] = []; const errors: string[] = []; const modals: any[] = [];
  const wx: any = {
    getStorageSync: (key: string) => structuredClone(storage.get(key) || ''),
    setStorageSync: (key: string, value: any) => storage.set(key, structuredClone(value)),
    removeStorageSync: (key: string) => storage.delete(key),
    getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    showToast: () => undefined, showLoading: () => undefined, hideLoading: () => undefined,
    showModal: async (opts: any) => {
      modals.push(opts);
      for (const key of ['confirmText', 'cancelText']) {
        if (opts[key] && [...opts[key]].length > 4) throw new Error(`showModal:fail ${key} length should not larger than 4 Chinese characters`);
      }
      if (opts.title === '这一步还没完成') errors.push(opts.content);
      return { confirm: true, content: '测试反馈' };
    },
    showActionSheet: async () => ({ tapIndex: 0 }),
    navigateTo: ({ url }: any) => navigation.push(url), redirectTo: ({ url }: any) => navigation.push(url),
    navigateBack: () => navigation.push('back'), switchTab: ({ url }: any) => navigation.push(url),
    pageScrollTo: () => undefined,
  };
  function page(name: string) {
    let result: any;
    const bundle = buildSync({ entryPoints: [`src/miniprogram/pages/${name}/index.ts`], bundle: true, write: false,
      platform: 'neutral', format: 'cjs', target: 'es2018', define: { PANJI_CLOUD_ENV: '""' } }).outputFiles[0].text;
    vm.runInNewContext(bundle, { wx, Page: (definition: any) => { result = definition; }, console, setTimeout, clearTimeout, exports: {}, module: { exports: {} } });
    result.data = structuredClone(result.data);
    result.setData = (values: Record<string, any>) => {
      for (const [key, value] of Object.entries(values)) {
        const parts = key.split('.'); let target = result.data;
        for (const part of parts.slice(0, -1)) target = target[part]; target[parts[parts.length - 1]] = structuredClone(value);
      }
    }; return result;
  }
  return { storage, navigation, errors, modals, wx, page };
}
const input = (field: string, value: unknown) => ({ currentTarget: { dataset: { field } }, detail: { value } });

test('岩馆库筛选→选择→回到原表单→保存；重复选择不增加私人岩馆', async () => {
  const d = device();
  const edit = d.page('session-edit'); edit.onLoad({}); await edit.onShow();
  edit.pickDate(input('', '2026-10-18')); edit.field(input('durationMinutes', '75'));
  edit.field(input('trainingNotes', '选择岩馆后保留这段草稿')); edit.onHide();
  edit.catalog(); assert.equal(d.navigation[d.navigation.length - 1], '/pages/gym-picker/index');
  const picker = d.page('gym-picker'); picker.onLoad({}); await picker.onShow();
  const sh = picker.data.cities.findIndex((c: any) => c.name === '上海'); picker.city(input('', sh));
  picker.filter({ currentTarget: { dataset: { kind: 'kilter' } } });
  assert.ok(picker.data.found >= 3); assert.equal(picker.data.groups.length, 1);
  const id = picker.data.groups[0].entries[0].id;
  await picker.choose({ currentTarget: { dataset: { id } } });
  assert.equal(d.navigation[d.navigation.length - 1], 'back');
  await edit.onShow(); assert.ok(edit.data.form.gymId);
  assert.equal(edit.data.form.trainingNotes, '选择岩馆后保留这段草稿'); assert.equal(edit.data.form.durationMinutes, '75');
  assert.equal(edit.data.form.sessionDate, '2026-10-18');
  await picker.onShow(); await picker.choose({ currentTarget: { dataset: { id } } }); await edit.onShow();
  await edit.save();
  const s = d.storage.get('panji.data.v1'); assert.equal(s.gyms.length, 1); assert.equal(s.sessions.length, 1);
  assert.equal(s.gyms[0].catalogId, id); assert.equal(s.sessions[0].gymId, s.gyms[0]._id);
  assert.equal(s.sessions[0].gymSnapshot.gradeSystem, '馆内原标签'); assert.deepEqual(d.errors, []);
});

test('公开岩馆详情来源可展开，加入后记录；未收录的岩馆可手动添加', async () => {
  const d = device(); const catalog = d.page('catalog'); catalog.onLoad({}); await catalog.onShow();
  const entry = catalog.data.groups[0].entries[0];
  catalog.open({ currentTarget: { dataset: { id: entry.id } } });
  const detail = d.page('gym-detail'); detail.onLoad({ id: entry.id }); await detail.onShow();
  detail.sources(); assert.equal(detail.data.sources, true); assert.ok(detail.data.entry.sourceUrl);
  await detail.add(); assert.equal(detail.data.added, true); await detail.record();
  assert.equal(d.storage.get('panji.data.v1').gyms.length, 1);
  const edit = d.page('session-edit'); edit.onLoad({}); await edit.onShow(); assert.ok(edit.data.form.gymId);
  const picker = d.page('gym-picker'); picker.onLoad({}); await picker.onShow();
  picker.search(input('', '未收录测试')); assert.equal(picker.data.found, 0); picker.manual();
  await edit.onShow(); assert.equal(d.navigation[d.navigation.length - 1], '/pages/gyms/index?select=1&new=1');
  const manual = d.page('gyms'); manual.onLoad({ select: '1', new: '1' }); await manual.onShow();
  assert.equal(manual.data.formOpen, true); manual.field(input('name', '手动测试馆')); await manual.save();
  await edit.onShow(); assert.equal(edit.data.gymName, '手动测试馆'); assert.deepEqual(d.errors, []);
});

test('首次记录和添加岩馆的隐私弹窗符合微信按钮长度限制', async () => {
  for (const name of ['records', 'gyms']) {
    const d = device(); const p = d.page(name);
    p.onLoad?.({}); await p.onShow(); await p.add();
    assert.deepEqual(d.errors, [], `${name} 首次操作被弹窗错误阻止`);
    assert.equal(d.modals.length, 1);
    assert.equal(d.modals[0].title, '开始记录你的攀岩');
    assert.ok(d.storage.get('panji.data.v1').consent.privacyVersion);
    if (name === 'records') assert.ok(d.navigation.some(x => x.includes('session-edit')));
    else assert.equal(p.data.formOpen, true);
  }
});

test('所有显式弹窗按钮文案都在四字限制内，包括尚未开放的 AI 确认', () => {
  let checked = 0;
  for (const file of fs.readdirSync('src/miniprogram', { recursive: true }).map(String).filter(x => x.endsWith('.ts'))) {
    const path = `src/miniprogram/${file}`;
    const source = ts.createSourceFile(path, fs.readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      let label: ts.Node | undefined;
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'confirm') label = node.arguments[2];
      if (ts.isPropertyAssignment(node) && ['confirmText', 'cancelText'].includes(node.name.getText(source))) label = node.initializer;
      if (label && ts.isStringLiteralLike(label)) {
        checked++; assert.ok([...label.text].length <= 4, `${path}: 按钮文案“${label.text}”超过四字`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.ok(checked >= 10);
});
test('真实页面脚本闭环：建岩馆→保存训练→重开→尝试→统计→复盘→目标→核对', async () => {
  const d = device();
  const records = d.page('records'); await records.onShow(); assert.equal(records.data.total, 0);
  await records.add(); assert.ok(d.navigation[d.navigation.length - 1]?.includes('session-edit'));
  const gyms = d.page('gyms'); gyms.onLoad({}); await gyms.onShow(); await gyms.add();
  gyms.field(input('name', '页面测试岩馆')); await gyms.save(); assert.equal(gyms.data.gyms.length, 1);
  const edit = d.page('session-edit'); edit.onLoad({}); await edit.onShow();
  edit.pickDate(input('', '2026-10-05')); edit.field(input('durationMinutes', '90')); edit.field(input('trainingNotes', '真实页面逻辑测试，非用户数据')); await edit.save();
  const saved = d.storage.get('panji.data.v1'); assert.equal(saved.sessions.length, 1); const sid = saved.sessions[0]._id;
  const detail = d.page('session-detail'); detail.onLoad({ id: sid }); await detail.onShow(); assert.equal(detail.data.session.durationMinutes, 90);
  for (const result of ['completed', 'failed', 'unknown']) {
    detail.addAttempt(); detail.field(input('routeLabel', '蓝线')); detail.result({ currentTarget: { dataset: { value: result } } }); await detail.saveAttempt();
  }
  // A new page VM has no prior in-memory state.
  const reopened = d.page('session-detail'); reopened.onLoad({ id: sid }); await reopened.onShow(); assert.equal(reopened.data.attempts.length, 3);
  const growth = d.page('growth'); await growth.onShow(); growth.setData({ from: '2026-10-05', to: '2026-10-18' }); growth.calculate();
  assert.equal(growth.data.metrics.minutes, 90); assert.equal(growth.data.metrics.denominator, 2); assert.equal(growth.data.rateLabel, '50%');
  const review = d.page('review'); review.onLoad({ from: '2026-10-05', to: '2026-10-18' }); await review.onShow();
  await review.create(); assert.equal(review.data.reviews.length, 1); assert.equal(review.data.reviews[0].mode, 'rule');
  review.chooseGoal({ currentTarget: { dataset: { review: review.data.reviews[0]._id, text: '下次记录休息间隔' } } }); await review.saveGoal();
  const follow = d.page('session-edit'); follow.onLoad({}); await follow.onShow(); await follow.save();
  const followState = d.storage.get('panji.data.v1'); const nextId = followState.sessions.at(-1)._id;
  const next = d.page('session-detail'); next.onLoad({ id: nextId }); await next.onShow();
  await next.followup({ currentTarget: { dataset: { id: followState.goals[0]._id } } });
  assert.equal(d.storage.get('panji.data.v1').goals[0].status, 'completed'); assert.deepEqual(d.errors, []);
});
test('草稿恢复与保存失败：不会把未成功保存显示为已保存', async () => {
  const d = device(); const gyms = d.page('gyms'); gyms.onLoad({}); await gyms.onShow(); await gyms.add(); gyms.field(input('name', '草稿测试馆')); await gyms.save();
  const edit = d.page('session-edit'); edit.onLoad({}); await edit.onShow(); edit.field(input('trainingNotes', '未保存的草稿')); edit.onHide();
  const reopened = d.page('session-edit'); reopened.onLoad({}); await reopened.onShow();
  assert.equal(reopened.data.form.trainingNotes, '未保存的草稿'); assert.equal(reopened.data.recovered, true);
  reopened.field(input('durationMinutes', '0')); await reopened.save();
  assert.equal(d.storage.get('panji.data.v1').sessions.length, 0); assert.ok(d.errors.length > 0); assert.equal(reopened.saved, false);
});

test('离开多个训练编辑页时，较旧页面不能覆盖较新的草稿', async () => {
  const d = device();
  const older = d.page('session-edit'); older.onLoad({}); await older.onShow();
  const newer = d.page('session-edit');
  // Native Page instances share the definition's initial property values.
  newer.draftOwner = older.draftOwner; newer.onLoad({}); await newer.onShow();
  assert.notEqual(newer.draftOwner, older.draftOwner);
  newer.field(input('trainingNotes', '最新编辑的合成草稿')); newer.onHide(); older.onUnload();
  const reopened = d.page('session-edit'); reopened.onLoad({}); await reopened.onShow();
  assert.equal(reopened.data.form.trainingNotes, '最新编辑的合成草稿');
  await reopened.save(); assert.match(d.errors[d.errors.length - 1] || '', /请先选择岩馆/);
});

test('较新训练保存成功后，旧编辑页退出不能重新生成已清除的草稿', async () => {
  const d = device(); const gyms = d.page('gyms'); gyms.onLoad({}); await gyms.onShow(); await gyms.add();
  gyms.field(input('name', '合成草稿验证岩馆')); await gyms.save();
  const older = d.page('session-edit'); older.onLoad({}); await older.onShow(); older.field(input('trainingNotes', '过期草稿'));
  const newer = d.page('session-edit'); newer.onLoad({}); await newer.onShow(); newer.field(input('trainingNotes', '已保存的合成记录')); await newer.save();
  assert.equal(d.storage.has('panji.draft.local.new'), false); older.onUnload(); assert.equal(d.storage.has('panji.draft.local.new'), false);
  const next = d.page('session-edit'); next.onLoad({}); await next.onShow();
  assert.equal(next.data.recovered, false); assert.equal(next.data.form.trainingNotes, '');
});

test('连续记录尝试独立保存；失败保留输入，编辑后继续不会覆盖上一条', async () => {
  const d = device(); const gyms = d.page('gyms'); gyms.onLoad({}); await gyms.onShow(); await gyms.add();
  gyms.field(input('name', '合成连续记录馆')); await gyms.save();
  const edit = d.page('session-edit'); edit.onLoad({}); await edit.onShow(); await edit.save();
  const sid = d.storage.get('panji.data.v1').sessions[0]._id;
  const detail = d.page('session-detail'); detail.onLoad({ id: sid }); await detail.onShow(); detail.addAttempt();
  detail.field(input('gradeLabel', 'V2')); await detail.saveAndContinue();
  assert.equal(d.storage.get('panji.data.v1').attempts.length, 0); assert.equal(detail.data.formOpen, true);
  assert.equal(detail.data.attempt.gradeLabel, 'V2');
  detail.field(input('routeLabel', '蓝线')); detail.result({ currentTarget: { dataset: { value: 'completed' } } });
  await Promise.all([detail.saveAndContinue(), detail.saveAndContinue()]);
  assert.equal(d.storage.get('panji.data.v1').attempts.length, 1); assert.equal(detail.data.formOpen, true);
  assert.equal(detail.data.editAttempt, ''); assert.equal(detail.data.attempt.routeLabel, ''); assert.equal(detail.data.attempt.result, 'unknown');
  const firstId = detail.data.attempts[0]._id;
  detail.editAttempt({ currentTarget: { dataset: { id: firstId } } }); detail.field(input('notes', '更新备注'));
  await detail.saveAndContinue(); detail.field(input('routeLabel', '红线')); await detail.saveAttempt();
  const attempts = d.storage.get('panji.data.v1').attempts;
  assert.equal(attempts.length, 2); assert.equal(attempts[0]._id, firstId); assert.equal(attempts[0].notes, '更新备注');
  assert.equal(attempts[1].routeLabel, '红线'); assert.equal(detail.data.formOpen, false);
});

test('收起选填项不丢失内容；草稿恢复和编辑自动展开已有感受', async () => {
  const d = device(); const gyms = d.page('gyms'); gyms.onLoad({}); await gyms.onShow(); await gyms.add();
  gyms.field(input('name', '合成折叠表单馆')); await gyms.save();
  const edit = d.page('session-edit'); edit.onLoad({}); await edit.onShow();
  assert.equal(edit.data.showExtras, false); edit.toggleExtras(); edit.field(input('feeling', '脚步更稳')); edit.field(input('perceivedEffort', '6'));
  edit.toggleExtras(); edit.onHide();
  const restored = d.page('session-edit'); restored.onLoad({}); await restored.onShow();
  assert.equal(restored.data.showExtras, true); restored.toggleExtras(); await restored.save();
  const saved = d.storage.get('panji.data.v1').sessions[0]; assert.equal(saved.feeling, '脚步更稳'); assert.equal(saved.perceivedEffort, 6);
  const reopened = d.page('session-edit'); reopened.onLoad({ id: saved._id }); await reopened.onShow(); assert.equal(reopened.data.showExtras, true);
});

test('复盘默认不含备注；主动包含时展开真实输入；取消建议目标不会残留来源', async () => {
  const d = device(); const gyms = d.page('gyms'); gyms.onLoad({}); await gyms.onShow(); await gyms.add();
  gyms.field(input('name', '合成输入预览馆')); await gyms.save();
  const edit = d.page('session-edit'); edit.onLoad({}); await edit.onShow(); edit.field(input('trainingNotes', '合成私人备注')); await edit.save();
  const review = d.page('review'); review.onLoad({ mode: 'ai' }); await review.onShow();
  assert.equal(review.data.mode, 'ai'); assert.equal(review.data.showPreview, false); assert.equal(review.data.includeNotes, false);
  assert.equal(review.data.preview.records[0].notes, ''); review.toggleNotes({ detail: { value: true } });
  assert.equal(review.data.showPreview, true); assert.equal(review.data.preview.records[0].notes, '合成私人备注');
  review.chooseGoal({ currentTarget: { dataset: { review: 'old-review', text: '旧建议' } } }); review.closeGoal(); review.newGoal();
  assert.equal(review.data.goalReviewId, ''); assert.equal(review.data.goalText, '');
});
