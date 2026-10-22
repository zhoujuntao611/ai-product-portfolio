import { load, current, command, notify, toast, ensurePrivacy, id } from '../../services/store';
import { projectSummaries } from '../../../shared/projects';

Page({
  requestId: id(), gymFilter: '', sessionId: '',
  data: { loading: true, error: '', projects: [] as any[], gyms: [] as any[], statuses: ['下次继续', '已完成', '已归档'],
    status: 'active', gymName: '全部岩馆', gymIndex: 0, formOpen: false, busy: false,
    form: { gymId: '', routeLabel: '', gradeLabel: '', notes: '' } },
  onLoad(query: Record<string, string>) { this.gymFilter = query.gymId || ''; this.sessionId = query.sessionId || ''; },
  async onShow() { await this.reload(); },
  async reload() {
    this.setData({ loading: true, error: '' });
    try { const state = await load();
      const gyms = state.gyms.filter(g => !g.archivedAt);
      const gymIndex = Math.max(0, gyms.findIndex(g => g._id === this.gymFilter));
      this.setData({ gyms, gymIndex, gymName: state.gyms.find(g => g._id === this.gymFilter)?.name || '全部岩馆' });
      this.refresh();
    } catch (e) { this.setData({ error: (e as Error).message }); }
    finally { this.setData({ loading: false }); }
  },
  refresh() { this.setData({ projects: projectSummaries(current(), this.gymFilter).filter(p => p.status === this.data.status) }); },
  filter(e: any) { this.setData({ status: e.currentTarget.dataset.status }); this.refresh(); },
  allGyms() { this.gymFilter = ''; this.setData({ gymName: '全部岩馆' }); this.refresh(); },
  async add() {
    try { if (!(await ensurePrivacy())) return;
      if (!this.data.gyms.length) { toast('请先添加常去的岩馆'); wx.navigateTo({ url: '/pages/gyms/index' }); return; }
      const gymIndex = Math.max(0, this.data.gyms.findIndex(g => g._id === this.gymFilter));
      this.requestId = id(); this.setData({ formOpen: true, gymIndex,
        form: { gymId: this.data.gyms[gymIndex]._id, routeLabel: '', gradeLabel: '', notes: '' } },
      () => wx.pageScrollTo({ selector: '#project-form', duration: 250 }));
    } catch (e) { notify(e); }
  },
  gym(e: any) { const index = Number(e.detail.value); const gym = this.data.gyms[index]; if (!gym) return;
    this.requestId = id(); this.setData({ gymIndex: index, 'form.gymId': gym._id }); },
  field(e: any) { this.requestId = id(); this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  close() { if (!this.data.busy) this.setData({ formOpen: false }); },
  async save() {
    if (this.data.busy) return; this.setData({ busy: true });
    try { const value = await command('project.save', { ...this.data.form }, this.requestId);
      this.setData({ formOpen: false, status: 'active' }); this.refresh(); toast('线路已加入项目');
      wx.navigateTo({ url: '/pages/project-detail/index?id=' + value._id });
    } catch (e) { notify(e); } finally { this.setData({ busy: false }); }
  },
  open(e: any) { wx.navigateTo({ url: '/pages/project-detail/index?id=' + e.currentTarget.dataset.id }); },
});
