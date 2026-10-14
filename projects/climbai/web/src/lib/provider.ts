import type { Answer, AppState, Citation, Dimension, FeedbackInput, Focus, Plan, Profile, ProfileInput, Provider, Report } from './types';

const key = 'climbai.session';
export function sessionId() {
  let id = localStorage.getItem(key);
  if (!id || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) {
    id = crypto.randomUUID(); localStorage.setItem(key, id);
  }
  return id;
}
const stateKey = () => `climbai.demo.v1.${sessionId()}`;
const now = () => new Date().toISOString();
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const delay = () => new Promise(resolve => setTimeout(resolve, 350));
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
export const focusLabels: Record<Focus, string> = { footwork: '脚点控制', route_reading: '读线与动作选择', consistency: '建立训练习惯', body_position: '身体协调' };
export const defaultProfile: ProfileInput = { nickname: '', experience_months: 3, grade: '暂不清楚', grade_system: 'V 等级', gym: '', sessions_per_week: 2, available_minutes: 60, equipment: ['climbing_wall', 'mat'], goal: '建立每周到馆与复盘习惯，练习脚点控制', focus: 'footwork', recent_pain: false, adult_confirmed: false };
export const knowledgeSources: Citation[] = [
  { id: 'demo-footwork', title: '脚点观察练习', summary: 'ClimbAI 自编示例条目：选择熟悉的容易线路，观察落脚位置，并记录何时出现脚点滑落。', source_type: '自编示例 · 待专业审阅' },
  { id: 'demo-reading', title: '上墙前的读线记录', summary: 'ClimbAI 自编示例条目：上墙前描述计划动作，下墙后比较计划与实际差异。', source_type: '自编示例 · 待专业审阅' },
  { id: 'demo-planning', title: '时间预算与训练记录', summary: 'ClimbAI 自编示例条目：优先把计划限制在实际可用时间内；完成事件与训练反馈分别记录。', source_type: '自编示例 · 待专业审阅' },
  { id: 'demo-coordination', title: '熟悉线路中的动作观察', summary: 'ClimbAI 自编示例条目：选择已能稳定完成的线路，观察身体位置与动作顺序，不从单次尝试推断力量水平。', source_type: '自编示例 · 待专业审阅' },
];

export function emptyState(): AppState {
  return { profile: null, profile_versions: [], current_plan: null, current_plan_id: null, plans: [], sessions: [], logs: [], reports: [], answers: [], runs: [], paused: false, engine: 'demo_rules', events: [] };
}

function normalize(value: Partial<AppState>): AppState {
  const result = { ...emptyState(), ...value };
  result.profile_versions ||= []; result.plans ||= []; result.logs ||= []; result.reports ||= []; result.answers ||= []; result.runs ||= []; result.events ||= [];
  result.sessions = result.current_plan?.sessions ?? result.sessions ?? [];
  return result;
}

