import { load, current, command, notify, toast, confirm, id, resultLabels } from '../../services/store';
import { projectHistory, projectSummaries } from '../../../shared/projects';

Page({
  projectId: '', requestId: id(),
  data: { loading: true, error: '', project: null as any, history: [] as any[], formOpen: false, busy: false,
    form: { routeLabel: '', gradeLabel: '', notes: '' } },
  onLoad(query: Record<string, string>) { this.projectId = query.id || ''; },
  async onShow() { await this.reload(); },
  async reload() {
    this.setData({ loading: true, error: '' });
    try { const state = await load(); const project = projectSummaries(state).find(p => p._id === this.projectId);
      if (!project) throw new Error('这条线路项目不存在或已删除，原有训练和视频仍保留。');
      const history = projectHistory(state, this.projectId).map(h => ({ ...h,
        attempts: h.attempts.map(a => ({ ...a, resultLabel: resultLabels[a.result] })) }));
      this.setData({ project, history });
    } catch (e) { this.setData({ error: (e as Error).message, project: null }); }
    finally { this.setData({ loading: false }); }
  },
  edit() { const p = this.data.project; if (!p) return; this.requestId = id();
    this.setData({ formOpen: true, form: { routeLabel: p.routeLabel, gradeLabel: p.gradeLabel, notes: p.notes } },
    () => wx.pageScrollTo({ selector: '#project-edit', duration: 250 })); },
  close() { if (!this.data.busy) this.setData({ formOpen: false }); },
  field(e: any) { this.requestId = id(); this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  async save() {
    if (this.data.busy || !this.data.project) return; this.setData({ busy: true });
    try { await command('project.save', { ...this.data.form, id: this.projectId, gymId: this.data.project.gymId }, this.requestId);
      this.setData({ formOpen: false }); await this.reload(); toast('项目已更新');
    } catch (e) { notify(e); } finally { this.setData({ busy: false }); }
  },
  async status() {
    if (this.data.busy) return;
    try { const choice = await wx.showActionSheet({ itemList: ['下次继续', '标为已完成', '归档这条线'] });
      const status = ['active', 'completed', 'archived'][choice.tapIndex]; if (!status) return;
      this.setData({ busy: true }); await command('project.status', { id: this.projectId, status }); await this.reload(); toast('状态已更新');
    } catch (e) { notify(e); } finally { this.setData({ busy: false }); }
  },
  async record() {
    const project = this.data.project; if (!project || project.status === 'archived') return;
    try {
      const sessions = current().sessions.filter(s => s.gymId === project.gymId)
        .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate) || b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
      const gym = current().gyms.find(g => g._id === project.gymId);
      if (gym?.archivedAt) { toast('请先到我的岩馆恢复这家岩馆'); return; }
      const choice = await wx.showActionSheet({ itemList: ['新建一次训练', ...sessions.map(s => s.sessionDate + ' · ' + (s.trainingNotes.slice(0, 12) || '已有训练'))] });
      if (choice.tapIndex === 0) wx.navigateTo({ url: '/pages/session-edit/index?gymId=' + project.gymId + '&projectId=' + project._id });
      else { const session = sessions[choice.tapIndex - 1]; if (session) wx.navigateTo({ url: '/pages/session-detail/index?id=' + session._id + '&projectId=' + project._id }); }
    } catch (e) { notify(e); }
  },
  openSession(e: any) { wx.navigateTo({ url: '/pages/session-detail/index?id=' + e.currentTarget.dataset.id }); },
  videos() { wx.navigateTo({ url: '/pages/videos/index?projectId=' + this.projectId }); },
  async remove() {
    if (this.data.busy) return;
    try { if (!(await confirm('删除这条线路项目？', '项目名称和卡点笔记将删除。原有训练、尝试和视频保留，并解除项目关联；此操作无法撤销。', '删除项目'))) return;
      this.setData({ busy: true }); await command('project.delete', { id: this.projectId }); toast('项目已删除'); wx.navigateBack();
    } catch (e) { notify(e); } finally { this.setData({ busy: false }); }
  },
});
