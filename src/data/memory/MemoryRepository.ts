import { ulid } from 'ulid';

import { type BatchEntry, newDoc, patchDoc, restoreDoc } from '../docs';
import type {
  BatchResult,
  Collection,
  CreateResult,
  Listener,
  Op,
  PendingState,
  Repository,
  RevertResult,
  StoredDoc,
  Unsubscribe,
  UpdateResult,
  WriteContext,
} from '../repository';

type Store = Map<string, StoredDoc>;

/**
 * 메모리 저장소. 테스트와 화면 개발용.
 * 다른 구현(GitHub/Firebase)도 같은 계약 테스트(contract/)를 통과해야 한다.
 */
export class MemoryRepository implements Repository {
  readonly mode = 'memory' as const;
  private stores = new Map<Collection, Store>();
  private listeners = new Map<Collection, Set<Listener<StoredDoc[]>>>();
  private batches = new Map<string, BatchEntry[]>();

  /**
   * @param persistKey 지정하면 브라우저 localStorage 에 보관 (체험 모드 — 새로고침해도 유지, 이 기기에만)
   */
  constructor(
    private clock: () => string = () => new Date().toISOString(),
    private persistKey?: string,
  ) {
    if (!persistKey) return;
    try {
      const raw = globalThis.localStorage?.getItem(persistKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, StoredDoc[]>;
      for (const [col, docs] of Object.entries(saved)) this.stores.set(col as Collection, new Map(docs.map((d) => [d.id, d])));
    } catch {
      // 손상된 체험 데이터는 무시하고 빈 상태로 시작
    }
  }

  private persist() {
    if (!this.persistKey) return;
    try {
      const out = Object.fromEntries([...this.stores].map(([col, s]) => [col, [...s.values()]]));
      globalThis.localStorage?.setItem(this.persistKey, JSON.stringify(out));
    } catch {
      // 저장 공간 부족 등 — 체험 모드라 무시
    }
  }

  private store(col: Collection): Store {
    let s = this.stores.get(col);
    if (!s) {
      s = new Map();
      this.stores.set(col, s);
    }
    return s;
  }

  private emit(col: Collection) {
    const docs = [...this.store(col).values()];
    this.listeners.get(col)?.forEach((l) => l(docs));
  }

  watch<T>(col: Collection, listener: Listener<StoredDoc<T>[]>): Unsubscribe {
    let set = this.listeners.get(col);
    if (!set) {
      set = new Set();
      this.listeners.set(col, set);
    }
    const l = listener as Listener<StoredDoc[]>;
    set.add(l);
    l([...this.store(col).values()]);
    return () => set!.delete(l);
  }

  async get<T>(col: Collection, id: string) {
    return this.store(col).get(id) as StoredDoc<T> | undefined;
  }

  async list<T>(col: Collection) {
    return [...this.store(col).values()] as StoredDoc<T>[];
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

  async applyBatch(ops: Op[], ctx: WriteContext): Promise<BatchResult> {
    const batchId = ulid();
    const conflicts: BatchResult['conflicts'] = [];
    for (const op of ops) {
      const cur = this.store(op.col).get(op.id);
      if (op.type === 'create' && cur) conflicts.push({ col: op.col, id: op.id, reason: 'exists' });
      if (op.type !== 'create' && !cur) conflicts.push({ col: op.col, id: op.id, reason: 'missing' });
      if (op.type !== 'create' && cur && cur.version !== op.expectVersion)
        conflicts.push({ col: op.col, id: op.id, reason: 'conflict' });
    }
    if (conflicts.length) return { ok: false, batchId, conflicts };

    const now = this.clock();
    const entries: BatchEntry[] = [];
    const touched = new Set<Collection>();
    for (const op of ops) {
      const s = this.store(op.col);
      const before = s.get(op.id) ?? null;
      let after: StoredDoc | null = null;
      if (op.type === 'create') after = newDoc(op.id, op.data, ctx, now);
      if (op.type === 'update') after = patchDoc(before!, op.patch, ctx, now);
      if (after) s.set(op.id, after);
      else s.delete(op.id);
      entries.push({ col: op.col, id: op.id, before, afterVersion: after?.version ?? null });
      touched.add(op.col);
    }
    this.batches.set(batchId, entries);
    this.persist();
    touched.forEach((c) => this.emit(c));
    return { ok: true, batchId, conflicts: [] };
  }

  async revertBatch(batchId: string, ctx: WriteContext): Promise<RevertResult> {
    const entries = this.batches.get(batchId);
    if (!entries) return { reverted: 0, conflicts: [] };
    const conflicts: RevertResult['conflicts'] = [];
    let reverted = 0;
    const touched = new Set<Collection>();
    const now = this.clock();
    for (const e of [...entries].reverse()) {
      const s = this.store(e.col);
      const cur = s.get(e.id);
      const curVersion = cur?.version ?? null;
      if (curVersion !== e.afterVersion) {
        conflicts.push({ col: e.col, id: e.id });
        continue;
      }
      const restored = restoreDoc(e.before, cur, ctx, now);
      if (restored) s.set(e.id, restored);
      else s.delete(e.id);
      reverted++;
      touched.add(e.col);
    }
    this.batches.delete(batchId);
    this.persist();
    touched.forEach((c) => this.emit(c));
    return { reverted, conflicts };
  }

  pending(listener: Listener<PendingState>): Unsubscribe {
    listener({ count: 0, failed: 0, online: true });
    return () => {};
  }

  async flush() {
    return true;
  }
}
