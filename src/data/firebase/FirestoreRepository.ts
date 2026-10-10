import {
  type CollectionReference,
  collection,
  doc,
  type DocumentReference,
  type Firestore,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  waitForPendingWrites,
} from 'firebase/firestore';
import { ulid } from 'ulid';

import { type BatchEntry, newDoc, patchDoc, restoreDoc } from '../docs';
import {
  type BatchResult,
  type Collection,
  type CreateResult,
  isPrivateCollection,
  type Listener,
  type Op,
  type PendingState,
  type Repository,
  type RevertResult,
  type StoredDoc,
  type Unsubscribe,
  type UpdateResult,
  type WriteContext,
} from '../repository';

/**
 * Firebase 모드 저장소 (Requirement 1.5, 구현계획서 3.3).
 * 경로: families/{fid}/{컬렉션}/{id}, 부모 전용은 families/{fid}/private/finance/{컬렉션}/{id}.
 *
 * Sprint 0: 계약 동작 구현. 에뮬레이터 계약 테스트는 JDK 설치 후 추가.
 * TODO(Sprint 1): 자녀용 쿼리(visibleTo 조건), TODO(Sprint 2): 오프라인 중 금전 기록은 트랜잭션 대신 고정 ID 쓰기.
 */
export class FirestoreRepository implements Repository {
  readonly mode = 'firebase' as const;
  private batches = new Map<string, BatchEntry[]>();
  private pendingListeners = new Set<Listener<PendingState>>();
  private inFlight = 0;

  constructor(
    private readonly db: Firestore,
    private readonly familyId: string,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  private colRef(col: Collection): CollectionReference {
    return isPrivateCollection(col)
      ? collection(this.db, 'families', this.familyId, 'private', 'finance', col)
      : collection(this.db, 'families', this.familyId, col);
  }

  private docRef(col: Collection, id: string): DocumentReference {
    return doc(this.colRef(col), id);
  }

  watch<T>(col: Collection, listener: Listener<StoredDoc<T>[]>): Unsubscribe {
    return onSnapshot(
      this.colRef(col),
      (snap) => listener(snap.docs.map((d) => d.data() as StoredDoc<T>)),
      // 권한이 없는 컬렉션(자녀 계정의 비용 영역 등)은 빈 목록으로 — 화면이 오류로 멈추지 않게
      () => listener([]),
    );
  }

  async get<T>(col: Collection, id: string) {
    const s = await getDoc(this.docRef(col, id));
    return s.exists() ? (s.data() as StoredDoc<T>) : undefined;
  }

  async list<T>(col: Collection) {
    const s = await getDocs(this.colRef(col));
    return s.docs.map((d) => d.data() as StoredDoc<T>);
  }

  async create<T extends Record<string, unknown>>(col: Collection, id: string, data: T, ctx: WriteContext): Promise<CreateResult> {
    const r = await this.applyBatch([{ type: 'create', col, id, data }], ctx);
    return r.ok ? 'created' : 'exists';
  }

  async update<T extends Record<string, unknown>>(
    col: Collection,
    id: string,
    patch: Partial<T>,
    expectVersion: number,
    ctx: WriteContext,
  ): Promise<UpdateResult> {
    const r = await this.applyBatch([{ type: 'update', col, id, patch, expectVersion }], ctx);
    return r.ok ? 'ok' : r.conflicts[0].reason === 'missing' ? 'missing' : 'conflict';
  }

  async remove(col: Collection, id: string, expectVersion: number, ctx: WriteContext): Promise<UpdateResult> {
    const r = await this.applyBatch([{ type: 'delete', col, id, expectVersion }], ctx);
    return r.ok ? 'ok' : r.conflicts[0].reason === 'missing' ? 'missing' : 'conflict';
  }

  private async track<R>(fn: () => Promise<R>): Promise<R> {
    this.inFlight++;
    this.emitPending();
    try {
      return await fn();
    } finally {
      this.inFlight--;
      this.emitPending();
    }
  }

  applyBatch(ops: Op[], ctx: WriteContext): Promise<BatchResult> {
    return this.track(async () => {
      const batchId = ulid();
      const result = await runTransaction(this.db, async (tx) => {
        const refs = ops.map((op) => this.docRef(op.col, op.id));
        const snaps = await Promise.all(refs.map((r) => tx.get(r)));
        const conflicts: BatchResult['conflicts'] = [];
        ops.forEach((op, i) => {
          const cur = snaps[i].exists() ? (snaps[i].data() as StoredDoc) : undefined;
          if (op.type === 'create' && cur) conflicts.push({ col: op.col, id: op.id, reason: 'exists' });
          if (op.type !== 'create' && !cur) conflicts.push({ col: op.col, id: op.id, reason: 'missing' });
          if (op.type !== 'create' && cur && cur.version !== op.expectVersion)
            conflicts.push({ col: op.col, id: op.id, reason: 'conflict' });
        });
        if (conflicts.length) return { conflicts, entries: [] as BatchEntry[] };

        const now = this.clock();
        const entries: BatchEntry[] = [];
        ops.forEach((op, i) => {
          const before = snaps[i].exists() ? (snaps[i].data() as StoredDoc) : null;
          const after =
            op.type === 'create' ? newDoc(op.id, op.data, ctx, now) : op.type === 'update' ? patchDoc(before!, op.patch, ctx, now) : null;
          if (after) tx.set(refs[i], after);
          else tx.delete(refs[i]);
          entries.push({ col: op.col, id: op.id, before, afterVersion: after?.version ?? null });
        });
        return { conflicts, entries };
      });
      if (result.conflicts.length) return { ok: false, batchId, conflicts: result.conflicts };
      this.batches.set(batchId, result.entries);
      return { ok: true, batchId, conflicts: [] };
    });
  }

  revertBatch(batchId: string, ctx: WriteContext): Promise<RevertResult> {
    return this.track(async () => {
      const entries = this.batches.get(batchId);
      if (!entries) return { reverted: 0, conflicts: [] };
      const res = await runTransaction(this.db, async (tx) => {
        const refs = entries.map((e) => this.docRef(e.col, e.id));
        const snaps = await Promise.all(refs.map((r) => tx.get(r)));
        const now = this.clock();
        const conflicts: RevertResult['conflicts'] = [];
        let reverted = 0;
        entries.forEach((e, i) => {
          const cur = snaps[i].exists() ? (snaps[i].data() as StoredDoc) : undefined;
          if ((cur?.version ?? null) !== e.afterVersion) {
            conflicts.push({ col: e.col, id: e.id });
            return;
          }
          const restored = restoreDoc(e.before, cur, ctx, now);
          if (restored) tx.set(refs[i], restored);
          else tx.delete(refs[i]);
          reverted++;
        });
        return { reverted, conflicts };
      });
      this.batches.delete(batchId);
      return res;
    });
  }

  private emitPending() {
    const online = typeof navigator === 'undefined' ? true : navigator.onLine;
    this.pendingListeners.forEach((l) => l({ count: this.inFlight, failed: 0, online }));
  }

  pending(listener: Listener<PendingState>): Unsubscribe {
    this.pendingListeners.add(listener);
    this.emitPending();
    return () => this.pendingListeners.delete(listener);
  }

  async flush(timeoutMs: number): Promise<boolean> {
    return Promise.race([
      waitForPendingWrites(this.db).then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs)),
    ]);
  }
}
