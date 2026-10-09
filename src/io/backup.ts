import { type Collection, type Op, PRIVATE_COLLECTIONS, PUBLIC_COLLECTIONS, type Repository, type StoredDoc } from '@/data/repository';

/**
 * 전체 저장 파일(JSON) 백업·복원, 데이터 초기화 (I-20, 관리자 화면).
 * 복원·초기화는 전체 교체라 실행 전에 항상 현재 데이터를 백업 파일로 받는다.
 */

export const ALL_COLLECTIONS = [...PUBLIC_COLLECTIONS, ...PRIVATE_COLLECTIONS] as Collection[];
export const BACKUP_KIND = 'ai-note-backup';

export type AllData = Partial<Record<Collection, StoredDoc[]>>;

export interface BackupFile {
  kind: typeof BACKUP_KIND;
  exportedAt: string;
  mode: string;
  by: string;
  data: AllData;
}

export async function loadAll(repo: Repository, cols: Collection[] = ALL_COLLECTIONS): Promise<AllData> {
  const out: AllData = {};
  for (const c of cols) out[c] = await repo.list(c);
  return out;
}

export const countDocs = (d: AllData) => Object.values(d).reduce((s, x) => s + (x?.length ?? 0), 0);

export function makeBackup(data: AllData, info: { exportedAt: string; mode: string; by: string }): BackupFile {
  return { kind: BACKUP_KIND, ...info, data };
}

export function parseBackup(text: string): BackupFile {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error('JSON 파일을 읽을 수 없습니다');
  }
  const b = j as BackupFile;
  if (!b || b.kind !== BACKUP_KIND || typeof b.data !== 'object') throw new Error('우리집 학원 노트 백업 파일이 아닙니다');
  for (const c of Object.keys(b.data)) if (!ALL_COLLECTIONS.includes(c as Collection)) throw new Error(`알 수 없는 항목: ${c}`);
  return b;
}

const META = ['id', 'version', 'createdAt', 'updatedAt', 'updatedBy', 'schemaVersion'];
const body = (d: StoredDoc) => Object.fromEntries(Object.entries(d).filter(([k]) => !META.includes(k)));

/** 초기화: 모든 문서 삭제 */
export function resetOps(current: AllData): Op[] {
  return ALL_COLLECTIONS.flatMap((col) => (current[col] ?? []).map((d): Op => ({ type: 'delete', col, id: d.id, expectVersion: d.version })));
}

/** 복원: 현재 데이터를 백업 내용으로 전체 교체 (같은 id 는 내용 덮어쓰기, 백업에 없는 문서는 삭제) */
export function restoreOps(current: AllData, backup: AllData): Op[] {
  const ops: Op[] = [];
  for (const col of ALL_COLLECTIONS) {
    const cur = new Map((current[col] ?? []).map((d) => [d.id, d]));
    const next = backup[col] ?? [];
    const keep = new Set(next.map((d) => d.id));
    for (const d of next) {
      const c = cur.get(d.id);
      if (!c) ops.push({ type: 'create', col, id: d.id, data: body(d) });
      else {
        const patch: Record<string, unknown> = body(d);
        for (const k of Object.keys(body(c))) if (!(k in patch)) patch[k] = null;
        ops.push({ type: 'update', col, id: d.id, patch, expectVersion: c.version });
      }
    }
    for (const d of cur.values()) if (!keep.has(d.id)) ops.push({ type: 'delete', col, id: d.id, expectVersion: d.version });
  }
  return ops;
}

/** 많은 작업은 나눠 저장 (Firebase 트랜잭션 한도). 반환: 각 묶음의 batchId */
export async function applyInChunks(
  repo: Repository,
  ops: Op[],
  label: string,
  ctxOf: (label: string) => { by: string; label: string; device?: string },
  size = 200,
): Promise<string[]> {
  const ids: string[] = [];
  const total = Math.ceil(ops.length / size);
  for (let i = 0; i < ops.length; i += size) {
    const r = await repo.applyBatch(ops.slice(i, i + size), ctxOf(total > 1 ? `${label} (${i / size + 1}/${total})` : label));
    if (!r.ok) throw new Error(`다른 기기에서 같은 항목을 먼저 고쳤습니다 (${r.conflicts.length}건). 다시 시도해 주세요.${ids.length ? ` 앞의 ${ids.length}묶음은 이미 반영됨.` : ''}`);
    ids.push(r.batchId);
  }
  return ids;
}
