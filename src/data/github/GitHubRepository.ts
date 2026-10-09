import { ulid } from 'ulid';

import { type BatchEntry, commitMessage, newDoc, patchDoc, restoreDoc } from '../docs';
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
import type { FileChange, GitHubApi } from './GitHubApi';
import { gitBlobSha } from './gitSha';
import { docPath, parseDocPath, serializeDoc } from './paths';

interface CacheEntry {
  sha: string;
  col: Collection;
  doc: StoredDoc;
}

export interface GitHubRepositoryOptions {
  clock?: () => string;
  /** 다른 기기가 먼저 커밋했을 때 다시 시도하는 횟수 */
  maxRetries?: number;
}

/**
 * GitHub 모드 저장소 (Requirement 1.5, 구현계획서 3.2).
 * - 모든 쓰기는 커밋 1개 → 여러 항목도 원자적으로 반영, 커밋 이력 = 변경 이력.
 * - 쓰기 전 최신 트리를 받아 version 을 확인하고, 다른 기기가 먼저 커밋했으면 다시 시도한다.
 *
 * TODO(Sprint 1): 캐시·전송대기열을 IndexedDB(Dexie)에 저장해 오프라인 입력 지원 (X-09), 자녀 사본 저장소 (G-03).
 */
export class GitHubRepository implements Repository {
  readonly mode = 'github' as const;
  private cache = new Map<string, CacheEntry>();
  private head: string | null = null;
  private etag: string | undefined;
  private loaded: Promise<void> | null = null;
  private listeners = new Map<Collection, Set<Listener<StoredDoc[]>>>();
  private pendingListeners = new Set<Listener<PendingState>>();
  private inFlight = 0;
  private batches = new Map<string, BatchEntry[]>();
  private clock: () => string;
  private maxRetries: number;
  private writeLock: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly api: GitHubApi,
    opts: GitHubRepositoryOptions = {},
  ) {
    this.clock = opts.clock ?? (() => new Date().toISOString());
    this.maxRetries = opts.maxRetries ?? 3;
  }

  /** 최신 상태 가져오기. 바뀐 파일만 다시 받는다. 화면 복귀·주기 확인에서 호출. */
  async sync(): Promise<void> {
    const tree = await this.api.readTree(this.etag);
    if (tree.notModified) return;
    const touched = new Set<Collection>();
    const seen = new Set<string>();
    for (const e of tree.entries) {
      const parsed = parseDocPath(e.path);
      if (!parsed) continue;
      seen.add(e.path);
      const cur = this.cache.get(e.path);
      if (cur?.sha === e.sha) continue;
      const doc = JSON.parse(await this.api.readBlob(e.sha)) as StoredDoc;
      this.cache.set(e.path, { sha: e.sha, col: parsed.col, doc });
      touched.add(parsed.col);
    }
    for (const [path, entry] of this.cache) {
      if (!seen.has(path)) {
        this.cache.delete(path);
        touched.add(entry.col);
      }
    }
    this.head = tree.headSha;
    this.etag = tree.etag;
    touched.forEach((c) => this.emit(c));
  }

  private ensureLoaded(): Promise<void> {
    if (!this.loaded) this.loaded = this.sync();
    return this.loaded;
  }

  private docs(col: Collection): StoredDoc[] {
    return [...this.cache.values()].filter((e) => e.col === col).map((e) => e.doc);
  }

  private emit(col: Collection) {
    const docs = this.docs(col);
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
    l(this.docs(col));
    void this.ensureLoaded().then(() => l(this.docs(col)));
    return () => set!.delete(l);
  }

  async get<T>(col: Collection, id: string) {
    await this.ensureLoaded();
    return this.cache.get(docPath(col, id))?.doc as StoredDoc<T> | undefined;
  }

  async list<T>(col: Collection) {
    await this.ensureLoaded();
    return this.docs(col) as StoredDoc<T>[];
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

  /** 같은 기기 안의 쓰기는 순서대로 (head 경쟁 방지). */
  private serialize<R>(fn: () => Promise<R>): Promise<R> {
    const run = this.writeLock.then(fn, fn);
    this.writeLock = run.catch(() => undefined);
    return run;
  }

  private trackPending<R>(fn: () => Promise<R>): Promise<R> {
    this.inFlight++;
    this.emitPending();
    return fn().finally(() => {
      this.inFlight--;
      this.emitPending();
    });
  }

  applyBatch(ops: Op[], ctx: WriteContext): Promise<BatchResult> {
    return this.trackPending(() => this.serialize(() => this.applyBatchNow(ops, ctx)));
  }

  private async applyBatchNow(ops: Op[], ctx: WriteContext): Promise<BatchResult> {
    const batchId = ulid();
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.ensureLoaded();
      await this.sync();

      const conflicts: BatchResult['conflicts'] = [];
      for (const op of ops) {
        const cur = this.cache.get(docPath(op.col, op.id))?.doc;
        if (op.type === 'create' && cur) conflicts.push({ col: op.col, id: op.id, reason: 'exists' });
        if (op.type !== 'create' && !cur) conflicts.push({ col: op.col, id: op.id, reason: 'missing' });
        if (op.type !== 'create' && cur && cur.version !== op.expectVersion)
          conflicts.push({ col: op.col, id: op.id, reason: 'conflict' });
      }
      if (conflicts.length) return { ok: false, batchId, conflicts };

      const now = this.clock();
      const planned: { col: Collection; id: string; path: string; before: StoredDoc | null; after: StoredDoc | null }[] = [];
      for (const op of ops) {
        const path = docPath(op.col, op.id);
        const before = this.cache.get(path)?.doc ?? null;
        const after =
          op.type === 'create' ? newDoc(op.id, op.data, ctx, now) : op.type === 'update' ? patchDoc(before!, op.patch, ctx, now) : null;
        planned.push({ col: op.col, id: op.id, path, before, after });
      }

      const committed = await this.commitPlanned(planned, commitMessage(ctx));
      if (!committed) continue; // 다른 기기가 먼저 커밋 → 최신 받아 재검사

      this.batches.set(
        batchId,
        planned.map((p) => ({ col: p.col, id: p.id, before: p.before, afterVersion: p.after?.version ?? null })),
      );
      return { ok: true, batchId, conflicts: [] };
    }
    throw new Error('다른 기기의 저장과 계속 겹칩니다. 잠시 후 다시 시도하세요.');
  }

  /** 계획된 변경을 커밋 1개로 반영하고 캐시를 맞춘다. non-fast-forward 면 false. */
  private async commitPlanned(
    planned: { col: Collection; path: string; after: StoredDoc | null }[],
    message: string,
  ): Promise<boolean> {
    const changes: FileChange[] = planned.map((p) => ({ path: p.path, content: p.after ? serializeDoc(p.after) : null }));
    const res = await this.api.commit(changes, message, this.head ?? '');
    if (!res.ok) return false;
    for (const p of planned) {
      if (p.after) {
        const sha = await gitBlobSha(serializeDoc(p.after));
        this.cache.set(p.path, { sha, col: p.col, doc: p.after });
      } else this.cache.delete(p.path);
    }
    this.head = res.headSha;
    this.etag = undefined; // 다음 sync 에서 새 head 기준으로 비교
    new Set(planned.map((p) => p.col)).forEach((c) => this.emit(c));
    return true;
  }

  revertBatch(batchId: string, ctx: WriteContext): Promise<RevertResult> {
    return this.trackPending(() =>
      this.serialize(async () => {
        const entries = this.batches.get(batchId);
        if (!entries) return { reverted: 0, conflicts: [] };
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
          await this.sync();
          const now = this.clock();
          const conflicts: RevertResult['conflicts'] = [];
          const planned: { col: Collection; path: string; after: StoredDoc | null }[] = [];
          for (const e of entries) {
            const path = docPath(e.col, e.id);
            const cur = this.cache.get(path)?.doc;
            if ((cur?.version ?? null) !== e.afterVersion) {
              conflicts.push({ col: e.col, id: e.id });
              continue;
            }
            planned.push({ col: e.col, path, after: restoreDoc(e.before, cur, ctx, now) });
          }
          if (planned.length === 0) {
            this.batches.delete(batchId);
            return { reverted: 0, conflicts };
          }
          if (!(await this.commitPlanned(planned, commitMessage({ ...ctx, label: `되돌리기: ${ctx.label}` })))) continue;
          this.batches.delete(batchId);
          return { reverted: planned.length, conflicts };
        }
        throw new Error('되돌리기 중 다른 기기의 저장과 계속 겹칩니다.');
      }),
    );
  }

  private emitPending() {
    const state: PendingState = { count: this.inFlight, failed: 0, online: true };
    this.pendingListeners.forEach((l) => l(state));
  }

  pending(listener: Listener<PendingState>): Unsubscribe {
    this.pendingListeners.add(listener);
    listener({ count: this.inFlight, failed: 0, online: true });
    return () => this.pendingListeners.delete(listener);
  }

  async flush(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.inFlight > 0) {
      if (Date.now() > deadline) return false;
      await new Promise((r) => setTimeout(r, 50));
    }
    return true;
  }
}
