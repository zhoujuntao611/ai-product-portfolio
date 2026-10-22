import type { Gym, Session, State } from './domain';

export interface SessionForm {
  sessionDate: string; gymId: string; durationMinutes: string;
  trainingNotes: string; feeling: string; perceivedEffort: string;
}

function newestSessions(state: State): Session[] {
  return state.sessions.map((session, index) => ({ session, index }))
    .sort((a, b) => b.session.sessionDate.localeCompare(a.session.sessionDate)
      || b.session.createdAt.localeCompare(a.session.createdAt) || b.index - a.index)
    .map(item => item.session);
}

/** Archived venues remain readable in history, but are not new-training defaults. */
export function recentGyms(state: State, limit = 4): Gym[] {
  const available = new Map(state.gyms.filter(gym => !gym.archivedAt).map(gym => [gym._id, gym]));
  const seen = new Set<string>(); const gyms: Gym[] = [];
  for (const session of newestSessions(state)) {
    const gym = available.get(session.gymId);
    if (gym && !seen.has(gym._id)) { seen.add(gym._id); gyms.push(gym); }
  }
  return gyms.slice(0, Math.max(0, limit));
}

export function latestReusableSession(state: State): Session | undefined {
  const available = new Set(state.gyms.filter(gym => !gym.archivedAt).map(gym => gym._id));
  return newestSessions(state).find(session => available.has(session.gymId));
}

/** Reusing a template must never present an old outcome as today's observation. */
export function reuseSessionForm(session: Session, today: string): SessionForm {
  return { sessionDate: today, gymId: session.gymId,
    durationMinutes: session.durationMinutes === null ? '' : String(session.durationMinutes),
    trainingNotes: session.trainingNotes, feeling: '', perceivedEffort: '' };
}

/** Keep original grade labels within one venue; do not imply cross-gym conversion. */
export function recentGrades(state: State, gymId: string, limit = 6): string[] {
  const sessions = newestSessions(state).filter(session => session.gymId === gymId);
  const result: string[] = []; const seen = new Set<string>();
  for (const session of sessions) {
    const attempts = state.attempts.map((attempt, index) => ({ attempt, index }))
      .filter(item => item.attempt.sessionId === session._id)
      .sort((a, b) => b.attempt.createdAt.localeCompare(a.attempt.createdAt) || b.index - a.index);
    for (const { attempt } of attempts) {
      const label = attempt.gradeLabel.trim();
      if (label && !seen.has(label)) { seen.add(label); result.push(label); }
    }
  }
  return result.slice(0, Math.max(0, limit));
}
