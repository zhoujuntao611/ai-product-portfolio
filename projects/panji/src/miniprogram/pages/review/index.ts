import { load, current, command, caps, notify, toast, confirm, consent, today, id, processReview, mode, configured } from '../../services/store';
import { shiftDate, reviewInput, PRIVACY_VERSION } from '../../../shared/domain';
Page({
  timer: 0 as ReturnType<typeof setTimeout> | 0, startedAt: 0, requestId: id(), goalRequestId: id(),
  processing: false, visible: false,
  data: { loading: true, error: '', busy: false, from: shiftDate(today(), -27), to: today(), today: today(), mode: 'rule',
    includeNotes: false, preview: null as any, capabilities: caps(), reviews: [] as any[], goals: [] as any[], manual: '',
    goalText: '', goalReason: '', goalReviewId: '', goalEditor: false, showPreview: false, local: true, cloudConfigured: false, busyGoal: false, waiting: false, timeoutHint: false, feedback: '', feedbackId: '' },
  onLoad(q: Record<string, string>) { if (q.from && q.to) this.setData({ from: q.from, to: q.to });
    if (q.sessionId) { this.setData({ from: today(), to: today() }); (this as any).sourceSessionId = q.sessionId; }
    if (['rule', 'manual', 'ai'].includes(q.mode)) this.setData({ mode: q.mode });
    this.requestId = id(); this.processing = false; this.startedAt = 0;
  },
  async onShow() { this.visible = true; await this.reload(); },
  onHide() { this.visible = false; if (this.timer) clearTimeout(this.timer); this.timer = 0; },
  onUnload() { this.visible = false; if (this.timer) clearTimeout(this.timer); this.timer = 0; },
  async reload() {
    this.setData({ loading: true, error: '' });
    try {
      await load();
      if ((this as any).sourceSessionId) {
        const s = current().sessions.find(s => s._id === (this as any).sourceSessionId);
        if (s) this.setData({ from: s.sessionDate, to: s.sessionDate }); delete (this as any).sourceSessionId;
      }
      this.refresh(); this.preview();
    } catch (e) { this.setData({ error: (e as Error).message }); } finally { this.setData({ loading: false }); }
  },
  refresh() {
    const s = current();
    const labels: Record<string, string> = { queued: '排队中', running: '正在生成', ready: '可回顾', failed: '生成未完成', stale: '来源已变更' };
    const errors: Record<string, string> = { AI_FREE_QUOTA: '免费 AI 额度暂不可用', AI_FREE_PLAN_REQUIRED: '免费服务条件尚未满足',
      AI_INPUT_TOO_LARGE: '这段训练内容较多，请缩小日期范围', AI_INVALID_OUTPUT: '复盘未通过内容校验', AI_TIMEOUT: '生成超时',
      AI_UPSTREAM_ERROR: '模型服务暂时未能完成请求' };
    this.setData({ capabilities: caps(), local: mode() === 'local', cloudConfigured: configured(),
      reviews: [...s.reviews].reverse().map(r => ({ ...r, errorMessage: r.errorMessage || errors[r.errorCode || ''] || '生成未完成，请稍后再试', modeLabel: r.mode === 'ai' ? 'AI 复盘 · 实验' : r.mode === 'manual' ? '手写复盘' : '数据摘要', statusLabel: labels[r.status],
        observations: r.output?.observations.map(o => ({ text: o.text, evidence: o.evidenceIds.map(id => ({ id, label: s.sessions.find(x => x._id === id)?.sessionDate || '原记录' })) })) || [] })),
      goals: [...s.goals].reverse().map(g => ({ ...g, statusLabel: ({ active: '下次核对', completed: '已完成', skipped: '未完成', cancelled: '已取消' } as Record<string, string>)[g.status] })),
      waiting: s.reviews.some(r => r.status === 'queued' || r.status === 'running') });
    if (this.data.waiting && !this.timer) this.poll();
    const queued = s.reviews.find(r => r.mode === 'ai' && (r.status === 'queued' || (r.status === 'running' && (r.leaseUntil || '') < new Date().toISOString())));
    if (queued && !this.processing && this.visible && caps().aiAvailable) {
      this.processing = true;
      void processReview(queued._id).catch(() => { this.setData({ timeoutHint: true }); }).finally(async () => {
        this.processing = false;
        if (this.visible) { try { await load(); this.refresh(); } catch { this.setData({ timeoutHint: true }); } }
      });
    }
  },
  preview() {
    try {
      if (this.data.from > this.data.to) throw new Error('开始日期不能晚于结束日期');
      const p = reviewInput(current(), this.data.from, this.data.to, this.data.includeNotes);
      this.setData({ preview: p, error: '' });
    } catch (e) { this.setData({ preview: null, error: (e as Error).message }); }
  },
  date(e: any) { this.requestId = id(); this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); this.preview(); },
  selectMode(e: any) { this.requestId = id(); this.setData({ mode: e.currentTarget.dataset.value }); },
  toggleNotes(e: any) { this.requestId = id(); this.setData({ includeNotes: !!e.detail.value, showPreview: !!e.detail.value || this.data.showPreview }); this.preview(); },
  togglePreview() { this.setData({ showPreview: !this.data.showPreview }); },
  newGoal() { this.goalRequestId = id(); this.setData({ goalEditor: true, goalReviewId: '', goalText: '', goalReason: '' }); wx.pageScrollTo({ scrollTop: 0, duration: 250 }); },
  closeGoal() { this.setData({ goalEditor: false, goalText: '', goalReviewId: '', goalReason: '' }); },
  recordSettings() { wx.switchTab({ url: '/pages/mine/index' }); },
  manual(e: any) { this.requestId = id(); this.setData({ manual: e.detail.value }); },
  async create() {
    if (this.data.busy || !this.data.preview) return;
    this.setData({ busy: true });
    try {
      if (this.data.mode === 'ai') {
        if (!caps().aiAvailable) throw new Error('AI 服务尚未配置。可以先使用数据摘要或手写复盘。');
        const c = caps();
        if (!(await confirm('确认发送这些训练数据？', `服务方：${c.provider}；模型：${c.model}。将发送上方预览中的去标识训练数据${this.data.includeNotes ? '、备注和目标反馈' : '，不含备注和目标反馈'}，不发送视频、微信身份、岩馆名称。用于生成文本复盘。服务方的数据处理说明：${c.privacyUrl}；留存说明：${c.retention}。可在“我的”撤回后续调用授权。`, '同意生成'))) return;
        if (current().consent.aiVersion !== PRIVACY_VERSION) await consent(true, true);
      }
      await command('review.create', { from: this.data.from, to: this.data.to, mode: this.data.mode, includeNotes: this.data.includeNotes, summary: this.data.manual }, this.requestId);
      this.requestId = id(); this.startedAt = Date.now(); this.setData({ timeoutHint: false }); this.refresh(); toast(this.data.mode === 'ai' ? '复盘任务已提交' : '复盘已保存');
    } catch (e) { notify(e); } finally { this.setData({ busy: false }); }
  },
  poll() {
    if (!this.startedAt) this.startedAt = Date.now();
    if (Date.now() - this.startedAt > 60000) { this.setData({ timeoutHint: true }); return; }
    this.timer = setTimeout(async () => { this.timer = 0;
      try { await load(); this.refresh(); } catch { this.setData({ timeoutHint: true }); }
    }, 3000);
  },
  async refreshJobs() { this.startedAt = Date.now(); this.setData({ timeoutHint: false }); await this.reload(); },
  source(e: any) { wx.navigateTo({ url: '/pages/session-detail/index?id=' + e.currentTarget.dataset.id }); },
  chooseGoal(e: any) { this.goalRequestId = id(); this.setData({ goalEditor: true, goalReviewId: e.currentTarget.dataset.review || '', goalText: e.currentTarget.dataset.text || '', goalReason: '' }); wx.pageScrollTo({ scrollTop: 0, duration: 250 }); },
  goalField(e: any) { this.goalRequestId = id(); this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  async saveGoal() {
    if (this.data.busyGoal) return; this.setData({ busyGoal: true });
    try { await command('goal.save', { text: this.data.goalText, reviewId: this.data.goalReviewId || null, userFeedback: this.data.goalReason }, this.goalRequestId);
      this.goalRequestId = id(); this.setData({ goalEditor: false, goalText: '', goalReviewId: '', goalReason: '' }); this.refresh(); toast('下次的小目标已保存'); }
    catch (e) { notify(e); } finally { this.setData({ busyGoal: false }); }
  },
  async cancelGoal(e: any) { try { if (!(await confirm('取消这个目标？', '目标会保留为已取消，便于回顾。'))) return; await command('goal.followup', { id: e.currentTarget.dataset.id, status: 'cancelled', userFeedback: '用户取消目标' }); this.refresh(); } catch (e) { notify(e); } },
  followup() { wx.showModal({ title: '用下一次训练核对', content: '打开一条目标建立当天或之后的训练，在“核对上次的小目标”中记录执行结果。', showCancel: false }); },
  async reject(e: any) {
    try { const r = await wx.showModal({ title: '记录不采纳的原因', editable: true, placeholderText: '哪里不适合你？', confirmText: '保存反馈' });
      if (!r.confirm) return; await command('review.feedback', { id: e.currentTarget.dataset.id, feedback: r.content || '暂不采纳' }); this.refresh(); toast('反馈已保存'); }
    catch (e) { notify(e); }
  },
  async remove(e: any) { try { if (!(await confirm('删除这次复盘？', '复盘内容和输入快照会删除，已经确认的目标保留。', '删除'))) return; await command('review.delete', { id: e.currentTarget.dataset.id }); this.refresh(); } catch (e) { notify(e); } },
});
