import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Run after building the app and starting the frontend (and optional backend).
// node scripts/browser-qa.mjs --url http://127.0.0.1:4173/ --api http://127.0.0.1:8000
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(option('--out', path.join(root, 'verification')));
const url = option('--url', 'http://127.0.0.1:4173/');
const api = option('--api', '');
const targetedOnly = args.includes('--targeted-only');
const zeroMinutesOnly = args.includes('--zero-minutes-only');
const appendOnly = targetedOnly || zeroMinutesOnly;
const expectedBundle = option('--bundle', 'index-CVyA3M1b.js');
const require = createRequire(import.meta.url);
let playwrightModule;
if (process.env.PLAYWRIGHT_MODULE) {
  playwrightModule = require(process.env.PLAYWRIGHT_MODULE);
} else {
  try { playwrightModule = require('playwright'); }
  catch {
    const bundled = 'D:/Codex/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
    if (!existsSync(bundled)) throw new Error('Install Playwright for browser QA or set PLAYWRIGHT_MODULE to an existing module.');
    playwrightModule = require(bundled);
  }
}
const { chromium } = playwrightModule;
mkdirSync(out, { recursive: true });
mkdirSync(path.join(out, 'downloads'), { recursive: true });
const report = {
  schema_version: 1,
  started_at: new Date().toISOString(),
  client_timezone: 'Asia/Shanghai',
  local_started_at: new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'full', timeStyle: 'long' }).format(new Date()),
  frontend_url: url,
  backend_url: api || null,
  method: 'Headless browser actions against the real interface; demo assertions read saved browser state, API assertions read the actual backend state.',
  scope: 'Synthetic test profiles only. This verifies interface behavior, not real user satisfaction, coaching validity, or live LLM quality.',
  checks: [],
  page_errors: [],
  screenshots: [],
};
const revisionStarted = new Date().toISOString();
let revision;
if (appendOnly) {
  const existingPath = path.join(out, 'browser-qa.json');
  assert.ok(existsSync(existingPath), 'A full baseline browser-qa.json must exist before appending targeted checks.');
  Object.assign(report, JSON.parse(readFileSync(existingPath, 'utf8')));
  report.revisions ||= [{ kind: 'full_baseline', tested_bundle: 'index-0SlgHe32.js', started_at: report.started_at, finished_at: report.finished_at, checks: report.checks.length, scope: 'Full desktop/mobile/API browser suite and public simulated-example screenshots.' }];
  revision = { kind: targetedOnly ? 'targeted_frontend_regression' : 'zero_minute_backend_regression', started_at: revisionStarted, tested_bundle: expectedBundle, previous_check_count: report.checks.length, scope: targetedOnly ? 'Text-only pain in onboarding; integer duration validation in local and API modes. Existing screenshots and baseline checks retained.' : 'Direct HTTP check against the restarted backend: zero minutes is skipped in the log, session and event.' };
  report.revisions.push(revision);
}

async function check(name, details, fn) {
  const started = Date.now();
  const entry = { name, ...details, status: 'running' };
  report.checks.push(entry);
  try {
    const evidence = await fn();
    Object.assign(entry, { status: 'passed', elapsed_ms: Date.now() - started, evidence: evidence ?? {} });
  } catch (error) {
    Object.assign(entry, { status: 'failed', elapsed_ms: Date.now() - started, error: error.message });
    throw error;
  }
}

async function visible(page, testId, role, name) {
  const exact = page.getByTestId(testId);
  if (await exact.count() && await exact.first().isVisible()) return exact.first();
  const fallback = role ? page.getByRole(role, { name }).first() : page.getByLabel(name).first();
  await fallback.waitFor({ state: 'visible', timeout: 10000 });
  return fallback;
}
const click = async (page, id, name) => (await visible(page, id, 'button', name)).click();
async function fill(page, id, name, value) {
  const input = await visible(page, id, undefined, name);
  const tag = await input.evaluate(element => element.tagName);
  if (tag === 'SELECT') await input.selectOption(String(value));
  else await input.fill(String(value));
}