function loadLocal(): AppState {
  const raw = localStorage.getItem(stateKey());
  if (!raw) return emptyState();
  try { return normalize(JSON.parse(raw)); } catch { throw new Error('本地记录读取失败。请在个人中心导出或重置此浏览器的演示数据。'); }
}
function saveLocal(state: AppState) {
  try { localStorage.setItem(stateKey(), JSON.stringify(state)); } catch { throw new Error('浏览器无法保存记录。请检查存储空间与隐私模式。'); }
  return clone(state);
}
function event(state: AppState, type: string, session?: string) {
  state.events ??= []; state.events.push({ id: uid('event'), type, created_at: now(), session_id: session, plan_version: state.current_plan?.version });
}
function run(state: AppState, workflow: string, nodes: string[]) {
  state.runs.push({ id: uid('run'), workflow, provider: 'demo_rules', nodes, status: 'completed', created_at: now(), duration_ms: 0, model_calls: 0 });
}
export function hasPainSignal(value: string) {
  let text = value.toLowerCase();
  for (const phrase of ['没有疼痛', '没有不适', '无疼痛', '无不适', 'no pain']) text = text.replaceAll(phrase, '');
  text = text.replace(/(^|[，。；、\s])不疼(?=$|[，。；、\s])/g, '$1');
  return /疼|痛|不适|受伤|肿|麻木|诊断|康复|用药|pain|injur/.test(text);
}
function validateMinutes(minutes: number) {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 240) throw new Error('实际训练时长必须是 0–240 的整数分钟。0 表示跳过本次训练。');
}
function pauseTasks(state: AppState) {
  state.paused = true;
  if (state.profile) state.profile.recent_pain = true;
  if (state.current_plan) {
    state.current_plan.status = 'paused';
    state.current_plan.sessions.forEach(s => { if (!state.logs.some(l => l.session_id === s.id)) s.status = 'paused'; });
    const saved = state.plans.find(p => p.id === state.current_plan_id && p.version === state.current_plan!.version);
    if (saved) { saved.status = 'paused'; saved.sessions = clone(state.current_plan.sessions); }
  }
}
function buildDimensions(profile: ProfileInput, version: number): Dimension[] {
  return (Object.entries(focusLabels) as [Focus, string][]).map(([key, label]) => ({
    key, label,
    observation: key === profile.focus ? `你选择了「${label}」作为优先训练重点。` : '尚无可用于判断这一维度的训练记录。',
    hypothesis: key === profile.focus ? `${label}可以作为下一次观察重点；这不是能力测量结论。` : '暂不形成能力结论。',
    evidence_ids: key === profile.focus ? [`profile-v${version}-self-report`] : [],
    evidence_level: key === profile.focus ? '仅自评' : '资料不足',
    next_step: key === profile.focus ? '在熟悉线路中记录一次具体观察，比较容易与困难线路的差异。' : '随着训练记录积累，再决定是否需要关注。',
  }));
}
function applyProfile(state: AppState, input: ProfileInput) {
  if (!input.adult_confirmed) throw new Error('当前体验仅面向 18 岁及以上用户。');
  if (!input.nickname.trim()) throw new Error('请填写你的称呼。');
  if (!input.goal.trim()) throw new Error('请填写一个可观察的训练目标。');
  if (input.available_minutes < 20 || input.available_minutes > 120) throw new Error('单次训练时间应在 20–120 分钟之间。');
  if (input.sessions_per_week < 1 || input.sessions_per_week > 3) throw new Error('首版支持每周 1–3 次训练。');
  const version = (state.profile?.version ?? 0) + 1;
  const profile: Profile = { ...clone(input), nickname: input.nickname.trim(), goal: input.goal.trim(), version, created_at: now(), dimensions: buildDimensions(input, version), facts: [`攀岩经历 ${input.experience_months} 个月（用户填写）`, `稳定完成范围：${input.grade} / ${input.grade_system}`, `每周可安排 ${input.sessions_per_week} 次，每次 ${input.available_minutes} 分钟`], missing_fields: ['未进行力量或耐力测量', '尚未建立跨场景的技术评估'], constraints: input.recent_pain ? ['近期存在不适，暂停攀爬训练建议'] : ['仅室内抱石示例；不包含指力板或高强度专项训练'] };
  state.profile = profile; state.profile_versions.push(clone(profile));
  state.paused = state.paused || input.recent_pain || hasPainSignal(input.goal);
  if (state.paused) pauseTasks(state);
  event(state, 'profile_saved'); run(state, '建立初始画像', ['输入检查', '用户画像', '保存画像快照']);
}
function createPlan(state: AppState, budget?: number): Plan {
  const p = state.profile;
  if (!p) throw new Error('请先建立个人档案。');
  if (!p.adult_confirmed) throw new Error('请先确认已年满 18 岁。');
  if (state.paused || p.recent_pain) throw new Error('你记录了近期不适，相关训练已暂停。请先确认状态并获取专业建议。');
  if (!p.equipment.includes('climbing_wall') || !p.equipment.includes('mat')) throw new Error('当前示例只支持配有保护垫的室内抱石场地。请补充场地条件。');
  const duration = Math.min(budget ?? p.available_minutes, p.available_minutes);
  const warmup = Math.min(10, Math.floor(duration * .2));
  const review = Math.min(5, Math.floor(duration * .1));
  const technique = Math.floor((duration - warmup - review) * .6);
  const familiar = duration - warmup - review - technique;
  const focus = focusLabels[p.focus];
  const sourceId = p.focus === 'footwork' ? 'demo-footwork' : p.focus === 'route_reading' ? 'demo-reading' : p.focus === 'body_position' ? 'demo-coordination' : 'demo-planning';
  const specificSteps: Record<Focus, string[]> = {
    footwork: ['选择你已能稳定完成的容易线路。', '每次落脚前看清目标脚点，按自己的节奏攀爬。', '下墙后记录：滑落发生在什么动作？容易线路与困难线路有何差异？'],
    route_reading: ['选择熟悉的容易线路，上墙前描述一条可能的动作顺序。', '按自己的节奏尝试，允许随时调整动作。', '下墙后比较：实际在哪一步与预想不同？'],
    body_position: ['选择你已能稳定完成的线路。', '观察身体位置变化，并记录哪个动作更容易失去平衡。', '不从单次尝试推断力量不足；保留待验证问题。'],
    consistency: ['选择容易且熟悉的线路，按自己的节奏完成。', '在安排的时间内留出休息；不追加额外训练任务。', '完成后记一次训练事实，再决定是否补充反馈。'],
  };
  const plan: Plan = {
    id: uid('plan'), version: Math.max(0, ...state.plans.map(x => x.version)) + 1, status: 'draft', title: `${focus} · 一周训练计划`, focus: p.focus, goal: p.goal,
    provider: 'demo_rules', summary: `${p.sessions_per_week} 次到馆，每次 ${duration} 分钟。先建立可观察的训练过程，再根据反馈调整。`,
    rationale: `依据你填写的「${focus}」重点、每周 ${p.sessions_per_week} 次和单次 ${p.available_minutes} 分钟预算，选择熟悉线路中的观察练习。当前依据主要来自自评。`,
    citations: knowledgeSources.filter(s => [sourceId, 'demo-planning'].includes(s.id)), created_at: now(), profile_version: p.version,
    sessions: Array.from({ length: p.sessions_per_week }, (_, i) => ({
      id: uid('session'), day: `第 ${i + 1} 次到馆`, title: i === 0 ? `${focus} · 观察与练习` : `${focus} · 复习与比较`, focus: p.focus, duration_minutes: duration, status: 'planned',
      rationale: i === 0 ? '先记录一条具体观察，避免把困难线路失败直接归因于能力。' : '在熟悉场景中复习，再比较上一次的观察。',
      stop_condition: '出现疼痛或明显不适时立即停止相关活动，向现场专业人员咨询。',
      exercises: [
        { id: 'easy-start', title: '轻松活动与状态检查', duration_minutes: warmup, steps: ['按岩馆指导做轻松活动。', '从容易且熟悉的动作开始，观察今天的状态。', '如果出现疼痛或不适，停止本次攀爬。'], rationale: '先观察状态，不直接进入困难尝试。', citation_ids: ['demo-planning'] },
        { id: `observe-${p.focus}`, title: `${focus}主题练习`, duration_minutes: technique, steps: specificSteps[p.focus], rationale: `回应你选择的「${focus}」目标。`, citation_ids: [sourceId] },
        { id: 'familiar-routes', title: '熟悉线路自主练习', duration_minutes: familiar, steps: ['选择符合当前状态的熟悉线路，允许休息或减少内容。', '观察主题练习是否影响了动作选择。', '不要因为一次顺利完成就提高强度。'], rationale: '把观察放回真实攀爬场景，保留休息与选择空间。', citation_ids: [sourceId] },
        { id: 'quick-review', title: '收尾与一句话复盘', duration_minutes: review, steps: ['结束本次攀爬并记录实际时长。', '用一句话描述最值得关注的动作或卡点。'], rationale: '独立保存训练完成事件，反馈可稍后补充。', citation_ids: ['demo-planning'] },
      ],
    })),
  };
  return plan;
}
function currentVersion(state: AppState) { return state.current_plan?.version ?? 0; }
function storePlan(state: AppState, plan: Plan) {
  state.plans.push(clone(plan)); state.current_plan = clone(plan); state.current_plan_id = plan.id; state.sessions = state.current_plan.sessions;
}

