import { useCallback } from 'react';
import { ulid } from 'ulid';

import type { Collection, StoredDoc } from '@/data/repository';
import { trashOps } from '@/domain/trash';

import { useRepository } from './RepositoryContext';

/**
 * 지우기 → 30일 휴지통 (X-08). 휴지통은 부모 전용 영역이라 자녀 기기에서는 바로 삭제한다.
 * 돌려주는 값: 성공 여부.
 */
export function useTrash() {
  const { repo, isChild, settings, writeContext } = useRepository();
  return useCallback(
    async (label: string, docs: { col: Collection; doc: StoredDoc }[]): Promise<boolean> => {
      if (!repo || docs.length === 0) return false;
      const ops = isChild
        ? docs.map(({ col, doc }) => ({ type: 'delete' as const, col, id: doc.id, expectVersion: doc.version }))
        : trashOps({ trashId: ulid(), label, by: settings.memberId || 'unknown', now: new Date().toISOString(), docs });
      const r = await repo.applyBatch(ops, writeContext(`삭제(휴지통): ${label}`));
      return r.ok;
    },
    [repo, isChild, settings.memberId, writeContext],
  );
}
