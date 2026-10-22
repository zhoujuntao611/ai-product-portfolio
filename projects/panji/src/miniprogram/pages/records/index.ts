import { load, mode, today, ensurePrivacy, notify, current } from '../../services/store';
import { monday, stats, shiftDate } from '../../../shared/domain';
Page({
  data: { loading: true, error: '', local: true, sessions: [] as any[], goals: [] as any[], week: { sessions: 0, minutes: 0 }, days: [] as any[], total: 0, unlinked: 0, query: '', allSessions: [] as any[] },
  async onShow() { await this.reload(); },
  async reload() {
    this.setData({ loading: true, error: '' });
    try {
      const state = await load();
      const sessions = [...state.sessions].sort((a, b) => b.sessionDate.localeCompare(a.sessionDate) || b.createdAt.localeCompare(a.createdAt)).map(s => ({
        ...s, dateLabel: `${Number(s.sessionDate.slice(5, 7))} 月 ${Number(s.sessionDate.slice(8, 10))} 日`, yearLabel: s.sessionDate.slice(0, 4),
        attempts: state.attempts.filter(a => a.sessionId === s._id).length,
        completed: state.attempts.filter(a => a.sessionId === s._id && a.result === 'completed').length,
        videos: state.videos.filter(v => v.sessionId === s._id && v.status === 'ready').length,
      }));
      const start = monday(today());
      const days = ['一','二','三','四','五','六','日'].map((label, i) => {
        const date = shiftDate(start, i);
        return { date, label, count: sessions.filter(s => s.sessionDate === date).length, future: date > today(), today: date === today() };
      });
      const max = Math.max(1, ...days.map(d => d.count));
      this.setData({ allSessions: sessions, sessions, local: mode() === 'local', total: sessions.length,
        days: days.map(d => ({ ...d, height: d.count ? Math.max(10, Math.round(d.count / max * 60)) : 3 })),
        goals: state.goals.filter(g => g.status === 'active').slice(-2),
        week: stats(state, monday(today()), today()), unlinked: state.videos.filter(v => !v.sessionId && v.status === 'ready').length });
      this.filter();
    } catch (e) { this.setData({ error: (e as Error).message || '暂时无法读取记录' }); }
    finally { this.setData({ loading: false }); }
  },
  async add() { try { if (await ensurePrivacy()) wx.navigateTo({ url: '/pages/session-edit/index' }); } catch (e) { notify(e); } },
  open(e: any) { wx.navigateTo({ url: '/pages/session-detail/index?id=' + e.currentTarget.dataset.id }); },
  search(e: any) { this.setData({ query: e.detail.value }); this.filter(); },
  filter() { const q = this.data.query.trim().toLowerCase(); this.setData({ sessions: this.data.allSessions.filter(s => !q || `${s.gymSnapshot.name} ${s.trainingNotes} ${s.sessionDate}`.toLowerCase().includes(q)) }); },
  projects() { wx.navigateTo({url:'/pages/projects/index'}); },
  review() { wx.navigateTo({ url: '/pages/review/index' }); },
  videos() { wx.navigateTo({ url: '/pages/videos/index?unlinked=1' }); },
  mine() { wx.switchTab({ url: '/pages/mine/index' }); },
});
