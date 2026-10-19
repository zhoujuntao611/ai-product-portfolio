export type Focus = 'footwork' | 'route_reading' | 'consistency' | 'body_position';
export type ProviderMode = 'demo' | 'api';
export type Page = 'today' | 'onboarding' | 'profile' | 'plan' | 'training' | 'report' | 'knowledge' | 'account';

export interface Citation { id: string; title: string; url?: string | null; summary: string; source_type?: string; source_title?: string; last_verified?: string; support_note?: string; applicability?: string; review_status?: string }
export interface Dimension { key: string; label: string; observation: string; hypothesis: string; evidence_ids: string[]; evidence_level: string; next_step: string; correction?: string }
export interface ProfileInput { nickname: string; experience_months: number; grade: string; grade_system: string; gym: string; sessions_per_week: number; available_minutes: number; equipment: string[]; goal: string; focus: Focus; recent_pain: boolean; adult_confirmed: boolean }
export interface Profile extends ProfileInput { version: number; created_at?: string; dimensions: Dimension[]; facts: string[]; missing_fields: string[]; constraints: string[] }
export interface Exercise { id: string; title: string; duration_minutes: number; steps: string[]; rationale: string; citation_ids: string[] }
export interface PlannedSession { id: string; day: string; title: string; focus: string; duration_minutes: number; status: string; exercises: Exercise[]; rationale: string; stop_condition: string }
export interface Plan { id: string; version: number; status: string; title: string; focus: string; goal: string; provider: string; summary: string; rationale: string; citations: Citation[]; sessions: PlannedSession[]; created_at?: string; profile_version?: number }
export interface TrainingLog { id: string; session_id: string; plan_id: string; plan_version?: number; completed_at: string; actual_minutes: number; status: string; feedback_submitted?: boolean; sample?: boolean }
export interface FeedbackInput { difficulty: number; completed: boolean; main_issue: string; pain: boolean; notes?: string; actual_minutes?: number }
export interface Report { id: string; session_id: string; log_id?: string; created_at?: string; observations: string[]; hypotheses: string[]; summary: string; provider: string; before: string; after: string; citations?: Citation[]; adjustment: { id: string; status: string; reason: string; changes: string[]; base_plan_version: number; profile_version?: number; proposed_plan?: Plan | null } }
export interface Answer { id?: string; question?: string; answer: string; citations: Citation[]; provider: string; insufficient_evidence: boolean; run_id?: string; created_at?: string }
export interface Run { id: string; workflow: string; provider: string; nodes: (string | { node: string; status: string; summary: string; duration_ms: number; tool_calls: unknown[] })[]; status: string; created_at: string; duration_ms?: number; model_calls?: number }
export interface AnalyticsEvent { id: string; type: string; created_at: string; session_id?: string; plan_version?: number }
export interface KnowledgeMeta { version: string; review_status: string; knowledge_count: number; exercise_count: number; retrieval?: string; reference_page_count?: number; index_warning?: string | null }
export interface AppState { profile: Profile | null; goal?: unknown; profile_versions: Profile[]; current_plan: Plan | null; current_plan_id: string | null; plans: Plan[]; sessions: PlannedSession[]; logs: TrainingLog[]; reports: Report[]; answers: Answer[]; runs: Run[]; paused: boolean; engine: string; knowledge_meta?: KnowledgeMeta; configuration_warning?: string; events?: AnalyticsEvent[] }
export interface Provider {
  getState(): Promise<AppState>;
  saveProfile(profile: ProfileInput): Promise<AppState>;
  generatePlan(): Promise<AppState>;
  confirmPlan(version: number): Promise<AppState>;
  completeSession(sessionId: string, minutes: number): Promise<AppState>;
  feedback(sessionId: string, input: FeedbackInput): Promise<AppState>;
  decide(reportId: string, decision: 'accept' | 'keep', expectedVersion: number): Promise<AppState>;
  correctProfile(dimensionKey: string, correction: string): Promise<AppState>;
  ask(question: string): Promise<Answer>;
  exportData(): Promise<unknown>;
  clearData(): Promise<AppState>;
  loadDemo(): Promise<AppState>;
}
