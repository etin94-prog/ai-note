import { describe, expect, it } from 'vitest';

import { MemoryRepository } from '@/data/memory/MemoryRepository';

import { daysLeft, expiredTrash, restoreFromTrash, type TrashItem, trashOps } from './trash';

const ctx = { by: 'mom', label: 'x' };

describe('30일 휴지통 (X-08)', () => {
  it('지우면 휴지통으로, 되살리면 같은 id·내용으로 (딸린 기록 포함)', async () => {
    const repo = new MemoryRepository();
    await repo.create('events', 'ev1', { title: '치과', date: '2026-10-12' }, ctx);
    await repo.create('exceptions', 'event:ev1@2026-10-12T16:00', { checked: ['보험증'] }, ctx);
    const ev = (await repo.get<Record<string, unknown>>('events', 'ev1'))!;
    const ex = (await repo.get<Record<string, unknown>>('exceptions', 'event:ev1@2026-10-12T16:00'))!;

    const del = await repo.applyBatch(
      trashOps({ trashId: 't1', label: '일정: 치과', by: 'mom', now: '2026-10-10T00:00:00Z', docs: [{ col: 'events', doc: ev }, { col: 'exceptions', doc: ex }] }),
      ctx,
    );
    expect(del.ok).toBe(true);
    expect(await repo.get('events', 'ev1')).toBeUndefined();
    const [item] = await repo.list<TrashItem>('trash');
    expect(item).toMatchObject({ label: '일정: 치과', deletedBy: 'mom' });
    expect(item.parts.map((p) => p.col)).toEqual(['events', 'exceptions']);

    expect((await repo.applyBatch(restoreFromTrash(item), ctx)).ok).toBe(true);
    expect(await repo.get('events', 'ev1')).toMatchObject({ title: '치과', date: '2026-10-12' });
    expect(await repo.get('exceptions', 'event:ev1@2026-10-12T16:00')).toMatchObject({ checked: ['보험증'] });
    expect(await repo.list('trash')).toEqual([]);
  });

  it('남은 날짜·만료', () => {
    const item: TrashItem = { label: 'x', deletedAt: '2026-10-01T00:00:00Z', deletedBy: 'mom', parts: [] };
    expect(daysLeft(item, '2026-10-11T00:00:00Z')).toBe(20);
    expect(expiredTrash([item], '2026-10-30T23:00:00Z')).toHaveLength(0);
    expect(expiredTrash([item], '2026-10-31T00:00:00Z')).toHaveLength(1);
  });
});
