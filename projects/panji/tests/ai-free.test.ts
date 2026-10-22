import './fixtures-ai-environment';
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFreeBilling, FREE_ENV, freeEnvironment, parseModelResult } from '../cloudfunctions/panji/ai-free';
import { capabilities } from '../cloudfunctions/panji/ai';
import { dispatch, fixture } from './fixtures';
import { buildSync } from 'esbuild';
import vm from 'node:vm';
test('免费模型需显式配置服务端环境；付费、超额、自动续费或未知计费状态均拒绝', () => {
  const env = { PANJI_AI_ENABLED: 'true', PANJI_AI_BACKEND: 'cloudbase-free', PANJI_FREE_ENV_ID: FREE_ENV };
  assert.equal(capabilities(env).aiAvailable, true);
  assert.equal(capabilities({ ...env, PANJI_FREE_ENV_ID: '' }).aiAvailable, false);
  assert.equal(capabilities({ ...env, PANJI_FREE_ENV_ID: 'invalid/environment' }).aiAvailable, false);
  assert.equal(freeEnvironment({}), '');
  assert.equal(capabilities({ ...env, PANJI_AI_ENABLED: 'false' }).aiAvailable, false);
  const billing = { EnvId: FREE_ENV, PackageId: 'baas_trial', Status: 'NORMAL', PayMode: 'PREPAYMENT', IsAutoRenew: false, EnableOverrun: false, EnvDeductionMode: 'credits' };
  assert.doesNotThrow(() => checkFreeBilling(billing));
  for (const change of [{ PackageId: 'paid' }, { IsAutoRenew: true }, { EnableOverrun: true }, { EnableOverrun: undefined }, { EnvId: 'another-env' }, { Status: 'EXPIRED' }])
    assert.throws(() => checkFreeBilling({ ...billing, ...change }), /免费 AI/);
});
test('模型 SDK 的错误、截断、非 JSON 与无效用量不能显示为成功', () => {
  const raw = { choices: [{ finish_reason: 'stop', message: { content: '{"synthetic":true}' } }], usage: { total_tokens: 120 } };
  assert.deepEqual(parseModelResult(raw).output, { synthetic: true });
  assert.equal(parseModelResult({ text: '{"synthetic":true}', rawResponses: [raw], usage: raw.usage }).tokenUsage, 120);
  for (const result of [{ code: 'EXCEED_TOKEN_QUOTA_LIMIT' }, { error: { code: 'NO_QUOTA' }, rawResponses: [] },
    { ...raw, choices: [{ finish_reason: 'length', message: { content: '{}' } }] },
    { ...raw, text: '```json\n{}\n```' }, { ...raw, usage: {} }]) assert.throws(() => parseModelResult(result));
});
test('删除复盘不重置每天三次 AI 限额，第二天恢复', () => {
  let state = fixture();
  for (let n = 0; n < 3; n++) {
    state = dispatch(state, 'review.create', { from: '2026-10-05', to: '2026-10-18', mode: 'ai' }, { aiEnabled: true }).state;
    state = dispatch(state, 'review.delete', { id: state.reviews[0]._id }).state;
  }
  assert.equal(state.reviews.length, 0);
  assert.throws(() => dispatch(state, 'review.create', { from: '2026-10-05', to: '2026-10-18', mode: 'ai' }, { aiEnabled: true }), /次数已用完/);
  assert.doesNotThrow(() => dispatch(state, 'review.create', { from: '2026-10-05', to: '2026-10-18', mode: 'ai' }, { aiEnabled: true, now: '2026-10-20T04:00:00Z' }));
});

test('跨账户共享的月额度在发送前占用；撤回确认或额度耗尽时不调用模型', async () => {
  const source = buildSync({ entryPoints: ['cloudfunctions/panji/ai-free.ts'], bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['@cloudbase/manager-node','@cloudbase/node-sdk','wx-server-sdk'] }).outputFiles[0].text;
  let count = 0, modelCalls = 0;
  const doc = { async get() { return { data: { calls: count } }; }, async set({ data }: any) { count = data.calls; } };
  const db = { async runTransaction(fn: any) { await fn({ collection: () => ({ doc: () => doc }) }); } };
  const module = { exports: {} };
  const sandbox: any = { module, exports: module.exports, process: { env: { PANJI_FREE_ENV_ID: FREE_ENV } }, require: (name: string) => {
    if (name === '@cloudbase/manager-node') return class {
      env = { describeBillingInfo: async () => ({ EnvBillingInfoList: [{ EnvId: FREE_ENV, PackageId: 'baas_trial', Status: 'NORMAL', PayMode: 'PREPAYMENT', IsAutoRenew: false, EnableOverrun: false, EnvDeductionMode: 'credits' }] }) };
      aiModel = { describeManagedAIModelList: async () => ({ ManagedAIModelList: [{ GroupName: 'cloudbase', Models: [{ Model: 'hy3', ModelChargingInfo: [{ Type: 'Uniform', InputOutputUnit: 'million_tokens', InputPrice: '1', OutputPrice: '4' }] }] }] }) };
    };
    if (name === 'wx-server-sdk') return { database: () => db };
    if (name === '@cloudbase/node-sdk') return { init: (options: any) => { assert.equal(options.timeout,45000);return { ai: () => ({ createModel: () => ({ generateText: async () => {
      modelCalls++; return { text: '{}', usage: { total_tokens: 1 }, rawResponses: [{ choices: [{ finish_reason: 'stop' }] }] };
    } }) }) }; } };
    throw Error('Unexpected dependency');
  } };
  vm.runInNewContext(source, sandbox);
  const generate = (module.exports as any).generateFree;
  const job = dispatch(fixture(),'review.create',{ from:'2026-10-05',to:'2026-10-18',mode:'ai' },{ aiEnabled:true }).value;
  await assert.rejects(generate(job,'synthetic',async()=>{throw Error('revoked before send');}), /revoked/);
  assert.equal(modelCalls,0);assert.equal(count,1);
  count = 29;await generate(job,'synthetic');assert.equal(count,30);assert.equal(modelCalls,1);
  await assert.rejects(generate(job,'synthetic'), (e: any)=>e.code==='AI_FREE_QUOTA');
  assert.equal(modelCalls,1);assert.equal(count,30);
});