async function nav(page, key, name) {
  const desktop = page.getByTestId(`nav-${key}`);
  if (await desktop.count() && await desktop.isVisible()) await desktop.click();
  else if (key === 'profile' || key === 'report') {
    await page.locator('.mobile-nav').getByRole('button', { name: '我的', exact: true }).click();
    await page.locator('.account-shortcuts').getByRole('button', { name: key === 'profile' ? /能力画像/ : /反馈报告/ }).click();
  } else if (key === 'onboarding') {
    await page.locator('.heading-action').click();
  } else {
    const names = { today: '今日', plan: '计划', training: '训练', knowledge: '知识', account: '我的' };
    await page.locator('.mobile-nav').getByRole('button', { name: names[key], exact: true }).click();
  }
  await page.waitForTimeout(100);
  const size = await page.evaluate(() => ({ width: innerWidth, scroll_width: document.documentElement.scrollWidth }));
  assert.ok(size.scroll_width <= size.width + 1, `Horizontal overflow on ${key}: ${JSON.stringify(size)}`);
  return size;
}

async function savedState(page, mode = 'demo') {
  if (mode === 'api') return page.evaluate(async apiUrl => {
    const response = await fetch(apiUrl.replace(/\/$/, '') + '/api/state', { headers: { 'X-Session-ID': localStorage.getItem('climbai.session') || '' } });
    if (!response.ok) throw new Error(`Backend state request failed (${response.status})`);
    return response.json();
  }, api);
  return page.evaluate(() => {
    const session = localStorage.getItem('climbai.session');
    const raw = localStorage.getItem(`climbai.demo.v1.${session}`);
    return raw ? JSON.parse(raw) : { profile: null, plans: [], logs: [], reports: [], answers: [], paused: false, current_plan: null };
  });
}

async function until(page, predicate, mode = 'demo') {
  let latest;
  for (let i = 0; i < 60; i++) {
    latest = await savedState(page, mode);
    if (predicate(latest)) return latest;
    await page.waitForTimeout(150);
  }
  throw new Error('Expected persisted state was not observed within 9 seconds.');
}

async function profile(page, nickname, mode = 'demo') {
  const start = page.getByTestId('start-onboarding');
  if (await start.count() && await start.isVisible()) await start.click();
  else {
    const create = page.getByRole('button', { name: /建立我的训练计划|建立.*档案|开始建立/ }).first();
    if (await create.count() && await create.isVisible()) await create.click();
    else await nav(page, 'onboarding', /建立档案|个人档案/);
  }
  await fill(page, 'profile-nickname', /称呼|昵称/, nickname);
  await fill(page, 'profile-goal', /训练目标|目标/, '每周到馆两次，记录脚点滑落发生的动作');
  await page.getByTestId('profile-adult').check();
  await click(page, 'profile-save', /保存.*档案|建立.*画像|保存并/);
  await until(page, state => state.current_plan?.status === 'draft' && state.profile?.nickname === nickname, mode);
}

async function plan(page, mode, forceGenerate = false) {
  await nav(page, 'plan', /训练计划|AI.*计划/);
  const existing = await savedState(page, mode);
  if (forceGenerate || existing.current_plan?.status !== 'draft') await click(page, 'plan-generate', /生成.*计划/);
  const draft = await until(page, state => state.current_plan?.status === 'draft', mode);
  assert.ok(draft.current_plan.citations.length > 0, 'Plan should preserve knowledge references');
  for (const session of draft.current_plan.sessions) {
    assert.ok(session.duration_minutes <= draft.profile.available_minutes);
    assert.equal(session.exercises.reduce((sum, exercise) => sum + exercise.duration_minutes, 0), session.duration_minutes);
  }
  await click(page, 'plan-confirm', /确认.*计划|开始本周/);
  return until(page, state => state.current_plan?.status === 'confirmed', mode);
}

