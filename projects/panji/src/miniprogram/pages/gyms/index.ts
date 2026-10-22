import { load, current, command, notify, toast, ensurePrivacy, id, confirm } from '../../services/store';
Page({
  selectMode: false,
  startNew:false,
  requestId: id(),
  data: { loading: true, error: '', gyms: [] as any[], formOpen: false, busy: false, editId: '', showArchived: false, form: { name: '', city: '', gradeSystem: 'V 等级', notes: '' } },
  onLoad(query: Record<string, string>) { this.selectMode = query.select === '1'; this.startNew=query.new==='1'; },
  async onShow() { await this.reload();
    if(this.data.error)return;
    const selected=wx.getStorageSync('panji.selectedGym');
    if(selected&&this.data.gyms.some(g=>g._id===selected)){if(this.selectMode){wx.navigateBack();return;}wx.removeStorageSync('panji.selectedGym');}
    if(wx.getStorageSync('panji.catalog.manual')){wx.removeStorageSync('panji.catalog.manual');this.startNew=true;}
    if(this.startNew){this.startNew=false;await this.add();}
  },
  catalog(){wx.navigateTo({url:'/pages/gym-picker/index'});},
  async reload() {
    this.setData({ loading: true, error: '' });
    try { await load(); this.refresh(); } catch (e) { this.setData({ error: (e as Error).message }); }
    finally { this.setData({ loading: false }); }
  },
  refresh() { this.setData({ gyms: current().gyms.filter(g => this.data.showArchived || !g.archivedAt) }); },
  toggleArchived() { this.setData({ showArchived: !this.data.showArchived }); this.refresh(); },
  async add() { try { if (!(await ensurePrivacy())) return; this.requestId = id(); this.setData({ formOpen: true, editId: '', form: { name: '', city: '', gradeSystem: 'V 等级', notes: '' } }); } catch (e) { notify(e); } },
  edit(e: any) { const g = current().gyms.find(g => g._id === e.currentTarget.dataset.id)!; this.requestId = id(); this.setData({ formOpen: true, editId: g._id, form: { name: g.name, city: g.city, gradeSystem: g.gradeSystem, notes: g.notes } }); },
  field(e: any) { this.requestId = id(); this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  grade(e: any) { this.requestId = id(); this.setData({ 'form.gradeSystem': e.currentTarget.dataset.value }); },
  close() { if (!this.data.busy) this.setData({ formOpen: false }); },
  async save() {
    if (this.data.busy) return; this.setData({ busy: true });
    try {
      const sameName = current().gyms.some(g => g.name.trim() === this.data.form.name.trim() && g._id !== this.data.editId);
      if (sameName && !(await confirm('已有同名岩馆', '仍可创建；建议填写城市，方便选择。', '继续保存'))) return;
      const value = await command('gym.save', { ...this.data.form, id: this.data.editId || undefined }, this.requestId);
      toast('岩馆已保存'); this.setData({ formOpen: false }); this.refresh();
      if (this.selectMode) { wx.setStorageSync('panji.selectedGym', value._id); wx.navigateBack(); }
    } catch (e) { notify(e); } finally { this.setData({ busy: false }); }
  },
  async archive(e: any) {
    const g = current().gyms.find(g => g._id === e.currentTarget.dataset.id)!;
    try {
      if (!(await confirm(g.archivedAt ? '恢复岩馆？' : '归档岩馆？', '历史训练和难度标签会保留。'))) return;
      await command('gym.archive', { id: g._id, archived: !g.archivedAt }); this.refresh();
    } catch (e) { notify(e); }
  },
});
