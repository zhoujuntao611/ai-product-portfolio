import { load, current, command, notify, toast, confirm, importVideo, videoUrl, isCloud, id, resultLabels } from '../../services/store';
import { VIDEO_LIMIT_LABEL, Video } from '../../../shared/domain';
import { linkedProject } from '../../../shared/projects';
import { recentGrades } from '../../../shared/quick-record';

interface InlineClip { _id: string; playerId: string; url: string; loading: boolean; error: string; durationLabel: string }
function clipLabel(seconds: number): string {
  const whole = Math.floor(seconds); return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
function inlineClip(video: Video): InlineClip {
  const local = !isCloud() || !!video.localOnly;
  const url = local ? video.localPath || '' : '';
  return { _id: video._id, playerId: 'inline-video-' + video._id, url, loading: !local,
    error: local && !url ? '本机视频文件不可用，请从相册重新导入。' : '', durationLabel: clipLabel(video.durationSec) };
}
Page({
  sessionId: '', requestId: id(), requestedProjectId: '', pageVisible: false, reloadGeneration: 0, playingInlineId: '',
  data: { loading: true, error: '', session: null as any, attempts: [] as any[], videoCount: 0, goals: [] as any[],
    sessionClips: [] as InlineClip[], videoLimitLabel: VIDEO_LIMIT_LABEL,
    formOpen: false, attemptNotesOpen: false, editAttempt: '', busy: false, uploading: false, progress: 0,
    projectOptions: [{ _id: '', label: '不关联项目' }] as any[], projectIndex: 0, recentGrades: [] as string[],
    attempt: { routeLabel: '', gradeLabel: '', result: 'unknown', notes: '', projectId: '' } },
  onLoad(query: Record<string, string>) { this.sessionId = query.id || ''; this.requestedProjectId = query.projectId || ''; },
  async onShow() {
    this.pageVisible = true;
    if (this.data.uploading) return;
    await this.reload();
    if (!this.pageVisible) return;
    if (this.requestedProjectId && !this.data.error) { const projectId = this.requestedProjectId; this.requestedProjectId = '';
      const project = current().projects?.find(p => p._id === projectId && p.gymId === this.data.session?.gymId && p.status !== 'archived');
      if (project) { this.addAttempt(); this.applyProject(project._id); }
    }
  },
  onHide() { this.pageVisible = false; this.reloadGeneration++; this.pauseInlineVideos(); },
  onUnload() { this.pageVisible = false; this.reloadGeneration++; this.pauseInlineVideos(); },
  async reload() {
    const generation = ++this.reloadGeneration;
    this.pauseInlineVideos();
    this.setData({ loading: true, error: '' });
    try {
      const state = await load(); const session = state.sessions.find(s => s._id === this.sessionId);
      if (!this.pageVisible || generation !== this.reloadGeneration) return;
      if (!session) throw new Error('这条训练不存在或已删除');
      const ready = state.videos.filter(v => v.ownerId === state.ownerId && v.sessionId === this.sessionId && v.status === 'ready');
      const attempts = state.attempts.filter(a => a.ownerId === state.ownerId && a.sessionId === this.sessionId);
      const attemptIds = new Set(attempts.map(a => a._id));
      this.setData({ session,
        attempts: attempts.sort((a, b) => a.ordinal - b.ordinal).map(a => {
          const project = linkedProject(state, a);
          const clips = ready.filter(v => v.attemptId === a._id).map(inlineClip);
          return { ...a, linkedProjectId: project?._id || '', projectLabel: project?.routeLabel || '', resultLabel: resultLabels[a.result], videos: clips.length, clips };
        }), recentGrades: recentGrades(state, session.gymId, 6),
        videoCount: ready.length, sessionClips: ready.filter(v => !v.attemptId || !attemptIds.has(v.attemptId)).map(inlineClip),
        goals: state.goals.filter(g => g.status === 'active') });
      this.updateProjectOptions();
      for (const video of ready) if (isCloud() && !video.localOnly) void this.resolveInlineVideo(video, generation);
    } catch (e) { if (this.pageVisible && generation === this.reloadGeneration) this.setData({ error: (e as Error).message, session: null, attempts: [], sessionClips: [], videoCount: 0 }); }
    finally { if (this.pageVisible && generation === this.reloadGeneration) this.setData({ loading: false }); }
  },
  allInlineClips(): InlineClip[] { return [...this.data.attempts.flatMap((a: any) => a.clips || []), ...this.data.sessionClips]; },
  pauseInlineVideos(except = '') {
    for (const clip of this.allInlineClips()) {
      if (clip._id === except) continue;
      try { wx.createVideoContext(clip.playerId, this).pause(); } catch { /* A player may already have left the view. */ }
    }
    this.playingInlineId = except;
  },
  inlinePlay(e: any) {
    const videoId = e.currentTarget.dataset.id;
    if (!this.pageVisible || !this.allInlineClips().some(clip => clip._id === videoId && !!clip.url)) { this.pauseInlineVideos(); return; }
    this.pauseInlineVideos(videoId);
  },
  updateInlineClip(videoId: string, patch: Partial<InlineClip>) {
    const attempts = this.data.attempts.map((attempt: any) => ({ ...attempt, clips: (attempt.clips || []).map((clip: InlineClip) => clip._id === videoId ? { ...clip, ...patch } : clip) }));
    const sessionClips = this.data.sessionClips.map(clip => clip._id === videoId ? { ...clip, ...patch } : clip);
    this.setData({ attempts, sessionClips });
  },
  async resolveInlineVideo(video: Video, generation: number) {
    const isCurrent = () => this.pageVisible && generation === this.reloadGeneration && current().videos.some(v => v._id === video._id
      && v.status === 'ready' && v.sessionId === this.sessionId && v.attemptId === video.attemptId) && this.allInlineClips().some(clip => clip._id === video._id);
    try {
      const url = await videoUrl(video);
      if (!isCurrent()) return;
      this.updateInlineClip(video._id, { url, loading: false, error: url ? '' : '视频地址暂不可用，请重试。' });
    } catch { if (isCurrent()) this.updateInlineClip(video._id, { url: '', loading: false, error: '视频地址暂不可用，请重试。' }); }
  },
  inlineError(e: any) {
    if (!this.pageVisible) return;
    this.updateInlineClip(e.currentTarget.dataset.id, { url: '', loading: false, error: '暂时无法播放。请重试，或在相册转成 MP4 后重新导入。' });
  },
  edit() { wx.navigateTo({ url: '/pages/session-edit/index?id=' + this.sessionId }); },
  addAttempt() { this.requestId = id(); this.setData({ formOpen: true, attemptNotesOpen: false, editAttempt: '', attempt: { routeLabel: '', gradeLabel: '', result: 'unknown', notes: '', projectId: '' } }, () => wx.pageScrollTo({ selector: '#attempt-form', duration: 250 })); this.updateProjectOptions(); },
  editAttempt(e: any) { const a = current().attempts.find(a => a._id === e.currentTarget.dataset.id); if (!a) return;
    const project = linkedProject(current(), a); this.requestId = id(); this.setData({ formOpen: true, attemptNotesOpen: !!a.notes, editAttempt: a._id,
      attempt: { routeLabel: a.routeLabel, gradeLabel: a.gradeLabel, result: a.result, notes: a.notes, projectId: project?._id || '' } },
    () => wx.pageScrollTo({ selector: '#attempt-form', duration: 250 })); this.updateProjectOptions(); },
  updateProjectOptions() {
    const old = current().attempts.find(a => a._id === this.data.editAttempt);
    const projects = (current().projects || []).filter(p => p.ownerId === current().ownerId && p.gymId === this.data.session?.gymId
      && (p.status !== 'archived' || old?.projectId === p._id));
    if (this.data.attempt.projectId && !projects.some(p => p._id === this.data.attempt.projectId)) {
      this.requestId = id(); this.setData({ 'attempt.projectId': '' });
    }
    const options = [{ _id: '', label: '不关联项目' }, ...projects
      .map(p => ({ _id: p._id, label: p.routeLabel + (p.gradeLabel ? ' · ' + p.gradeLabel : '') + (p.status === 'archived' ? '（已归档）' : '') }))];
    const projectIndex = Math.max(0, options.findIndex(p => p._id === this.data.attempt.projectId)); this.setData({ projectOptions: options, projectIndex });
  },
  selectProject(e: any) { const project = this.data.projectOptions[Number(e.detail.value)]; if (project) this.applyProject(project._id); },
  applyProject(projectId: string) {
    const project = current().projects?.find(p => p._id === projectId && p.gymId === this.data.session?.gymId);
    this.requestId = id(); this.setData({ 'attempt.projectId': project?._id || '' });
    if (project && !this.data.editAttempt) this.setData({ 'attempt.routeLabel': project.routeLabel, 'attempt.gradeLabel': project.gradeLabel });
    this.updateProjectOptions();
  },
  async createProject() {
    if (this.data.busy || !this.data.session) return;
    if (!this.data.attempt.routeLabel.trim()) { toast('先填写线路标识，再加入项目'); return; }
    this.setData({ busy: true });
    try { const project = await command('project.save', { gymId: this.data.session.gymId,
      routeLabel: this.data.attempt.routeLabel, gradeLabel: this.data.attempt.gradeLabel, notes: '' });
      this.applyProject(project._id); toast('线路已建项目，保存尝试后关联');
    } catch (e) { notify(e); } finally { this.setData({ busy: false }); }
  },
  projects() { wx.navigateTo({ url: '/pages/projects/index?gymId=' + this.data.session.gymId }); },
  openProject(e: any) { wx.navigateTo({ url: '/pages/project-detail/index?id=' + e.currentTarget.dataset.id }); },
  grade(e: any) { this.requestId = id(); this.setData({ 'attempt.gradeLabel': e.currentTarget.dataset.value }); },
  toggleAttemptNotes() { this.setData({ attemptNotesOpen: !this.data.attemptNotesOpen }); },
  field(e: any) { this.requestId = id(); this.setData({ [`attempt.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  result(e: any) { this.requestId = id(); this.setData({ 'attempt.result': e.currentTarget.dataset.value }); },
  closeForm() { if (!this.data.busy) this.setData({ formOpen: false }); },
  async saveAttempt() { return this.persistAttempt(false); },
  async saveAndContinue() { return this.persistAttempt(true); },
  async persistAttempt(keepOpen: boolean) {
    if (this.data.busy) return; this.setData({ busy: true });
    try { const projectId = this.data.attempt.projectId;
      await command('attempt.save', { ...this.data.attempt, sessionId: this.sessionId, id: this.data.editAttempt || undefined }, this.requestId);
      this.setData({ formOpen: false }); await this.reload();
      if (keepOpen) { this.addAttempt(); if (current().projects?.some(p => p._id === projectId && p.status !== 'archived')) this.applyProject(projectId); }
      toast(keepOpen ? '已保存，继续下一条' : '尝试已记录'); }
    catch (e) { notify(e); } finally { this.setData({ busy: false }); }
  },
  async deleteAttempt(e: any) {
    try { if (!(await confirm('删除这次尝试？', '视频会保留在本次训练中；相关复盘将失效。', '删除'))) return;
      await command('attempt.delete', { id: e.currentTarget.dataset.id }); await this.reload(); } catch (e) { notify(e); }
  },
  videos(e?: any) {
    this.pauseInlineVideos();
    const videoId = e?.currentTarget?.dataset?.id;
    const focused = typeof videoId === 'string' && this.allInlineClips().some(clip => clip._id === videoId) ? videoId : '';
    wx.navigateTo({ url: '/pages/videos/index?sessionId=' + encodeURIComponent(this.sessionId) + (focused ? '&videoId=' + encodeURIComponent(focused) : '') });
  },
  async video(e: any) {
    if (this.data.uploading) return; this.pauseInlineVideos(); this.setData({ uploading: true, progress: 0 });
    try { await importVideo(this.sessionId, e.currentTarget.dataset.id || null, n => this.setData({ progress: n })); await this.reload(); }
    catch (e) { notify(e, 'video'); } finally { this.setData({ uploading: false }); }
  },
  review() { wx.navigateTo({ url: '/pages/review/index?sessionId=' + this.sessionId }); },
  async followup(e: any) {
    try {
      const chosen = await wx.showActionSheet({ itemList: ['本次做到了', '本次没有完成', '暂不核对'] });
      if (chosen.tapIndex === 2) return;
      const result = await wx.showModal({ title: '留下一句核对结果', editable: true, placeholderText: '做了什么？实际感受怎么样？', confirmText: '保存结果' });
      if (!result.confirm) return;
      await command('goal.followup', { id: e.currentTarget.dataset.id, status: chosen.tapIndex === 0 ? 'completed' : 'skipped', sessionId: this.sessionId, userFeedback: result.content || '' });
      await this.reload(); toast('目标已核对');
    } catch (e) { notify(e); }
  },
  async remove() {
    try {
      let deleteVideos = false;
      if (this.data.videoCount) {
        const choice = await wx.showActionSheet({ itemList: ['删除训练，保留视频到待整理', '训练和关联视频一起删除', '取消'] });
        if (choice.tapIndex === 2) return; deleteVideos = choice.tapIndex === 1;
      }
      if (!(await confirm('确认删除这次训练？', `训练和尝试记录将删除，引用它的复盘内容会清除。${deleteVideos ? '关联视频也将删除。' : '视频原文件保留。'}`, '确认删除'))) return;
      await command('session.delete', { id: this.sessionId, version: this.data.session.version, deleteVideos });
      if (deleteVideos) { const { cleanupVideos } = await import('../../services/store'); await cleanupVideos(); }
      toast('训练已删除'); wx.switchTab({ url: '/pages/records/index' });
    } catch (e) { notify(e); }
  },
});