export class LocalProvider implements Provider {
  async getState() { return loadLocal(); }
  async saveProfile(profile: ProfileInput) { await delay(); const state = loadLocal(); applyProfile(state, profile); return saveLocal(state); }
  async generatePlan() { await delay(); const state = loadLocal(); const plan = createPlan(state); storePlan(state, plan); event(state, 'plan_generated'); run(state, '生成训练计划', ['读取画像', '示例条目检索', '计划组合', '时间与器材校验', '等待用户确认']); return saveLocal(state); }
  async confirmPlan(version: number) {
    await delay(); const state = loadLocal();
    if (!state.current_plan || currentVersion(state) !== version) throw new Error('计划版本发生变化，请刷新后再确认。');
    if (state.current_plan.profile_version !== state.profile?.version) throw new Error('档案或画像已经更新，请重新生成计划后再确认。');
    if (state.paused) throw new Error('当前训练处于暂停状态。');
    state.current_plan.status = 'confirmed'; const stored = state.plans.find(x => x.id === state.current_plan_id); if (stored) stored.status = 'confirmed';
    event(state, 'plan_confirmed'); return saveLocal(state);
  }
  async completeSession(sessionId: string, minutes: number) {
    validateMinutes(minutes);
    await delay(); const state = loadLocal();
    if (state.paused) throw new Error('相关训练已暂停，请勿继续本次任务。');
    const plan = state.current_plan; if (!plan || plan.status !== 'confirmed') throw new Error('请先确认本周计划。');
    if (!plan.sessions.some(s => s.id === sessionId)) throw new Error('训练任务不存在。');
    if (state.logs.some(x => x.session_id === sessionId)) return state;
    state.logs.push({ id: uid('log'), session_id: sessionId, plan_id: plan.id, plan_version: plan.version, completed_at: now(), actual_minutes: minutes, status: minutes > 0 ? 'completed' : 'skipped', feedback_submitted: false });
    plan.sessions.find(s => s.id === sessionId)!.status = minutes > 0 ? 'completed' : 'skipped';
    const storedPlan = state.plans.find(p => p.id === plan.id);
    if (storedPlan) storedPlan.sessions.find(s => s.id === sessionId)!.status = minutes > 0 ? 'completed' : 'skipped';
    event(state, 'session_completed', sessionId); return saveLocal(state);
  }
  async feedback(sessionId: string, input: FeedbackInput) {
    await delay(); const state = loadLocal(); const log = state.logs.find(x => x.session_id === sessionId);
    if (!log) throw new Error('请先结束训练，独立保存完成事件。');
    if (state.reports.some(x => x.session_id === sessionId)) throw new Error('本次反馈已经提交，请查看原报告。');
    const plan = state.plans.find(x => x.id === log.plan_id); const session = plan?.sessions.find(s => s.id === sessionId);
    if (!plan || !session) throw new Error('原计划版本不存在。');
    if (!state.current_plan?.sessions.some(s => s.id === sessionId)) throw new Error('本次记录属于历史计划，不能自动调整当前训练安排。');
    const issue = input.main_issue || '暂时没有明确卡点';
    const pain = input.pain || hasPainSignal(`${input.main_issue} ${input.notes || ''}`);
    const short = input.main_issue === '时间不足' || log.actual_minutes < session.duration_minutes * .7;
    const high = input.difficulty >= 4;
    let proposed: Plan | null = null;
    let after = '下一次保留原计划，继续观察同类动作。';
    let reason = '单次记录尚不足以判断能力变化，保留计划比强行调整更合适。';
    if (pain) {
      pauseTasks(state);
      after = '相关攀爬任务已立即暂停；先停止带来不适的活动并寻求专业建议。'; reason = '不适信号优先于计划推进，系统不判断伤病原因或生成康复处方。';
    } else if ((short || high) && state.current_plan!.sessions.some(s => !state.logs.some(l => l.session_id === s.id))) {
      proposed = createPlan(state, short ? Math.max(20, Math.min(log.actual_minutes || 30, state.profile!.available_minutes)) : state.profile!.available_minutes);
      const generated = proposed.sessions;
      proposed.sessions = state.current_plan!.sessions.map((existing, index) => {
        const completed = state.logs.find(l => l.session_id === existing.id);
        if (completed) return { ...clone(existing), status: completed.status };
        return { ...clone(generated[Math.min(index, generated.length - 1)]), id: existing.id, day: existing.day };
      });
      proposed.summary = `已完成的训练事实保留，下一次未完成安排适配当前时间与状态。`;
      proposed.status = 'draft';
      const nextSession = proposed.sessions.find(s => !state.logs.some(l => l.session_id === s.id));
      after = short ? `下一次调整为 ${nextSession?.duration_minutes ?? state.profile!.available_minutes} 分钟，保留一个主题重点。` : '保留时间预算，下一次仅选择熟悉的容易线路继续观察。';
      reason = short ? '实际执行时间与原安排不同，先适配可用时间；这不代表能力下降。' : '你反馈本次难度偏高，先收窄任务范围，暂不增加训练强度。';
    }
    const report: Report = {
      id: uid('report'), session_id: sessionId, log_id: log.id, created_at: now(), provider: 'demo_rules',
      observations: [`本次训练独立记录 ${log.actual_minutes} 分钟。`, `完成情况：${input.completed ? '完成主要内容' : '部分完成或跳过'}；主观难度 ${input.difficulty}/5。`, `主要卡点：${issue}。`, ...(input.notes?.trim() ? [`你补充：${input.notes.trim()}`] : [])],
      hypotheses: pain ? ['现有信息不能判断不适的医学原因。'] : [short ? '本次未完成可能与可用时间有关，不能直接推断训练能力。' : high ? '任务范围与当前体验可能不匹配，仍需后续记录验证。' : '目前没有足够证据说明能力已经提高或下降。'],
      summary: pain ? '先暂停，照顾今天的状态。' : short ? '调整时间，让下一次更容易执行。' : high ? '收窄任务，保留一次清晰观察。' : '保持节奏，把这次观察带到下一次。',
      before: `${session.title}，${session.duration_minutes} 分钟。`, after, citations: plan.citations,
      adjustment: { id: uid('adjustment'), status: 'pending', reason, changes: [after], base_plan_version: currentVersion(state), proposed_plan: proposed },
    };
    log.feedback_submitted = true; state.reports.push(report);
    if (state.profile && !pain && input.main_issue !== '暂无明显卡点') {
      const updated = clone(state.profile); updated.version++; updated.created_at = now();
      const dimension = updated.dimensions.find(x => x.key === updated.focus);
      if (dimension) { dimension.observation = `最新记录提到「${issue}」；实际训练 ${log.actual_minutes} 分钟。`; dimension.evidence_ids = [log.id]; dimension.evidence_level = '单次记录'; dimension.hypothesis = short ? '当前首先需要验证时间是否足够，不推断能力下降。' : '这条观察需要在相似线路中再次验证。'; }
      state.profile = updated; state.profile_versions.push(clone(updated));
    }
    if (report.adjustment.proposed_plan) report.adjustment.proposed_plan.profile_version = state.profile?.version;
    report.adjustment.profile_version = state.profile?.version;
    event(state, 'feedback_submitted', sessionId); run(state, '反馈优化', ['读取独立完成事件', '不适与异常检查', '反馈归纳', '合并画像证据', '生成调整建议', '等待用户确认']);
    return saveLocal(state);
  }
  async decide(reportId: string, decision: 'accept' | 'keep', expectedVersion: number) {
    await delay(); const state = loadLocal(); const report = state.reports.find(x => x.id === reportId);
    if (!report) throw new Error('报告不存在。');
    if (report.adjustment.status !== 'pending') throw new Error('这条建议已处理。');
    if (currentVersion(state) !== expectedVersion || report.adjustment.base_plan_version !== expectedVersion) throw new Error('当前计划已经更新，这份旧报告不能覆盖新计划。请生成新计划。');
    if (decision === 'accept' && report.adjustment.profile_version !== state.profile?.version) throw new Error('档案或画像已经更新，这份建议已过期，请重新生成计划。');
    if (decision === 'accept' && report.adjustment.proposed_plan && report.adjustment.proposed_plan.profile_version !== state.profile?.version) throw new Error('档案或画像已经更新，这份调整建议已过期，请重新生成计划。');
    if (decision === 'accept' && report.adjustment.proposed_plan && !state.paused) {
      const proposal = report.adjustment.proposed_plan;
      proposal.sessions.forEach(s => { const completed = state.logs.find(l => l.session_id === s.id); if (completed) s.status = completed.status; });
      proposal.status = 'confirmed'; storePlan(state, proposal);
    }
    report.adjustment.status = decision === 'accept' ? 'accepted' : 'kept';
    event(state, decision === 'accept' ? 'adjustment_accepted' : 'adjustment_rejected', report.session_id); event(state, 'next_step_confirmed', report.session_id);
    return saveLocal(state);
  }
  async correctProfile(dimensionKey: string, correction: string) {
    await delay(); const state = loadLocal(); if (!state.profile) throw new Error('请先建立档案。'); if (!correction.trim()) throw new Error('请补充你希望纠正的信息。');
    const profile = clone(state.profile); const dimension = profile.dimensions.find(x => x.key === dimensionKey); if (!dimension) throw new Error('画像维度不存在。');
    profile.version++; profile.created_at = now(); dimension.correction = correction.trim(); dimension.observation = `用户纠正：${correction.trim()}`; dimension.evidence_ids = [`profile-v${profile.version}-correction`]; dimension.evidence_level = '用户纠正'; dimension.hypothesis = '先保留你的纠正，不再沿用此前未经确认的判断。';
    state.profile = profile; state.profile_versions.push(clone(profile)); event(state, 'profile_corrected'); return saveLocal(state);
  }
  async ask(question: string) {
    await delay(); const state = loadLocal(); const q = question.trim(); if (!q) throw new Error('请输入一个问题。');
    let answer = '当前示例知识库没有足够资料回答这个问题。你可以问脚点观察、读线、时间安排或如何记录训练；我不会编造库外知识。'; let citations: Citation[] = []; let insufficient = true;
    if (/疼|痛|受伤|伤病|诊断|康复|手指肿|骨折/.test(q)) answer = '现有资料不能判断伤病或不适原因，也不能生成康复处方。如果出现疼痛，请停止引发不适的活动，并向专业人员咨询；你可以在训练反馈中记录不适，相关任务会立即暂停。';
    else if (/脚|踩|滑落/.test(q)) { answer = '先把“脚点滑落”变成一条可观察的记录：在熟悉的容易线路里，记下滑落发生在哪个动作、是否只出现在更困难的线路。当前信息不能证明你的脚法或力量不足。下一次计划可保留脚点观察主题，再比较记录。'; citations = [knowledgeSources[0]]; insufficient = false; }
    else if (/读线|路线|动作顺序/.test(q)) { answer = '可以先在上墙前描述自己准备采用的动作顺序，下墙后记一个与预想不同的动作。重点是比较“计划与实际”，不要求一开始就找出最佳动作。请选择熟悉的容易线路，这只是示例观察练习。'; citations = [knowledgeSources[1]]; insufficient = false; }
    else if (/时间|安排|计划|记录|反馈|为什么|练什么|恢复|休息/.test(q)) { answer = `这份计划先适配你能执行的时间${state.profile ? `（目前每次 ${state.profile.available_minutes} 分钟）` : ''}，每次保留一个主题重点。结束训练会先独立保存完成事件，反馈可以稍后补充；单次未完成不会直接判定能力下降。训练中允许休息或减少内容，出现不适应停止相关活动。`; citations = [knowledgeSources[2]]; insufficient = false; }
    else if (/身体|协调|重心|平衡/.test(q)) { answer = '先在熟悉线路里观察失去平衡发生在哪个动作，并记录身体位置变化。单次困难尝试不能证明力量或协调能力不足；这份画像不会生成没有测量依据的能力分数。'; citations = [knowledgeSources[3]]; insufficient = false; }
    const result: Answer = { id: uid('answer'), question: q, answer, citations, provider: 'demo_rules', insufficient_evidence: insufficient, run_id: uid('run'), created_at: now() };
    state.answers.push(result); run(state, '知识问答', ['问题范围检查', '示例关键词检索', insufficient ? '资料不足说明' : '来源绑定与回答']); event(state, 'knowledge_answer_viewed'); saveLocal(state); return result;
  }
  async exportData() { return { exported_at: now(), mode: 'demo_rules', session_id: sessionId(), data: loadLocal() }; }
  async clearData() { localStorage.removeItem(stateKey()); return emptyState(); }
  async loadDemo() {
    const state = emptyState(); applyProfile(state, { ...defaultProfile, nickname: '小林', gym: '示例岩馆', grade: 'V1–V2', goal: '每周到馆两次，记录脚点滑落发生的动作', adult_confirmed: true });
    const plan = createPlan(state); plan.status = 'confirmed'; storePlan(state, plan); event(state, 'plan_confirmed'); saveLocal(state);
    await this.completeSession(plan.sessions[0].id, 30);
    await this.feedback(plan.sessions[0].id, { difficulty: 3, completed: false, main_issue: '时间不足', notes: '模拟案例：只有半小时，困难线路脚点滑落，容易线路没有这个问题。', pain: false });
    const loaded = loadLocal(); loaded.logs.forEach(x => { x.sample = true; }); return saveLocal(loaded);
  }
}

