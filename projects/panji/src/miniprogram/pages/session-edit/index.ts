import { load, current, command, notify, toast, id, today, mode, confirm } from '../../services/store';
import { latestReusableSession, recentGyms, reuseSessionForm } from '../../../shared/quick-record';
Page({
  editId: '', queryProjectId: '', queryGymId: '', initialized: false, saved: false, requestId: id(), draftOwner: id('draft'),
  data: { loading: true, error: '', busy: false, today: today(), gyms: [] as any[], gymIndex: -1, gymName: '', edit: false, version: 0,
    form: { sessionDate: today(), gymId: '', durationMinutes: '', trainingNotes: '', feeling: '', perceivedEffort: '' }, recovered: false, showExtras: false,
    recentGyms: [] as any[], reuseSource: null as { date: string; gym: string } | null, reused: false, projectHint: '' },
  onLoad(query: Record<string, string>) { this.editId = query.id || ''; this.queryProjectId = query.projectId || ''; this.queryGymId = query.gymId || ''; this.setData({ edit: !!this.editId }); this.requestId = id(); this.draftOwner = id('draft'); },
  draftKey() { return `panji.draft.${mode()}.${this.editId || 'new'}`; },
  async onShow() {
    this.setData({ loading: true, error: '' });
    try {
      const state = await load();
      const old = this.editId ? state.sessions.find(s => s._id === this.editId) : null;
      if (this.editId && !old) throw new Error('这条训练不存在，请返回训练列表');
      const project = !this.editId ? (state.projects || []).find(p => p._id === this.queryProjectId && p.status !== 'archived' && p.gymId === this.queryGymId) : undefined;
      const gyms = state.gyms.filter(g => !g.archivedAt || g._id === old?.gymId).map(g => ({ ...g, displayName: g.name + (g.city ? ' · ' + g.city : '') + (g.archivedAt ? '（已归档）' : '') }));
      const recent = recentGyms(state, 3); const reusable = latestReusableSession(state);
      this.setData({ gyms, recentGyms: recent, reuseSource: reusable ? { date: reusable.sessionDate, gym: state.gyms.find(g => g._id === reusable.gymId)!.name } : null });
      const firstShow = !this.initialized;
      if (!this.initialized) {
        const draft = wx.getStorageSync(this.draftKey());
        if (draft && (!old || draft.version === old.version)) {
          this.setData({ form: draft.form, version: draft.version || 0, recovered: true });
          if (project && draft.form.gymId !== project.gymId) toast('已保留草稿，请确认项目岩馆');
        }
        else if (old) this.setData({ form: { sessionDate: old.sessionDate, gymId: old.gymId,
          durationMinutes: old.durationMinutes === null ? '' : String(old.durationMinutes), trainingNotes: old.trainingNotes, feeling: old.feeling,
          perceivedEffort: old.perceivedEffort === null ? '' : String(old.perceivedEffort) }, version: old.version });
        else if (gyms.length) this.setData({ 'form.gymId': (project && gyms.some(g => g._id === project.gymId) ? project.gymId : '') || recent[0]?._id || gyms[0]._id });
        this.setData({ showExtras: !!(this.data.form.feeling || this.data.form.perceivedEffort) });
        this.initialized = true;
      }
      const selected = wx.getStorageSync('panji.selectedGym');
      if (selected && gyms.some(g => g._id === selected)) { this.setData({ 'form.gymId': selected }); this.requestId=id(); wx.removeStorageSync('panji.selectedGym'); }
      this.updateGym();
      this.setData({ projectHint: project ? `保存后继续记录「${project.routeLabel}」；请使用 ${state.gyms.find(g => g._id === project.gymId)?.name || '项目所在岩馆'}。` : '' });
      if (!this.saved) { if (firstShow) this.writeDraft(); else this.keepDraft(); }
      if(wx.getStorageSync('panji.catalog.manual')){wx.removeStorageSync('panji.catalog.manual');wx.navigateTo({url:'/pages/gyms/index?select=1&new=1'});}
    } catch (e) { this.setData({ error: (e as Error).message }); }
    finally { this.setData({ loading: false }); }
  },
  onHide() { this.keepDraft(); }, onUnload() { this.keepDraft(); },
  writeDraft() { try {
    wx.setStorageSync(this.draftKey() + '.editor', this.draftOwner);
    wx.setStorageSync(this.draftKey(), { form: this.data.form, version: this.data.version, editor: this.draftOwner });
  } catch { /* Saving a real record reports errors separately. */ } },
  keepDraft() {
    if (this.saved || !this.initialized) return;
    // Older pages are unloaded after newer ones when leaving a navigation stack.
    // Keep ownership after a successful save too, so they cannot resurrect it.
    if (wx.getStorageSync(this.draftKey() + '.editor') !== this.draftOwner) return;
    this.writeDraft();
  },
  updateGym() { const index = this.data.gyms.findIndex(g => g._id === this.data.form.gymId); this.setData({ gymIndex: index, gymName: index >= 0 ? this.data.gyms[index].displayName : '' }); },
  field(e: any) { this.requestId = id(); this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value }); this.keepDraft(); },
  toggleExtras() { this.setData({ showExtras: !this.data.showExtras }); },
  pickDate(e: any) { this.requestId = id(); this.setData({ 'form.sessionDate': e.detail.value }); this.keepDraft(); },
  pickGym(e: any) { this.requestId = id(); this.setData({ 'form.gymId': this.data.gyms[Number(e.detail.value)]._id }); this.updateGym(); this.keepDraft(); },
  recentGym(e: any) {
    const gymId = e.currentTarget.dataset.id;
    if (!this.data.gyms.some(g => g._id === gymId && !g.archivedAt)) return;
    this.requestId = id(); this.setData({ 'form.gymId': gymId }); this.updateGym(); this.keepDraft();
  },
  async reuseLast() {
    if (this.editId || this.data.busy) return;
    // A stale editor must not replace the draft now owned by a newer page.
    if (wx.getStorageSync(this.draftKey() + '.editor') !== this.draftOwner) { toast('请返回最新打开的训练表单继续填写'); return; }
    const source = latestReusableSession(current()); if (!source) { toast('还没有可复用的训练'); return; }
    const form = this.data.form;
    if ((form.trainingNotes || form.durationMinutes || form.feeling || form.perceivedEffort || form.sessionDate !== today()
      || (form.gymId && form.gymId !== source.gymId))
      && !(await confirm('复用上次训练？', '将替换当前表单中的岩馆、时长和训练内容，日期设为今天，感受与强度留空。已保存的训练不会改变。', '复用'))) return;
    if (wx.getStorageSync(this.draftKey() + '.editor') !== this.draftOwner) return;
    this.requestId = id(); this.setData({ form: reuseSessionForm(source, today()), recovered: false, reused: true, showExtras: false });
    this.updateGym(); this.keepDraft(); toast('已带入上次内容，请按本次实际情况修改');
  },
  addGym() { wx.navigateTo({ url: '/pages/gyms/index?select=1' }); },
  catalog(){wx.navigateTo({url:'/pages/gym-picker/index'});},
  async save() {
    if (this.data.busy) return; this.setData({ busy: true });
    try {
      const f = this.data.form;
      if (!f.gymId) throw new Error('请先选择岩馆，再保存训练');
      const saved = await command('session.save', { ...f, id: this.editId || undefined, version: this.data.version,
        durationMinutes: f.durationMinutes.trim() === '' ? null : Number(f.durationMinutes), perceivedEffort: f.perceivedEffort.trim() === '' ? null : Number(f.perceivedEffort) }, this.requestId);
      this.saved = true;
      if (wx.getStorageSync(this.draftKey() + '.editor') === this.draftOwner) wx.removeStorageSync(this.draftKey());
      toast('这次攀迹已保存');
      const project = !this.editId ? (current().projects || []).find(p => p._id === this.queryProjectId && p.gymId === f.gymId && p.status !== 'archived') : undefined;
      wx.redirectTo({ url: '/pages/session-detail/index?id=' + saved._id + (project ? '&projectId=' + encodeURIComponent(project._id) : '') });
    } catch (e) { notify(e); } finally { this.setData({ busy: false }); }
  },
});
