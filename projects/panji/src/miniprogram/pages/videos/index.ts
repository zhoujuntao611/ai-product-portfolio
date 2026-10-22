import { load, current, command, notify, toast, confirm, importVideo, videoUrl, cleanupVideos } from '../../services/store';
import { scopedReviewVideos, reviewMarkers, validateVideoMarker, videoTimeLabel, VIDEO_PLAYBACK_RATES, VIDEO_MARK_LIMIT } from '../../../shared/video-review';
import { linkedProject } from '../../../shared/projects';
import { VIDEO_LIMIT_LABEL } from '../../../shared/domain';

Page({
  sessionId: '', projectId: '', pageVisible: true, playbackGeneration: 0, pendingVideoId: '',
  data: { loading: true, error: '', videos: [] as any[], scoped: false, unlinkedOnly: false, uploading: false, progress: 0, uploadsAvailable: false, videoLimitLabel: VIDEO_LIMIT_LABEL,
    scopeLabel: '', importHint: '', playingId: '', playingUrl: '', currentTime: 0, currentTimeLabel: '00:00.0', playbackRate: 1,
    rates: [...VIDEO_PLAYBACK_RATES], markerVideoId: '', markerId: '', markerTime: '', markerNote: '', markerBusy: false,
    compareIds: [] as string[], compareOpen: false, comparing: false, compareItems: [] as any[],
    linkId: '', sessions: [] as any[], sessionIndex: 0, attemptIndex: 0, targets: [] as any[], busy: false },
  onLoad(q: Record<string, string>) {
    this.sessionId = q.sessionId || ''; this.projectId = q.projectId || ''; this.pendingVideoId = q.videoId || ''; this.pageVisible = true; this.playbackGeneration = 0;
    const scoped = !!(this.sessionId || this.projectId);
    this.setData({ scoped, unlinkedOnly: !scoped && q.unlinked === '1' });
  },
  async onShow() { this.pageVisible = true; if (!this.data.uploading) await this.reload(); },
  onHide() { this.pageVisible = false; this.pendingVideoId = ''; this.closePlayback(); },
  onUnload() { this.pageVisible = false; this.pendingVideoId = ''; this.closePlayback(); },
  closePlayback() { this.playbackGeneration++; this.setData({ playingId: '', playingUrl: '', markerVideoId: '', compareOpen: false, compareItems: [], comparing: false }); },
  playbackIsCurrent(generation: number, ids: string[]) {
    if (!this.pageVisible || generation !== this.playbackGeneration) return false;
    const state = current(), visible = new Set(this.data.videos.filter(v => v.status === 'ready').map(v => v._id));
    try {
      const ready = new Set(scopedReviewVideos(state, { sessionId: this.sessionId, projectId: this.projectId, unlinkedOnly: this.data.unlinkedOnly })
        .filter(v => v.status === 'ready').map(v => v._id));
      return ids.every(id => visible.has(id) && ready.has(id));
    } catch { return false; }
  },
  async reload() {
    let focusId = '';
    const generation = this.playbackGeneration;
    this.setData({ loading: true, error: '' });
    try {
      const s = await load();
      const scoped = scopedReviewVideos(s, { sessionId: this.sessionId, projectId: this.projectId, unlinkedOnly: this.data.unlinkedOnly });
      const readyIds = new Set(scoped.filter(v => v.status === 'ready').map(v => v._id));
      const compareIds = this.data.compareIds.filter(id => readyIds.has(id));
      const videos = scoped.map(v => ({ ...v, sizeLabel: (v.byteSize / 1024 / 1024).toFixed(1), durationLabel: videoTimeLabel(v.durationSec),
        dateLabel: v.createdAt.slice(0, 10), sessionLabel: s.sessions.find(x => x._id === v.sessionId)?.sessionDate || '待整理',
        attemptLabel: s.attempts.find(a => a._id === v.attemptId)?.routeLabel || '', marks: reviewMarkers(v),
        compareSelected: compareIds.includes(v._id), compareOrder: compareIds.indexOf(v._id) + 1,
        statusLabel: v.status === 'ready' ? '可回看' : v.status === 'deleting' ? '待清理' : '保存未完成' }));
      const project = (s.projects || []).find(p => p._id === this.projectId), projectAttempt = this.latestProjectAttempt();
      const importSession = s.sessions.find(x => x._id === projectAttempt?.sessionId);
      this.setData({ videos, compareIds, uploadsAvailable: true, scopeLabel: project?.routeLabel || '',
        importHint: this.projectId ? (importSession ? `新视频关联到 ${importSession.sessionDate} 最近一次线路尝试` : '先为这条线路记录一次尝试，再导入关联视频') : '',
        sessions: [...s.sessions].sort((a, b) => b.sessionDate.localeCompare(a.sessionDate)).map(x => ({ ...x, label: `${x.sessionDate} · ${x.gymSnapshot.name}` })) });
      if (this.data.playingId && !readyIds.has(this.data.playingId)) this.setData({ playingId: '', playingUrl: '', markerVideoId: '' });
      if (this.data.compareOpen && compareIds.length !== 2) this.setData({ compareOpen: false, compareItems: [] });
      if (this.pendingVideoId) {
        const requested = this.pendingVideoId; this.pendingVideoId = '';
        if (this.pageVisible && generation === this.playbackGeneration && readyIds.has(requested)) focusId = requested;
      }
    } catch (e) { this.setData({ error: (e as Error).message, videos: [], uploadsAvailable: false }); this.closePlayback(); }
    finally { this.setData({ loading: false }); }
    if (focusId) await this.play({ currentTarget: { dataset: { id: focusId, focus: true } } });
  },
  latestProjectAttempt() {
    if (!this.projectId) return undefined;
    const s = current();
    return s.attempts.filter(a => a.ownerId === s.ownerId && linkedProject(s, a)?._id === this.projectId && (!this.sessionId || a.sessionId === this.sessionId))
      .sort((a, b) => (s.sessions.find(x => x._id === b.sessionId)?.sessionDate || '').localeCompare(s.sessions.find(x => x._id === a.sessionId)?.sessionDate || '') || b.createdAt.localeCompare(a.createdAt))[0];
  },
  async add() { return this.import(false); },
  async addEdited() { return this.import(true); },
  async import(edit: boolean) {
    if (this.data.loading || this.data.error || !this.data.uploadsAvailable || this.data.uploading) return;
    const attempt = this.latestProjectAttempt();
    if (this.projectId && !attempt) { toast('先为这条线路记录一次尝试'); return; }
    this.setData({ uploading: true, progress: 0 });
    try { await importVideo(attempt?.sessionId || this.sessionId || null, attempt?._id || null, n => this.setData({ progress: n }), { edit }); await this.reload(); }
    catch (e) { notify(e, 'video'); } finally { this.setData({ uploading: false }); }
  },
  toggle() { if (this.sessionId || this.projectId) return; this.closePlayback(); this.setData({ unlinkedOnly: !this.data.unlinkedOnly, compareIds: [] }); this.reload(); },
  async play(e: any) {
    if (!this.pageVisible) return;
    const generation = ++this.playbackGeneration;
    this.setData({ comparing: false });
    try {
      const state = current(), v = scopedReviewVideos(state, { sessionId: this.sessionId, projectId: this.projectId, unlinkedOnly: this.data.unlinkedOnly })
        .find(v => v._id === e.currentTarget.dataset.id && v.status === 'ready' && this.data.videos.some(item => item._id === v._id));
      if (!v) throw new Error('这段视频不存在或已删除');
      const url = await videoUrl(v);
      if (!this.playbackIsCurrent(generation, [v._id])) return;
      this.setData({ playingId: v._id, playingUrl: url, currentTime: 0, currentTimeLabel: videoTimeLabel(0), playbackRate: 1,
        markerVideoId: '', compareOpen: false, compareItems: [] }, () => {
        if (e.currentTarget.dataset.focus && this.playbackIsCurrent(generation, [v._id])) wx.pageScrollTo({ selector: '#video-card-' + v._id, duration: 250 });
      });
    } catch (e) { if (this.pageVisible && generation === this.playbackGeneration) notify(e); }
  },
  playbackError(e: any) {
    if (e?.currentTarget?.dataset?.player === 'compare') this.setData({ compareOpen: false, compareItems: [] });
    else this.setData({ playingId: '', playingUrl: '', markerVideoId: '' });
    wx.showModal({ title: '暂时无法播放', content: '可以重新打开视频再试。如果仍然失败，请在相册转成兼容的 MP4 后重新导入；部分 HEVC/HDR 视频可能不兼容。', showCancel: false });
  },
  timeUpdate(e: any) {
    const value = Number(e.detail.currentTime);
    if (Number.isFinite(value) && value >= 0) this.setData({ currentTime: value, currentTimeLabel: videoTimeLabel(value) });
  },
  rate(e: any) {
    const value = Number(e.currentTarget.dataset.rate), slot = e.currentTarget.dataset.slot;
    if (!(VIDEO_PLAYBACK_RATES as readonly number[]).includes(value)) return;
    try {
      const context = wx.createVideoContext(slot === undefined ? 'panji-main-video' : `panji-compare-${slot}`, this);
      if (typeof context.playbackRate !== 'function') throw new Error('当前微信版本暂不支持慢放，请更新微信后再试');
      context.playbackRate(value);
      this.setData(slot === undefined ? { playbackRate: value } : { [`compareItems[${Number(slot)}].rate`]: value });
    } catch (e) { notify(e); }
  },
  addMarker() {
    const v = current().videos.find(v => v._id === this.data.playingId);
    if (!v || this.data.markerBusy) return;
    if ((v.marks || []).length >= VIDEO_MARK_LIMIT) { toast(`每段视频最多 ${VIDEO_MARK_LIMIT} 个标记`); return; }
    wx.createVideoContext('panji-main-video', this).pause();
    this.setData({ markerVideoId: v._id, markerId: '', markerTime: String(Math.min(v.durationSec, Math.round(this.data.currentTime * 10) / 10)), markerNote: '' });
  },
  editMarker(e: any) {
    const v = current().videos.find(v => v._id === this.data.playingId), mark = v?.marks?.find(m => m.id === e.currentTarget.dataset.id);
    if (!v || !mark || this.data.markerBusy) return;
    wx.createVideoContext('panji-main-video', this).pause();
    this.setData({ markerVideoId: v._id, markerId: mark.id, markerTime: String(mark.timeSec), markerNote: mark.note });
  },
  markerField(e: any) { const key = e.currentTarget.dataset.field; if (key === 'markerTime' || key === 'markerNote') this.setData({ [key]: e.detail.value }); },
  quickMarker(e: any) { this.setData({ markerNote: e.currentTarget.dataset.note }); },
  closeMarker() { if (!this.data.markerBusy) this.setData({ markerVideoId: '' }); },
  async saveMarker() {
    if (this.data.markerBusy) return; this.setData({ markerBusy: true });
    try {
      const v = current().videos.find(v => v._id === this.data.markerVideoId);
      if (!v) throw new Error('这段视频不存在或已删除');
      const mark = validateVideoMarker(v.durationSec, this.data.markerTime, this.data.markerNote);
      await command('video.mark', { id: v._id, markerId: this.data.markerId || undefined, ...mark });
      this.setData({ markerVideoId: '' }); await this.reload(); toast('关键片段已记下');
    } catch (e) { notify(e); } finally { this.setData({ markerBusy: false }); }
  },
  seekMarker(e: any) {
    const v = current().videos.find(v => v._id === this.data.playingId), mark = v?.marks?.find(m => m.id === e.currentTarget.dataset.id);
    if (!mark) return;
    const context = wx.createVideoContext('panji-main-video', this); context.pause(); context.seek(mark.timeSec);
    this.setData({ currentTime: mark.timeSec, currentTimeLabel: videoTimeLabel(mark.timeSec) });
  },
  async removeMarker(e: any) {
    if (this.data.markerBusy) return;
    if (!(await confirm('删除这个标记？', '只删除时间点和备注，视频会保留。', '删除标记'))) return;
    this.setData({ markerBusy: true });
    try { await command('video.unmark', { id: this.data.playingId, markerId: e.currentTarget.dataset.id }); await this.reload(); }
    catch (error) { notify(error); } finally { this.setData({ markerBusy: false }); }
  },
  toggleCompare(e: any) {
    const id = e.currentTarget.dataset.id, ids = [...this.data.compareIds], index = ids.indexOf(id);
    if (!this.data.videos.some(v => v._id === id && v.status === 'ready')) return;
    if (index >= 0) ids.splice(index, 1);
    else { if (ids.length === 2) { toast('已选两段，请先取消一段'); return; } ids.push(id); }
    this.playbackGeneration++;
    this.setData({ compareIds: ids, compareOpen: false, compareItems: [], comparing: false, videos: this.data.videos.map(v => ({ ...v, compareSelected: ids.includes(v._id), compareOrder: ids.indexOf(v._id) + 1 })) });
  },
  clearCompare() { this.playbackGeneration++; this.setData({ compareIds: [], compareOpen: false, compareItems: [], comparing: false, videos: this.data.videos.map(v => ({ ...v, compareSelected: false, compareOrder: 0 })) }); },
  async startCompare() {
    if (!this.pageVisible || this.data.compareIds.length !== 2 || this.data.comparing) return;
    const generation = ++this.playbackGeneration, selectedIds = [...this.data.compareIds];
    this.setData({ comparing: true });
    try {
      const compareItems = await Promise.all(selectedIds.map(async (id, slot) => {
        const v = current().videos.find(v => v._id === id && v.status === 'ready'), label = this.data.videos.find(v => v._id === id);
        if (!v || !label) throw new Error('选中的视频已变更，请重新选择');
        return { ...label, slot, url: await videoUrl(v), rate: 1 };
      }));
      if (!this.playbackIsCurrent(generation, selectedIds) || selectedIds.some((id, slot) => this.data.compareIds[slot] !== id)) return;
      this.setData({ compareItems, compareOpen: true, playingId: '', playingUrl: '', markerVideoId: '' }, () => wx.pageScrollTo({ selector: '#video-comparison', duration: 250 }));
    } catch (e) { if (this.pageVisible && generation === this.playbackGeneration) notify(e); }
    finally { if (generation === this.playbackGeneration) this.setData({ comparing: false }); }
  },
  seekCompare(e: any) {
    const slot = Number(e.currentTarget.dataset.slot), timeSec = Number(e.currentTarget.dataset.time), item = this.data.compareItems[slot];
    if (!item || !Number.isFinite(timeSec) || timeSec < 0 || timeSec > item.durationSec) return;
    const context = wx.createVideoContext(`panji-compare-${slot}`, this); context.pause(); context.seek(timeSec);
  },
  openLink(e: any) { if (!this.data.sessions.length) { toast('先记录一次训练，再关联视频'); return; } this.setData({ linkId: e.currentTarget.dataset.id, sessionIndex: 0, attemptIndex: 0 }); this.targets(); },
  targets() { const s = this.data.sessions[this.data.sessionIndex]; this.setData({ targets: [{ _id: '', routeLabel: '仅关联整次训练' }, ...current().attempts.filter(a => a.sessionId === s?._id)], attemptIndex: 0 }); },
  selectSession(e: any) { this.setData({ sessionIndex: Number(e.detail.value) }); this.targets(); },
  selectAttempt(e: any) { this.setData({ attemptIndex: Number(e.detail.value) }); },
  closeLink() { this.setData({ linkId: '' }); },
  async saveLink() {
    if (this.data.busy) return; this.setData({ busy: true });
    try { await command('video.link', { id: this.data.linkId, sessionId: this.data.sessions[this.data.sessionIndex]._id, attemptId: this.data.targets[this.data.attemptIndex]._id || null }); this.setData({ linkId: '' }); await this.reload(); toast('关联已更新'); }
    catch (e) { notify(e); } finally { this.setData({ busy: false }); }
  },
  async unlink(e: any) { try { await command('video.link', { id: e.currentTarget.dataset.id, sessionId: null }); await this.reload(); toast('已移到待整理'); } catch (e) { notify(e); } },
  async remove(e: any) {
    try {
      if (!(await confirm('删除这段视频？', '只删除攀迹保存的副本，不删除手机相册中的原视频。', '删除视频'))) return;
      this.closePlayback(); await command('video.delete', { id: e.currentTarget.dataset.id }); await cleanupVideos(); await this.reload();
    } catch (e) { notify(e); await this.reload(); }
  },
  async cleanup() { try { await cleanupVideos(); await this.reload(); toast('清理已执行；失败项可再次重试'); } catch (e) { notify(e); } },
});