async function endTraining(page, minutes, mode) {
  await nav(page, 'training', /训练记录|开始训练|训练$/);
  const before = await savedState(page, mode);
  const next = before.current_plan.sessions.find(session => !before.logs.some(log => log.session_id === session.id));
  assert.ok(next, 'There should be an unfinished session for this completion action');
  await page.getByTestId(`training-session-${next.id}`).click();
  await fill(page, 'training-minutes', /实际.*分钟|实际.*时长/, minutes);
  await click(page, 'training-complete', /结束.*训练|保存.*完成|完成.*训练/);
  const state = await until(page, s => s.logs.some(log => !log.feedback_submitted && log.actual_minutes === minutes), mode);
  const log = state.logs.findLast(log => !log.feedback_submitted);
  assert.ok(log, 'Completion must persist before feedback');
  assert.equal(state.reports.some(item => item.session_id === log.session_id), false, 'Completing a session must not silently submit feedback');
  return log;
}

async function feedback(page, { difficulty = 3, issue = '时间不足', pain = false, notes: suppliedNotes = '浏览器验收的合成记录，不是真实用户训练。' } = {}, mode) {
  await page.getByTestId(`feedback-difficulty-${difficulty}`).click();
  await fill(page, 'feedback-issue', /主要卡点|主要问题/, issue);
  if (pain) {
    const checkbox = await visible(page, 'feedback-pain', 'checkbox', /不适|疼痛/);
    await checkbox.check();
  }
  const notes = page.getByTestId('feedback-notes');
  if (await notes.count()) await notes.fill(suppliedNotes);
  const before = await savedState(page, mode);
  await click(page, 'feedback-submit', /提交.*反馈|生成.*反馈/);
  return until(page, s => s.reports.length === before.reports.length + 1, mode);
}

async function knowledge(page, mode) {
  await nav(page, 'knowledge', /知识助手/);
  await fill(page, 'knowledge-question', /问题|想问/, '脚点滑落时应该观察什么？');
  await click(page, 'knowledge-submit', /提问|发送|获取回答/);
  const sourced = await until(page, s => s.answers.length && s.answers.at(-1).question?.includes('脚点'), mode);
  assert.ok(sourced.answers.at(-1).citations.length > 0, 'Covered answer must retain citations');
  assert.equal(sourced.answers.at(-1).insufficient_evidence, false);
  for (const citation of sourced.answers.at(-1).citations) {
    assert.ok((await page.locator('body').innerText()).includes(citation.title), 'Knowledge citation should be visible in the interface');
  }
  await fill(page, 'knowledge-question', /问题|想问/, '银河系暗物质的粒子质量是多少？');
  await click(page, 'knowledge-submit', /提问|发送|获取回答/);
  const refused = await until(page, s => s.answers.at(-1)?.question?.includes('暗物质'), mode);
  assert.equal(refused.answers.at(-1).insufficient_evidence, true);
  assert.equal(refused.answers.at(-1).citations.length, 0);
  assert.match(await page.locator('body').innerText(), /资料不足|没有足够|没有.*资料|无法确认|无法回答/);
  return { covered_citations: sourced.answers.at(-1).citations.map(item => item.id), uncovered_question_refused: true };
}

async function exportData(page, label) {
  await nav(page, 'account', /个人中心/);
  const promise = page.waitForEvent('download');
  await click(page, 'data-export', /导出/);
  const download = await promise;
  const filename = path.join(out, 'downloads', `${label}.json`);
  await download.saveAs(filename);
  const exported = JSON.parse(readFileSync(filename, 'utf8'));
  assert.ok(exported.data?.profile || exported.profile, 'Export must contain the saved profile');
  return { file: path.relative(out, filename), exported_logs: (exported.data?.logs || exported.logs || []).length };
}

async function deleteData(page, mode) {
  await nav(page, 'account', /个人中心/);
  await click(page, 'data-clear', /删除.*数据|清空.*记录|重置.*数据/);
  const confirm = page.getByTestId('data-clear-confirm');
  if (await confirm.count() && await confirm.isVisible()) await confirm.click();
  else await page.getByRole('dialog').getByRole('button', { name: '确认删除', exact: true }).click();
  return until(page, s => !s.profile && s.logs.length === 0 && s.plans.length === 0, mode);
}

