import { load, current, mode, configured, caps, setMode, command, notify, toast, confirm, cleanupVideos } from '../../services/store';
import { releaseLabel } from '../../services/release';
import { exportData, VIDEO_QUOTA } from '../../../shared/domain';
Page({
  data: { releaseLabel, loading: true, error: '', local: true, cloudConfigured: false, busy: false, counts: { sessions: 0, videos: 0, reviews: 0 },
    usedLabel: '0', quotaLabel: '1024', usedPercent: 0, aiConsent: false, deleting: false, pending: 0, capabilities: caps() },
  async onShow() { await this.reload(); },
  async reload() {
    this.setData({ loading: true, error: '' });
    try {
      const s = await load(); const used = s.videos.reduce((n, v) => n + v.byteSize, 0);
      this.setData({ local: mode() === 'local', cloudConfigured: configured(), capabilities: caps(),
        counts: { sessions: s.sessions.length, videos: s.videos.filter(v => v.status === 'ready').length, reviews: s.reviews.length },
        usedLabel: (used / 1024 / 1024).toFixed(1), quotaLabel: String(VIDEO_QUOTA / 1024 / 1024), usedPercent: Math.min(100, Math.round(used / VIDEO_QUOTA * 100)),
        aiConsent: !!s.consent.aiAt, deleting: s.accountDeleting, pending: s.videos.filter(v => v.status !== 'ready').length });
    } catch (e) { this.setData({ error: (e as Error).message }); } finally { this.setData({ loading: false }); }
  },
  projects() { wx.navigateTo({url:'/pages/projects/index'}); },
  diagnostic() { const d=wx.getStorageSync('panji.videoImportDiagnostics.v1');wx.showModal({title:'当前版本与视频状态',content:releaseLabel+(d?'\n'+d.stage+' · '+(d.message||'成功'):'\n尚无视频导入记录'),showCancel:false}); },
  gyms() { wx.navigateTo({ url: '/pages/gyms/index' }); }, videos() { wx.navigateTo({ url: '/pages/videos/index' }); },
  review() { wx.navigateTo({ url: '/pages/review/index' }); }, privacy() { wx.navigateTo({ url: '/pages/privacy/index' }); },
  async switchMode() {
    if (this.data.busy) return;
    try {
      const next = this.data.local ? 'cloud' : 'local';
      if (next === 'cloud' && !configured()) { toast('云端记录尚未开通，当前可使用本机记录'); return; }
      if (!(await confirm(next === 'cloud' ? '开通云端记录？' : '切换到本机记录？', '本机与云端是两份独立记录，原数据保留。切换不会自动上传已有训练和视频；可以先导出备份。'))) return;
      this.setData({ busy: true }); await setMode(next); await this.reload(); toast('记录位置已切换');
    } catch (e) { notify(e); } finally { this.setData({ busy: false }); }
  },
  async revokeAi() {
    try { if (!(await confirm('撤回 AI 调用授权？', '撤回后停止新调用，排队任务会取消。已生成复盘可自行删除；已发送数据仍按服务方条款处理。', '撤回授权'))) return;
      await command('privacy.set', { ai: false }); await this.reload(); toast('已撤回后续调用授权'); } catch (e) { notify(e); }
  },
  async export() {
    try {
      await load(); const json = JSON.stringify(exportData(current()), null, 2);
      const choice = await wx.showActionSheet({ itemList: ['导出 JSON 文件', '复制 JSON 到剪贴板'] });
      if (choice.tapIndex === 1) { await wx.setClipboardData({ data: json }); return; }
      const filePath = `${wx.env.USER_DATA_PATH}/panji-export-${Date.now()}.json`;
      await new Promise<void>((resolve, reject) => wx.getFileSystemManager().writeFile({ filePath, data: json, encoding: 'utf8', success: () => resolve(), fail: reject }));
      try {
        if (!wx.shareFileMessage) throw new Error('当前微信版本不支持分享文件，请改用复制 JSON');
        await wx.shareFileMessage({ filePath, fileName: '攀迹-个人训练数据.json' });
      } finally { wx.getFileSystemManager().unlink({ filePath, fail: () => undefined }); }
    } catch (e) { notify(e); }
  },
  async clearData() {
    if (this.data.busy) return;
    try {
      if (!(await confirm('删除当前记录位置的全部数据？', `将删除${this.data.local ? '本机' : '云端'}的岩馆、训练、尝试、复盘、目标及视频副本。此操作不可撤销。建议先导出备份；相册原片不受影响。`, '继续'))) return;
      const check = await wx.showModal({ title: '输入“删除攀迹”确认', editable: true, placeholderText: '删除攀迹', confirmText: '永久删除', confirmColor: '#a34c36' });
      if (!check.confirm || check.content !== '删除攀迹') { toast('未删除数据'); return; }
      this.setData({ busy: true }); await command('account.delete', {});
      const storage = wx.getStorageInfoSync();
      for (const key of storage.keys.filter(k => k.startsWith(`panji.draft.${mode()}.`))) wx.removeStorageSync(key);
      await cleanupVideos(); await this.reload(); toast(this.data.deleting || this.data.pending ? '记录已清空，视频待重试清理' : '当前记录位置的数据已清空');
    } catch (e) { notify(e); } finally { this.setData({ busy: false }); await this.reload(); }
  },
  async cleanup() { try { await cleanupVideos(); await this.reload(); toast('已重试清理，结果以列表状态为准'); } catch (e) { notify(e); } },
  about() { wx.showModal({ title: '攀迹 · '+releaseLabel, content: '记录每一次向上。个人攀岩训练日志、视频回看、成长统计和可追溯复盘。当前为开发体验版本；AI 复盘需服务配置并通过评测后开放。', showCancel: false }); },
});