export class ApiProvider implements Provider {
  constructor(private url: string) {}
  private async request(path: string, method = 'GET', body?: unknown) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(`${this.url.replace(/\/$/, '')}${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Session-ID': sessionId() }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : result.error || `服务请求失败（${response.status}）`);
      return result;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw new Error('服务响应超时。已保存的计划不会被覆盖，请稍后重试。');
      if (error instanceof TypeError) throw new Error('无法连接后端，请检查服务地址、网络和跨域设置。');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  async getState() { return normalize(await this.request('/api/state')); }
  async saveProfile(profile: ProfileInput) {
    const { nickname, experience_months, grade, grade_system, gym, sessions_per_week, available_minutes, equipment, goal, focus, recent_pain, adult_confirmed } = profile;
    return normalize(await this.request('/api/profile', 'POST', { nickname, experience_months, grade, grade_system, gym, sessions_per_week, available_minutes, equipment, goal, focus, recent_pain, adult_confirmed }));
  }
  async generatePlan() { return normalize(await this.request('/api/plans/generate', 'POST', {})); }
  async confirmPlan(version: number) { return normalize(await this.request('/api/plans/confirm', 'POST', { expected_version: version })); }
  async completeSession(sessionId: string, minutes: number) { validateMinutes(minutes); return normalize(await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/complete`, 'POST', { actual_minutes: minutes })); }
  async feedback(sessionId: string, input: FeedbackInput) { return normalize(await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/feedback`, 'POST', input)); }
  async decide(reportId: string, decision: 'accept' | 'keep', expectedVersion: number) { return normalize(await this.request(`/api/reports/${encodeURIComponent(reportId)}/${decision}`, 'POST', { expected_version: expectedVersion })); }
  async correctProfile(dimensionKey: string, correction: string) { return normalize(await this.request('/api/profile/correct', 'POST', { dimension_key: dimensionKey, correction })); }
  async ask(question: string): Promise<Answer> { return this.request('/api/knowledge/ask', 'POST', { question }); }
  async exportData() { return this.request('/api/export'); }
  async clearData() { return normalize(await this.request('/api/data', 'DELETE')); }
  async loadDemo(): Promise<AppState> { throw new Error('API 模式不写入模拟样例。请切回演示模式后体验。'); }
}
export function makeProvider(mode: 'demo' | 'api', url: string): Provider { return mode === 'api' ? new ApiProvider(url) : new LocalProvider(); }
