import { DomainError, ensure, Review } from '../../src/shared/domain';

// Public source has no shared CloudBase environment. Configure this server-side.
export function freeEnvironment(env: Record<string, string | undefined> = process.env): string {
  const value = env.PANJI_FREE_ENV_ID || '';
  return /^[a-zA-Z0-9-]{1,100}$/.test(value) ? value : '';
}
export const FREE_ENV = freeEnvironment();
const str = { type: 'string', minLength: 1 };
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const reviewSchema = object({ summary: str,
  observations: { type: 'array', minItems: 1, maxItems: 8, items: object({ text: str, evidenceIds: { type: 'array', minItems: 1, items: str } }) },
  hypotheses: { type: 'array', maxItems: 4, items: object({ text: str, reason: str, uncertainty: str }) },
  actions: { type: 'array', minItems: 1, maxItems: 2, items: object({ text: str, metric: str, followupQuestion: str }) },
  limitations: { type: 'array', minItems: 1, maxItems: 8, items: str },
});
export const freeCapabilities = {
  provider: '腾讯云 CloudBase／腾讯混元', model: 'hy3',
  privacyUrl: 'https://cloud.tencent.com/document/product/301/11470',
  retention: '本小程序保留已生成复盘及输入快照至你删除；撤回授权停止后续调用并取消未完成任务。腾讯云侧按其隐私声明处理，不承诺零留存。',
};
export function checkFreeBilling(value: any): void {
  ensure(FREE_ENV && value?.EnvId === FREE_ENV && value.PackageId === 'baas_trial' && value.Status === 'NORMAL' &&
    value.PayMode === 'PREPAYMENT' && value.IsAutoRenew === false && value.EnableOverrun === false && value.EnvDeductionMode === 'credits',
  'AI_FREE_PLAN_REQUIRED', '免费 AI 当前不可用，可以继续使用数据摘要或手写复盘');
}
export function parseModelResult(result: any): { output: unknown; modelVersion: string; tokenUsage: number } {
  const raw = result?.rawResponses?.[0] || result;
  const code = result?.error?.code || raw?.code;
  if (code || result?.error) throw new DomainError(/quota|limit|credits|balance/i.test(String(code)) ? 'AI_FREE_QUOTA' : 'AI_UPSTREAM_ERROR', 'AI 暂时无法生成，可以继续使用数据摘要');
  const content = result?.text ?? raw?.choices?.[0]?.message?.content;
  ensure(raw?.choices?.[0]?.finish_reason === 'stop' && typeof content === 'string' && content.length <= 12000,
    'AI_INVALID_OUTPUT', '模型输出不完整，请使用数据摘要');
  let output: unknown;
  try { output = JSON.parse(content); } catch { throw new DomainError('AI_INVALID_OUTPUT', '模型未返回有效复盘'); }
  const tokenUsage = Number(result?.usage?.total_tokens ?? raw?.usage?.total_tokens);
  ensure(Number.isFinite(tokenUsage) && tokenUsage >= 0 && tokenUsage <= 32000, 'AI_INVALID_OUTPUT', '模型用量信息无效');
  const model = typeof raw?.model === 'string' && /^[\w./-]{1,75}$/.test(raw.model) ? raw.model : 'hy3';
  return { output, modelVersion: 'cloudbase/' + model, tokenUsage };
}
async function reserveMonthlyCall(db: any): Promise<void> {
  const month = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7);
  await db.runTransaction(async (tx: any) => {
    const doc = tx.collection('pj_accounts').doc('_system_ai_budget_' + month);
    let value: any;
    try { value = (await doc.get()).data; } catch (e) {
      if (!/document.*(?:not exist|does not exist)|DATABASE_DOCUMENT_NOT_EXIST|DOCUMENT_NOT_FOUND/i.test(String((e as any)?.errMsg || (e as any)?.message || (e as any)?.code))) throw e;
    }
    const count = value?.calls || 0;
    ensure(Number.isInteger(count) && count >= 0 && count < 30, 'AI_FREE_QUOTA', '本月免费 AI 额度已用完，训练记录和数据摘要仍可使用');
    // Aggregate only: no user identity, notes, prompts or model result. Failed requests consume a slot too.
    await doc.set({ data: { kind: 'aggregate_ai_budget', month, calls: count + 1, maintenance: false } });
  });
}
export async function generateFree(job: Review, systemPrompt: string, beforeSend?: () => Promise<void>): Promise<{ output: unknown; modelVersion: string; tokenUsage: number }> {
  ensure(FREE_ENV && process.env.PANJI_FREE_ENV_ID === FREE_ENV && job.inputSnapshot, 'AI_UNAVAILABLE', 'AI 环境未配置');
  const input = JSON.stringify({ untrustedTrainingData: job.inputSnapshot });
  ensure(input.length <= 8000, 'AI_INPUT_TOO_LARGE', '这段训练内容较多，请缩小复盘日期范围');
  const CloudBase = require('@cloudbase/manager-node');
  const manager = new CloudBase({ envId: FREE_ENV, timeout: 5000 });
  const billing = await manager.env.describeBillingInfo({ EnvId: FREE_ENV });
  checkFreeBilling(billing.EnvBillingInfoList?.find((v: any) => v.EnvId === FREE_ENV));
  const catalog = await manager.aiModel.describeManagedAIModelList({ envId: FREE_ENV });
  const prices = catalog.ManagedAIModelList?.find((g: any) => g.GroupName === 'cloudbase')?.Models?.find((m: any) => m.Model === 'hy3')?.ModelChargingInfo;
  ensure(Array.isArray(prices) && prices.length === 1 && prices[0].Type === 'Uniform' && prices[0].InputOutputUnit === 'million_tokens' &&
    Number(prices[0].InputPrice) <= 1 && Number(prices[0].OutputPrice) <= 4, 'AI_FREE_QUOTA', '免费 AI 预算暂不可确认，请使用数据摘要');
  const cloud = require('wx-server-sdk');
  await reserveMonthlyCall(cloud.database());
  await beforeSend?.();
  // Fixed provider and model; no tools, credentials, paid fallback or automatic retry.
  try {
    const sdk = require('@cloudbase/node-sdk');
    // The generic model adapter ignores the per-call timeout option. Configure the SDK transport itself.
    const client = sdk.init({ env: FREE_ENV, timeout: 45000 });
    const result = await client.ai().createModel('cloudbase').generateText({ model: 'hy3', temperature: 0.2,
      max_tokens: 2400, maxSteps: 1, thinking: { type: 'disabled' },
      response_format: { type: 'json_schema', json_schema: { name: 'panji_review', strict: true, schema: reviewSchema } },
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: input }] }, { timeout: 45000 });
    return parseModelResult(result);
  } catch (e) {
    if (e instanceof DomainError) throw e;
    const code = String((e as any)?.code || (e as any)?.errCode || 'ERROR');
    if (/rate|limit|quota|credits|balance/i.test(code)) throw new DomainError('AI_FREE_QUOTA', '免费 AI 请求较多或额度不足，请稍后再试');
    if (/timeout|abort/i.test(code)) throw new DomainError('AI_TIMEOUT', '模型生成超时，请稍后再试');
    // An error code is safe to retain; never return provider error objects/messages with request bodies.
    throw new DomainError('AI_PROVIDER_' + (/^[\w.-]{1,45}$/.test(code) ? code : 'ERROR'), '模型服务暂时未能完成请求');
  }
}