async function setMode(page, mode, apiUrl) {
  const dialog = page.getByRole('dialog', { name: '选择体验模式' });
  if (!await dialog.isVisible()) await page.locator('.mode-indicator').click();
  await dialog.getByRole('button', { name: mode === 'api' ? /连接 Coach API/ : /本地演示模式/ }).click();
  if (apiUrl) await fill(page, 'api-url', /后端.*地址|服务.*地址/, apiUrl);
  const apply = page.getByTestId('mode-apply');
  if (await apply.count() && await apply.isVisible()) await apply.click();
}

async function allPages(page) {
  const evidence = [];
  for (const [key, name] of [
    ['today', /今日|首页/], ['profile', /能力画像/], ['plan', /训练计划|AI.*计划/],
    ['training', /训练记录|开始训练|训练$/], ['report', /反馈报告|AI.*反馈/],
    ['knowledge', /知识助手/], ['account', /个人中心/],
  ]) evidence.push({ page: key, ...(await nav(page, key, name)) });
  return evidence;
}

async function demoSuite(browser, width, mobile = false) {
  const context = await browser.newContext({ viewport: { width, height: mobile ? 844 : 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', error => report.page_errors.push({ suite: `demo-${width}`, message: error.message }));
  page.on('dialog', dialog => dialog.accept());
  const detail = { suite: `demo-${width}`, mode: 'demo_rules', viewport_width: width };
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await check('Empty state and onboarding', detail, async () => {
      assert.equal((await savedState(page)).profile, null);
      await profile(page, `验收用户${width}`);
      const state = await until(page, s => s.profile?.nickname === `验收用户${width}`);
      assert.ok(state.profile.dimensions.some(item => item.evidence_ids.length > 0));
      assert.ok(state.profile.missing_fields.length > 0);
      await nav(page, 'profile', /能力画像/);
      assert.match(await page.locator('body').innerText(), /自评|资料不足|待验证/);
      return { profile_version: state.profile.version, unknown_or_unmeasured_fields: state.profile.missing_fields.length };
    });
    await check('Generate and confirm a source-bound plan', detail, async () => {
      const state = await plan(page, 'demo');
      return { version: state.current_plan.version, sessions: state.current_plan.sessions.length, citations: state.current_plan.citations.length };
    });
    await check('Training completion persists independently of feedback', detail, async () => {
      const log = await endTraining(page, 30, 'demo');
      return { log_id: log.id, minutes: log.actual_minutes, feedback_submitted: false };
    });
    await check('Feedback and explicit adjustment decision', detail, async () => {
      let state = await feedback(page, {}, 'demo');
      const before = state.current_plan.version;
      await nav(page, 'report', /反馈报告|AI.*反馈/);
      await click(page, mobile ? 'adjustment-keep' : 'adjustment-accept', mobile ? /保持.*计划/ : /接受.*调整|接受.*建议/);
      state = await until(page, s => s.reports.at(-1).adjustment.status === (mobile ? 'kept' : 'accepted'));
      assert.equal(state.current_plan.version, mobile ? before : before + 1);
      return { decision: mobile ? 'keep' : 'accept', original_version: before, resulting_version: state.current_plan.version, completion_count: state.logs.length, feedback_count: state.reports.length };
    });
    if (!mobile) {
      await check('Keeping a later adjustment retains the current plan', detail, async () => {
        // The adjusted week preserves completed session IDs. Start a fresh plan
        // so there is still a next unfinished task to which a proposal can apply.
        await plan(page, 'demo', true);
        await endTraining(page, 30, 'demo');
        let state = await feedback(page, { difficulty: 4, issue: '读线与动作选择' }, 'demo');
        const before = state.current_plan.version;
        await nav(page, 'report', /反馈报告|AI.*反馈/);
        await click(page, 'adjustment-keep', /保持.*计划/);
        state = await until(page, s => s.reports.at(-1).adjustment.status === 'kept');
        assert.equal(state.current_plan.version, before);
        assert.ok(state.plans.length >= 2);
        await nav(page, 'account', /个人中心/);
        await page.getByRole('tab', { name: /计划版本/ }).click();
        for (const previous of state.plans) assert.ok((await page.locator('.history-content').innerText()).includes(`v${previous.version}`));
        return { plan_versions: state.plans.map(p => p.version), kept_version: before };
      });
    }
    await check('Knowledge sources and out-of-library refusal', detail, () => knowledge(page, 'demo'));
    await check('JSON export of saved records', detail, () => exportData(page, `demo-${width}`));
    await check('All primary pages and responsive layout', detail, () => allPages(page));
    if (!mobile) {
      await check('Pain feedback immediately pauses training', detail, async () => {
        await plan(page, 'demo', true);
        await endTraining(page, 20, 'demo');
        const state = await feedback(page, { difficulty: 3, issue: '暂无明显卡点', pain: true }, 'demo');
        assert.equal(state.paused, true);
        for (const session of state.current_plan.sessions) {
          const completed = state.logs.find(log => log.session_id === session.id);
          assert.equal(session.status, completed ? completed.status : 'paused');
        }
        assert.match(await page.locator('body').innerText(), /暂停|停止/);
        return { paused: true, session_statuses: state.current_plan.sessions.map(s => s.status) };
      });
    }
    await check('Reload preserves profile, plans, logs and pause state', detail, async () => {
      const before = await savedState(page);
      await page.reload({ waitUntil: 'networkidle' });
      const after = await savedState(page);
      assert.equal(after.profile.nickname, before.profile.nickname);
      assert.equal(after.current_plan.version, before.current_plan.version);
      assert.equal(after.logs.length, before.logs.length);
      assert.equal(after.paused, before.paused);
      return { logs: after.logs.length, feedback_reports: after.reports.length, paused: after.paused };
    });
    await check('Delete/reset clears the current browser records', detail, async () => {
      const before = await savedState(page);
      await deleteData(page, 'demo');
      await page.reload({ waitUntil: 'networkidle' });
      assert.equal((await savedState(page)).profile, null);
      return { profile_cleared: true, completion_count_before_delete: before.logs.length, feedback_count_before_delete: before.reports.length };
    });
  } catch (error) {
    await page.screenshot({ path: path.join(out, `failure-demo-${width}.png`), fullPage: true }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}

async function textPainBoundary(browser, notes, expectedPause) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', error => report.page_errors.push({ suite: 'text-pain-boundary', message: error.message }));
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await profile(page, '文本边界验收用户');
    await plan(page, 'demo');
    await endTraining(page, 60, 'demo');
    const state = await feedback(page, { issue: '暂无明显卡点', pain: false, notes }, 'demo');
    assert.equal(state.paused, expectedPause);
    assert.equal(await page.locator('.pause-banner').count(), expectedPause ? 1 : 0);
    assert.equal(state.current_plan.sessions.find(session => session.id === state.logs[0].session_id).status, 'completed');
    return { notes, pain_checkbox_selected: false, paused: state.paused, original_completed_status_retained: true };
  } finally { await context.close(); }
}

async function apiSuite(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', error => report.page_errors.push({ suite: 'backend', message: error.message }));
  page.on('dialog', dialog => dialog.accept());
  const detail = { suite: 'backend', viewport_width: 1440 };
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await check('Backend connection failure has a visible recovery state', detail, async () => {
      await setMode(page, 'api', 'http://127.0.0.1:9');
      const alert = page.getByRole('alert');
      await alert.filter({ hasText: /无法连接|连接失败|后端/ }).first().waitFor({ state: 'visible' });
      return { error: await alert.first().innerText(), observed_failure: true };
    });
    if (!api) {
      report.checks.push({ name: 'Actual backend provider loop', ...detail, status: 'skipped', reason: 'No --api URL supplied. Live backend behavior was not tested.' });
      return;
    }
    await setMode(page, 'api', api);
    await check('Actual backend profile, confirmed plan and feedback loop', { ...detail, mode: 'api' }, async () => {
      await profile(page, 'API验收用户', 'api');
      const created = await until(page, s => s.profile?.nickname === 'API验收用户', 'api');
      const planned = await plan(page, 'api');
      await endTraining(page, 30, 'api');
      const state = await feedback(page, {}, 'api');
      await nav(page, 'report', /反馈报告|AI.*反馈/);
      await click(page, 'adjustment-keep', /保持.*计划/);
      const kept = await until(page, s => s.reports.at(-1).adjustment.status === 'kept', 'api');
      await page.reload({ waitUntil: 'networkidle' });
      assert.equal((await savedState(page, 'api')).logs.length, 1);
      return { engine: state.engine, profile_version: created.profile.version, plan_version: planned.current_plan.version, persisted_logs: kept.logs.length, feedback_reports: kept.reports.length, provider_runs: kept.runs.map(run => ({ provider: run.provider, status: run.status, model_calls: run.model_calls })) };
    });
    await check('Editing an API profile preserves logs and renders every history version', { ...detail, mode: 'api' }, async () => {
      const before = await savedState(page, 'api');
      await profile(page, 'API更新档案用户', 'api');
      const edited = await savedState(page, 'api');
      assert.ok(edited.profile.version > before.profile.version);
      assert.equal(edited.logs.length, before.logs.length);
      await plan(page, 'api');
      const confirmed = await savedState(page, 'api');
      await nav(page, 'account', /个人与历史|个人中心/);
      await page.getByRole('tab', { name: /计划版本/ }).click();
      assert.equal(await page.locator('.history-content .history-detail').count(), confirmed.plans.length);
      const displayedPlanVersions = await page.locator('.history-content .version-badge').allTextContents();
      assert.deepEqual(displayedPlanVersions, [...confirmed.plans].reverse().map(item => `v${item.version}`));
      await page.getByRole('tab', { name: /画像版本/ }).click();
      assert.equal(await page.locator('.history-content .history-detail').count(), confirmed.profile_versions.length);
      const displayedProfileVersions = await page.locator('.history-content .version-badge').allTextContents();
      assert.deepEqual(displayedProfileVersions, [...confirmed.profile_versions].reverse().map(item => `v${item.version}`));
      return { updated_nickname: confirmed.profile.nickname, plan_versions: displayedPlanVersions, profile_versions: displayedProfileVersions, original_logs_retained: confirmed.logs.length };
    });
    await check('Actual backend export and deletion', { ...detail, mode: 'api' }, async () => {
      const exported = await exportData(page, 'backend');
      await deleteData(page, 'api');
      assert.equal((await savedState(page, 'api')).profile, null);
      return { ...exported, api_records_deleted: true };
    });
  } catch (error) {
    await page.screenshot({ path: path.join(out, 'failure-api.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}

async function capturePresentation(browser, width, mobile = false) {
  const context = await browser.newContext({ viewport: { width, height: mobile ? 844 : 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => report.page_errors.push({ suite: `presentation-${width}`, message: error.message }));
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /^体验模拟案例/ }).click();
    const state = await until(page, s => s.profile?.nickname === '小林' && s.logs.length > 0 && s.logs.every(log => log.sample));
    await page.waitForTimeout(400);
    const closeToast = page.getByRole('button', { name: '关闭提示', exact: true });
    if (await closeToast.count()) await closeToast.click();
    await page.evaluate(async () => {
      await document.fonts.ready;
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await page.waitForFunction(() => window.scrollY === 0);
    assert.equal(await page.evaluate(() => scrollY), 0);
    const filename = `climbai-${mobile ? 'mobile' : 'desktop'}.png`;
    await page.screenshot({ path: path.join(out, filename), fullPage: false, animations: 'disabled' });
    report.screenshots.push({ file: filename, width, height: mobile ? 844 : 1000, page: 'today', fixture: 'Built-in simulated Xiaolin example loaded through the interface', sample_data: true, completed_logs: state.logs.length, feedback_reports: state.reports.length, scroll_y: 0 });
    return { screenshot: filename, sample_data: true, viewport_width: width, scroll_y: 0 };
  } finally { await context.close(); }
}

async function targetedSuite(browser) {
  const errorCount = report.page_errors.length;
  await check('Goal text indicating pain saves a paused profile without generating a plan', { suite: 'targeted-revision', tested_bundle: expectedBundle, mode: 'demo_rules' }, async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', error => report.page_errors.push({ suite: 'targeted-revision', message: error.message }));
    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      const assets = await page.locator('script[src]').evaluateAll(items => items.map(item => item.getAttribute('src')));
      assert.ok(assets.some(asset => asset.endsWith(expectedBundle)), 'The requested final bundle must actually be served');
      await page.getByRole('button', { name: /^建立我的训练计划$/ }).click();
      await page.getByTestId('profile-nickname').fill('目标文本验收用户');
      await page.getByTestId('profile-goal').fill('手指不太疼但想继续训练');
      await page.getByTestId('profile-adult').check();
      const painCheckbox = page.getByRole('checkbox', { name: /最近出现疼痛或明显不适/ });
      assert.equal(await painCheckbox.isChecked(), false);
      await page.getByTestId('profile-save').click();
      const state = await until(page, s => s.profile && s.paused && !s.current_plan);
      await page.waitForURL(/#profile$/);
      await page.waitForTimeout(400);
      assert.equal(state.plans.length, 0);
      assert.equal(await page.locator('.toast.error').count(), 0);
      assert.equal(await page.locator('.pause-banner').count(), 1);
      assert.ok(state.runs.every(run => !/生成训练计划/.test(run.workflow)));
      assert.equal(report.page_errors.length, errorCount);
      return { goal: state.profile.goal, pain_checkbox_selected: false, paused: state.paused, page: 'profile', generated_plans: state.plans.length, error_toasts: 0, served_assets: assets };
    } finally { await context.close(); }
  });
  for (const mode of ['demo', 'api']) {
    await check('Non-integer and out-of-range duration is rejected before saving or sending; integer still works', { suite: 'targeted-revision', tested_bundle: expectedBundle, mode }, async () => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      const completionRequests = [];
      page.on('request', request => { if (/\/api\/sessions\/[^/]+\/complete$/.test(request.url())) completionRequests.push(request.url()); });
      page.on('pageerror', error => report.page_errors.push({ suite: 'targeted-revision', message: error.message }));
      try {
        await page.goto(url, { waitUntil: 'networkidle' });
        if (mode === 'api') await setMode(page, mode, api);
        await profile(page, `整数时长验收-${mode}`, mode);
        await plan(page, mode);
        await nav(page, 'training', /训练记录/);
        const before = await savedState(page, mode);
        const rejected = [];
        const expectedMessage = '实际训练时长必须是 0–240 的整数分钟。0 表示跳过本次训练。';
        for (const value of ['30.5', '-1', '241']) {
          await page.getByTestId('training-minutes').fill(value);
          await page.getByTestId('training-complete').click();
          await page.locator('.toast.error').waitFor({ state: 'visible' });
          assert.equal(await page.locator('.toast.error span').first().innerText(), expectedMessage);
          assert.equal((await savedState(page, mode)).logs.length, before.logs.length);
          assert.equal(completionRequests.length, 0);
          rejected.push({ value, logs_added: 0, completion_requests_sent: 0 });
          await page.getByRole('button', { name: '关闭提示', exact: true }).click();
        }
        await page.getByTestId('training-minutes').fill('30');
        await page.getByTestId('training-complete').click();
        const after = await until(page, s => s.logs.length === before.logs.length + 1, mode);
        assert.equal(after.logs.at(-1).actual_minutes, 30);
        assert.equal(completionRequests.length, mode === 'api' ? 1 : 0);
        if (mode === 'api') await deleteData(page, mode);
        assert.equal(report.page_errors.length, errorCount);
        return { rejected, message: expectedMessage, accepted_integer: 30, logs_added_for_integer: 1, completion_requests_for_integer: completionRequests.length };
      } finally { await context.close(); }
    });
  }
}

async function zeroMinuteBackend() {
  assert.ok(api, 'Supply --api for direct backend checks');
  const session = randomUUID();
  const request = async (endpoint, method = 'GET', body) => {
    const response = await fetch(api.replace(/\/$/, '') + endpoint, { method, headers: { 'Content-Type': 'application/json', 'X-Session-ID': session }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.ok(response.ok, `Backend HTTP ${response.status} for ${method} ${endpoint}`);
    return response.json();
  };
  await check('Actual restarted backend stores zero-minute completion as skipped in log, session and event', { suite: 'zero-minute-backend-revision', mode: 'api', tested_bundle: expectedBundle }, async () => {
    try {
      const health = await request('/api/health');
      await request('/api/profile', 'POST', { nickname: '零分钟HTTP验收用户', goal: '每周记录训练事实', adult_confirmed: true, sessions_per_week: 2, available_minutes: 60 });
      const draft = await request('/api/plans/generate', 'POST', {});
      const confirmed = await request('/api/plans/confirm', 'POST', { expected_version: draft.current_plan.version });
      const first = confirmed.current_plan.sessions[0];
      const completed = await request(`/api/sessions/${first.id}/complete`, 'POST', { actual_minutes: 0 });
      assert.equal(completed.logs.at(-1).actual_minutes, 0);
      assert.equal(completed.logs.at(-1).status, 'skipped');
      assert.equal(completed.current_plan.sessions.find(item => item.id === first.id).status, 'skipped');
      assert.equal(completed.events.at(-1).type, 'training_skipped');
      assert.equal(completed.logs.at(-1).feedback_submitted, false);
      return { provider: health.provider, actual_minutes: 0, log_status: completed.logs.at(-1).status, session_status: completed.current_plan.sessions.find(item => item.id === first.id).status, event_type: completed.events.at(-1).type, feedback_submitted: false };
    } finally { await request('/api/data', 'DELETE'); }
  });
}

const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ headless: true, executablePath: process.env.QA_BROWSER_PATH || (existsSync(edgePath) ? edgePath : undefined) });
try {
  if (targetedOnly) {
    await targetedSuite(browser).catch(error => console.error(error.message));
  } else if (zeroMinutesOnly) {
    await zeroMinuteBackend().catch(error => console.error(error.message));
  } else {
  for (const suite of [() => demoSuite(browser, 1440), () => demoSuite(browser, 375, true), () => apiSuite(browser)]) {
    try { await suite(); } catch (error) { console.error(error.message); }
  }
  for (const [name, notes, expectedPause] of [
    ['Pain mentioned only in free text pauses training', '手指不太疼但想继续练', true],
    ['Explicitly negated pain statement does not trigger a pause', '今天无疼痛，休息后继续记录', false],
  ]) {
    await check(name, { suite: 'text-pain-boundary', mode: 'demo_rules' }, () => textPainBoundary(browser, notes, expectedPause)).catch(error => console.error(error.message));
  }
  for (const width of [1440, 375]) {
    await check('Public screenshot from the built-in simulated example', { suite: `presentation-${width}` }, () => capturePresentation(browser, width, width === 375)).catch(error => console.error(error.message));
  }
  await check('No uncaught application JavaScript errors', { suite: 'all' }, async () => {
    assert.deepEqual(report.page_errors, []);
    return { count: report.page_errors.length };
  }).catch(() => {});
  }
} finally {
  await browser.close();
  report.finished_at = new Date().toISOString();
  if (revision) {
    revision.finished_at = report.finished_at;
    revision.new_check_count = report.checks.length - revision.previous_check_count;
    revision.failed_checks = report.checks.slice(revision.previous_check_count).filter(item => item.status === 'failed').length;
  }
  report.summary = {
    attempted: report.checks.filter(item => item.status !== 'skipped').length,
    passed: report.checks.filter(item => item.status === 'passed').length,
    failed: report.checks.filter(item => item.status === 'failed').length,
    skipped: report.checks.filter(item => item.status === 'skipped').length,
    denominator: report.checks.some(item => item.suite === 'zero-minute-backend-revision') ? 'Attempted product verification scenarios: browser interactions plus explicitly labeled direct HTTP regression checks; not people, sessions or LLM tasks.' : 'Attempted browser scenarios, including layout and error-state checks; not people, sessions or LLM tasks.',
  };
  writeFileSync(path.join(out, 'browser-qa.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary));
  if (report.summary.failed) process.exitCode = 1;
}
