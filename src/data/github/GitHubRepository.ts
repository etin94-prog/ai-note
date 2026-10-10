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
  /**
   * 화면 먼저 반영 (앱에서 켬): 저장하면 바로 화면에 보이고 GitHub 전송은 뒤에서 한다.
   * 전송에 실패하면 되돌리고 pending 의 failed·lastError 로 알린다.
   */
  optimistic?: boolean;
  /** 통신 오류 때 다시 시도하기 전 기다리는 시간(ms). 테스트에서 0 */
  retryDelayMs?: number;
}

class ConflictError extends Error {}

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
  /** 아직 GitHub 에 보내지 않았지만 화면에는 먼저 보여 주는 내용 (path → 문서, 삭제는 null) */
  private overlay = new Map<string, { col: Collection; doc: StoredDoc | null }>();
  private optimistic: boolean;
  private retryDelayMs: number;
  private failed = 0;
  private lastError: string | undefined;

  constructor(
    private readonly api: GitHubApi,
    opts: GitHubRepositoryOptions = {},
  ) {
    this.clock = opts.clock ?? (() => new Date().toISOString());
    this.maxRetries = opts.maxRetries ?? 3;
    this.optimistic = opts.optimistic ?? false;
    this.retryDelayMs = opts.retryDelayMs ?? 1500;
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

  /** 화면에 보이는 문서 = 받아 온 내용 위에 아직 보내는 중인 변경을 덮은 것 */
  private viewDoc(path: string): StoredDoc | undefined {
    const o = this.overlay.get(path);
    return o ? (o.doc ?? undefined) : this.cache.get(path)?.doc;
  }

  private docs(col: Collection): StoredDoc[] {
    const out: StoredDoc[] = [];
    for (const [path, e] of this.cache) if (e.col === col && !this.overlay.has(path)) out.push(e.doc);
    for (const o of this.overlay.values()) if (o.col === col && o.doc) out.push(o.doc);
    return out;
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
    return this.viewDoc(docPath(col, id)) as StoredDoc<T> | undefined;
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
    if (this.optimistic) return this.applyOptimistic(ops, ctx);
    return this.trackPending(() => this.serialize(() => this.applyBatchNow(ops, ctx)));
  }

  /**
   * 화면 먼저 반영: 지금 보이는 내용 기준으로 검사하고 바로 화면에 적용한 뒤 돌려준다.
   * GitHub 커밋은 순서대로 뒤에서 진행 (전송 중 건수는 pending 으로 알림).
   */
  private async applyOptimistic(ops: Op[], ctx: WriteContext): Promise<BatchResult> {
    const batchId = ulid();
    await this.ensureLoaded();
    const conflicts: BatchResult['conflicts'] = [];
    for (const op of ops) {
      const cur = this.viewDoc(docPath(op.col, op.id));
      if (op.type === 'create' && cur) conflicts.push({ col: op.col, id: op.id, reason: 'exists' });
      if (op.type !== 'create' && !cur) conflicts.push({ col: op.col, id: op.id, reason: 'missing' });
      if (op.type !== 'create' && cur && cur.version !== op.expectVersion) conflicts.push({ col: op.col, id: op.id, reason: 'conflict' });
    }
    if (conflicts.length) return { ok: false, batchId, conflicts };

    const now = this.clock();
    const planned = ops.map((op) => {
      const path = docPath(op.col, op.id);
      const before = this.viewDoc(path) ?? null;
      const after = op.type === 'create' ? newDoc(op.id, op.data, ctx, now) : op.type === 'update' ? patchDoc(before!, op.patch, ctx, now) : null;
      return { col: op.col, id: op.id, path, before, after };
    });
    for (const p of planned) this.overlay.set(p.path, { col: p.col, doc: p.after });
    const cols = new Set(planned.map((p) => p.col));
    cols.forEach((c) => this.emit(c));
    this.batches.set(
      batchId,
      planned.map((p) => ({ col: p.col, id: p.id, before: p.before, afterVersion: p.after?.version ?? null })),
    );

    void this.trackPending(() =>
      this.serialize(async () => {
        try {
          await this.commitInBackground(planned, commitMessage(ctx));
        } catch (e) {
          // 보내지 못함 → 화면을 되돌리고 알림
          for (const p of planned) if (this.overlay.get(p.path)?.doc === p.after) this.overlay.delete(p.path);
          this.batches.delete(batchId);
          this.failed++;
          this.lastError = `${ctx.label} — ${e instanceof Error ? e.message : String(e)}`;
          cols.forEach((c) => this.emit(c));
        }
      }),
    );
    return { ok: true, batchId, conflicts: [] };
  }

  private async commitInBackground(planned: { col: Collection; id: string; path: string; before: StoredDoc | null; after: StoredDoc | null }[], message: string) {
    let netErrors = 0;
    for (let attempt = 0; attempt <= this.maxRetries; ) {
      try {
        await this.sync();
        // 그 사이 다른 기기가 같은 문서를 바꿨으면 덮어쓰지 않는다
        const changed = planned.some((p) => (this.cache.get(p.path)?.doc.version ?? null) !== (p.before?.version ?? null));
        if (changed) throw new ConflictError('다른 기기에서 같은 항목을 먼저 바꿔서 저장하지 못했습니다. 다시 확인해 주세요.');
        if (await this.commitPlanned(planned, message)) {
          let cleared = false;
          for (const p of planned) {
            if (this.overlay.get(p.path)?.doc === p.after) {
              this.overlay.delete(p.path);
              cleared = true;
            }
          }
          if (cleared) new Set(planned.map((p) => p.col)).forEach((c) => this.emit(c));
          return;
        }
        attempt++; // 다른 기기가 먼저 커밋 → 최신 받아 다시
      } catch (e) {
        if (e instanceof ConflictError) throw e;
        // 통신 오류는 잠깐 기다렸다가 두 번까지 다시
        if (++netErrors > 2) throw new Error(`GitHub 에 보내지 못했습니다 (${e instanceof Error ? e.message : String(e)})`);
        if (this.retryDelayMs) await new Promise((r) => setTimeout(r, this.retryDelayMs * netErrors));
      }
    }
    throw new Error('다른 기기의 저장과 계속 겹칩니다. 잠시 후 다시 시도하세요.');
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

  private pendingState(): PendingState {
    return { count: this.inFlight, failed: this.failed, online: true, ...(this.lastError ? { lastError: this.lastError } : {}) };
  }

  ackFailures() {
    this.failed = 0;
    this.lastError = undefined;
    this.emitPending();
  }

  private emitPending() {
    const state = this.pendingState();
    this.pendingListeners.forEach((l) => l(state));
  }

  pending(listener: Listener<PendingState>): Unsubscribe {
    this.pendingListeners.add(listener);
    listener(this.pendingState());
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
