import { load, current, today, notify } from '../../services/store';
import { stats, shiftDate } from '../../../shared/domain';
Page({
  data: { loading: true, error: '', from: shiftDate(today(), -27), to: today(), today: today(), gymIndex: 0,
    gyms: [{ _id: '', name: '所有岩馆' }] as any[], metrics: null as any, weeks: [] as any[], resultSegments: [] as any[], showMethod: false, showFilters: false, rateLabel: '—', period: 28 },
  async onShow() { await this.reload(); },
  async reload() {
    this.setData({ loading: true, error: '' });
    try { await load(); this.setData({ gyms: [{ _id: '', name: '所有岩馆' }, ...current().gyms] }); this.calculate(); }
    catch (e) { this.setData({ error: (e as Error).message }); } finally { this.setData({ loading: false }); }
  },
  calculate() {
    const { from, to, gymIndex, gyms } = this.data;
    if (from > to) { this.setData({ error: '开始日期不能晚于结束日期', metrics: null }); return; }
    if (Date.parse(to) - Date.parse(from) > 365 * 86400000) { this.setData({ error: '一次最多查看一年，请缩小日期范围', metrics: null }); return; }
    const metrics = stats(current(), from, to, gyms[gymIndex]?._id || '');
    const max = Math.max(1, ...metrics.weeks.map(w => w.sessions));
    this.setData({ error: '', metrics, rateLabel: metrics.completionRate === null ? '—' : metrics.completionRate + '%',
      resultSegments: [
        { kind: 'completed', label: '完成', count: metrics.completed },
        { kind: 'failed', label: '未完成', count: metrics.failed },
        { kind: 'unknown', label: '未知', count: metrics.unknown },
      ].map(s => ({ ...s, width: metrics.attempts ? s.count / metrics.attempts * 100 : 0 })),
      weeks: metrics.weeks.map(w => ({ ...w, label: `${Number(w.week.slice(5, 7))}/${Number(w.week.slice(8))}`, height: w.sessions ? Math.max(10, Math.round(w.sessions / max * 140)) : 3 })) });
  },
  range(e: any) { const period = Number(e.currentTarget.dataset.days); this.setData({ period, from: shiftDate(today(), 1 - period), to: today() }); this.calculate(); },
  date(e: any) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value, period: 0 }); this.calculate(); },
  gym(e: any) { this.setData({ gymIndex: Number(e.detail.value) }); this.calculate(); },
  method() { this.setData({ showMethod: !this.data.showMethod }); },
  toggleFilters() { this.setData({ showFilters: !this.data.showFilters }); },
  review() { wx.navigateTo({ url: `/pages/review/index?from=${this.data.from}&to=${this.data.to}` }); },
  record() { wx.switchTab({ url: '/pages/records/index' }); },
});
