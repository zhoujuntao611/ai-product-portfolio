import { Attempt, RouteProject, State } from './domain';

export const projectStatusLabels: Record<RouteProject['status'], string> = {
  active: '下次继续', completed: '已完成', archived: '已归档',
};

export function linkedProject(state: State, attempt: Attempt): RouteProject | undefined {
  const session = state.sessions.find(s => s._id === attempt.sessionId && s.ownerId === state.ownerId);
  return (state.projects || []).find(p => p._id === attempt.projectId && p.ownerId === state.ownerId && p.gymId === session?.gymId);
}

export function projectHistory(state: State, projectId: string) {
  const project = (state.projects || []).find(p => p._id === projectId && p.ownerId === state.ownerId);
  if (!project) return [];
  return state.sessions.filter(s => s.ownerId === state.ownerId && s.gymId === project.gymId).map(session => {
    const attempts = state.attempts.filter(a => a.ownerId === state.ownerId && a.sessionId === session._id && a.projectId === projectId)
      .sort((a, b) => a.ordinal - b.ordinal).map(a => ({ ...a,
        videoCount: state.videos.filter(v => v.ownerId === state.ownerId && v.status === 'ready' && v.sessionId === session._id && v.attemptId === a._id).length,
      }));
    return { sessionId: session._id, session, attempts, videoCount: attempts.reduce((n, a) => n + a.videoCount, 0) };
  }).filter(h => h.attempts.length).sort((a, b) => b.session.sessionDate.localeCompare(a.session.sessionDate) || b.session.createdAt.localeCompare(a.session.createdAt));
}

export function projectSummaries(state: State, gymId = '') {
  return (state.projects || []).filter(p => p.ownerId === state.ownerId && (!gymId || p.gymId === gymId)).map(project => {
    const history = projectHistory(state, project._id);
    const attempts = history.flatMap(h => h.attempts);
    return { ...project, gymName: state.gyms.find(g => g._id === project.gymId && g.ownerId === state.ownerId)?.name || '原岩馆',
      statusLabel: projectStatusLabels[project.status], sessionCount: history.length, attemptCount: attempts.length,
      completedCount: attempts.filter(a => a.result === 'completed').length,
      videoCount: history.reduce((n, h) => n + h.videoCount, 0), lastDate: history[0]?.session.sessionDate || '',
      lastNotes: history.flatMap(h => [...h.attempts].reverse()).find(a => a.notes)?.notes || '',
    };
  }).sort((a, b) => (b.lastDate || b.createdAt).localeCompare(a.lastDate || a.createdAt));
}
