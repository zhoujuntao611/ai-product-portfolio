import { State, emptyState, ensure, Base } from '../../src/shared/domain';

export const collections = {
  gyms: 'pj_gyms', sessions: 'pj_sessions', attempts: 'pj_attempts',
  videos: 'pj_videos', reviews: 'pj_reviews', goals: 'pj_goals',
} as const;
type EntityKey = keyof typeof collections;
const keys = Object.keys(collections) as EntityKey[];
export const accountCollection = 'pj_accounts';
export function missingDocument(e: any): boolean {
  const message = [e?.errMsg, e?.message, e?.code].filter(Boolean).join(' ');
  if (/DATABASE_COLLECTION_NOT_EXIST|Db or Table not exist|collection.*(?:not exist|does not exist)/i.test(message)) return false;
  return /document.*(?:not exist|does not exist)|DATABASE_DOCUMENT_NOT_EXIST|DOCUMENT_NOT_FOUND/i.test(message);
}
async function getMeta(db: any, ownerId: string): Promise<any | null> {
  try { const r = await db.collection(accountCollection).doc(ownerId).get(); return r.data || null; }
  catch (e) { if (missingDocument(e)) return null; throw e; }
}
export class Repository {
  constructor(private db: any) {}
  async beginDeletion(ownerId: string, requestId: string): Promise<void> {
    ensure(/^[\w-]{8,100}$/.test(requestId), 'VALIDATION_ERROR', '请求编号无效');
    await this.db.runTransaction(async (tx: any) => {
      const current = await getMeta(tx, ownerId);
      if (current?.lastDeletionRequestId === requestId) return;
      const next: Record<string, unknown> = { ...emptyState(ownerId), ...current, ownerId,
        consent: emptyState(ownerId).consent, operations: [], projects: [], accountDeleting: true,
        revision: (current?.revision || 0) + 1, maintenance: true, nextMaintenanceAt: new Date().toISOString(), lastDeletionRequestId: requestId };
      delete next._id; for (const key of keys) delete next[key];
      await tx.collection(accountCollection).doc(ownerId).set({ data: next });
    });
  }
  async deleteBusinessBatch(ownerId: string): Promise<void> {
    const meta = await getMeta(this.db, ownerId);
    if (!meta?.accountDeleting) return;
    for (const key of ['reviews', 'goals', 'attempts', 'sessions', 'gyms'] as EntityKey[]) {
      const found = await this.db.collection(collections[key]).where({ ownerId }).orderBy('_id', 'asc').limit(20).get();
      if (!found.data.length) continue;
      // At most 20 business documents + the account marker in a transaction.
      await this.db.runTransaction(async (tx: any) => {
        const current = await getMeta(tx, ownerId);
        ensure(current?.accountDeleting && current.revision === meta.revision, 'VERSION_CONFLICT', '清理状态已更新，稍后重试');
        for (const record of found.data) {
          ensure(record.ownerId === ownerId, 'FORBIDDEN', '记录归属不匹配');
          await tx.collection(collections[key]).doc(record._id).remove();
        }
        const { _id, ...data } = current;
        await tx.collection(accountCollection).doc(ownerId).set({ data: { ...data, revision: current.revision + 1 } });
      });
      return;
    }
  }
  async finishDeletion(ownerId: string): Promise<boolean> {
    const before = await this.read(ownerId);
    if (!before.accountDeleting) return true;
    if (keys.some(key => before[key].length > 0)) return false;
    const after = { ...emptyState(ownerId), revision: before.revision + 1,
      lastDeletionRequestId: (before as any).lastDeletionRequestId };
    await this.commit(before, after); return true;
  }
  async read(ownerId: string): Promise<State> {
    for (let pass = 0; pass < 3; pass++) {
      const meta = await getMeta(this.db, ownerId);
      if (!meta) return emptyState(ownerId);
      ensure(meta.ownerId === ownerId && meta.schemaVersion === 1, 'FORBIDDEN', '数据身份或版本不匹配');
      const state: State = { ...emptyState(ownerId), ...meta };
      delete (state as any)._id;
      await Promise.all(keys.map(async key => {
        const records: Base[] = [];
        for (let offset = 0; ; offset += 100) {
          const r = await this.db.collection(collections[key]).where({ ownerId }).orderBy('_id', 'asc').skip(offset).limit(100).get();
          records.push(...r.data); if (r.data.length < 100) break;
        }
        ensure(records.every(r => r.ownerId === ownerId), 'FORBIDDEN', '记录归属不匹配');
        (state[key] as Base[]) = records;
      }));
      const after = await getMeta(this.db, ownerId);
      if (after && after.revision === meta.revision) return state;
    }
    throw new Error('记录正在更新，请重新读取');
  }
  async commit(before: State, after: State): Promise<void> {
    if (before === after) return;
    ensure(before.ownerId === after.ownerId, 'FORBIDDEN', '记录归属不匹配');
    const changes: { collection: string; id: string; data?: Base }[] = [];
    for (const key of keys) {
      const old = new Map((before[key] as Base[]).map(x => [x._id, x]));
      const next = new Map((after[key] as Base[]).map(x => [x._id, x]));
      for (const [id, item] of next) {
        ensure(item.ownerId === after.ownerId, 'FORBIDDEN', '关联记录归属不匹配');
        if (JSON.stringify(old.get(id)) !== JSON.stringify(item)) changes.push({ collection: collections[key], id, data: item });
      }
      for (const [id] of old) if (!next.has(id)) changes.push({ collection: collections[key], id });
    }
    const meta: Record<string, unknown> = { ...after,
      maintenance: after.accountDeleting || after.videos.some(v => v.status !== 'ready') || after.reviews.some(r => ['queued', 'running'].includes(r.status)),
      nextMaintenanceAt: new Date().toISOString(),
    };
    for (const key of keys) delete meta[key];
    // The revision is read in the transaction. Side effects run only after commit.
    await this.db.runTransaction(async (tx: any) => {
      const current = await getMeta(tx, before.ownerId);
      ensure((current?.revision || 0) === before.revision, 'VERSION_CONFLICT', '记录刚刚被更新，请刷新后重试');
      for (const change of changes) {
        const doc = tx.collection(change.collection).doc(change.id);
        if (change.data) { const { _id, ...data } = change.data; await doc.set({ data: JSON.parse(JSON.stringify(data)) }); }
        else await doc.remove();
      }
      await tx.collection(accountCollection).doc(after.ownerId).set({ data: JSON.parse(JSON.stringify(meta)) });
    });
  }
}
