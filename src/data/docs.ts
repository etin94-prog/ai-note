import { SCHEMA_VERSION } from '@/lib/config';

import type { DocMeta, Op, StoredDoc, WriteContext } from './repository';

/** 공통 필드를 붙인 새 문서. */
export function newDoc<T extends Record<string, unknown>>(id: string, data: T, ctx: WriteContext, now: string): StoredDoc<T> {
  return {
    ...data,
    id,
    version: 1,
    createdAt: now,
    updatedAt: now,
    updatedBy: ctx.by,
    schemaVersion: SCHEMA_VERSION,
  };
}

const META_KEYS: (keyof DocMeta)[] = ['id', 'version', 'createdAt', 'updatedAt', 'updatedBy', 'schemaVersion'];

/** 수정 적용. 공통 필드는 patch 로 덮어쓸 수 없다. */
export function patchDoc<T>(current: StoredDoc<T>, patch: Record<string, unknown>, ctx: WriteContext, now: string): StoredDoc<T> {
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => !META_KEYS.includes(k as keyof DocMeta)));
  return {
    ...current,
    ...clean,
    version: current.version + 1,
    updatedAt: now,
    updatedBy: ctx.by,
  };
}

/** 되돌리기 기록: 작업 전 상태(없었으면 null)와 작업 후 version. */
export interface BatchEntry {
  col: Op['col'];
  id: string;
  before: StoredDoc | null;
  afterVersion: number | null;
}

/**
 * 되돌리기 결과 문서. 내용은 작업 전으로, version 은 계속 증가시켜
 * 다른 기기가 들고 있는 이전 version 과 혼동되지 않게 한다. before 가 없으면 삭제(null).
 */
export function restoreDoc(
  before: StoredDoc | null,
  current: StoredDoc | undefined,
  ctx: WriteContext,
  now: string,
): StoredDoc | null {
  if (!before) return null;
  const base = Math.max(before.version, current?.version ?? 0);
  return { ...before, version: base + 1, updatedAt: now, updatedBy: ctx.by };
}

export function commitMessage(ctx: WriteContext): string {
  return ctx.device ? `[${ctx.device}] ${ctx.label}` : ctx.label;
}
