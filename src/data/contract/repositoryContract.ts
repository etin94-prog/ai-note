import { describe, expect, it } from 'vitest';

import type { Repository, WriteContext } from '../repository';

/**
 * 저장소 공통 계약 테스트 (구현계획서 6장).
 * 모든 Repository 구현이 같은 결과를 내야 두 저장 모드를 바꿔 끼울 수 있다.
 */
export function repositoryContract(name: string, make: () => Promise<Repository> | Repository) {
  const ctx: WriteContext = { by: 'mom', label: '테스트', device: '테스트 기기' };

  describe(`Repository 계약: ${name}`, () => {
    it('id 고정 생성은 멱등이다 — 재전송해도 1건, 기존 내용 유지', async () => {
      const repo = await make();
      expect(await repo.create('payments', 'p1', { amount: 450000 }, ctx)).toBe('created');
      expect(await repo.create('payments', 'p1', { amount: 999 }, ctx)).toBe('exists');
      const all = await repo.list<{ amount: number }>('payments');
      expect(all).toHaveLength(1);
      expect(all[0].amount).toBe(450000);
      expect(all[0].version).toBe(1);
      expect(all[0].updatedBy).toBe('mom');
    });

    it('서로 다른 두 기록은 모두 보존된다', async () => {
      const repo = await make();
      await repo.create('payments', 'p1', { amount: 100 }, ctx);
      await repo.create('payments', 'p2', { amount: 200 }, { ...ctx, by: 'dad' });
      expect(await repo.list('payments')).toHaveLength(2);
    });

    it('version 이 다르면 수정은 충돌한다', async () => {
      const repo = await make();
      await repo.create('events', 'e1', { title: '수학' }, ctx);
      expect(await repo.update('events', 'e1', { title: '수학A' }, 1, ctx)).toBe('ok');
      expect(await repo.update('events', 'e1', { title: '수학B' }, 1, ctx)).toBe('conflict');
      const e = await repo.get<{ title: string }>('events', 'e1');
      expect(e?.title).toBe('수학A');
      expect(e?.version).toBe(2);
    });

    it('없는 문서 수정은 missing', async () => {
      const repo = await make();
      expect(await repo.update('events', 'nope', { title: 'x' }, 1, ctx)).toBe('missing');
    });

    it('공통 필드(id, version)는 patch 로 바꿀 수 없다', async () => {
      const repo = await make();
      await repo.create('places', 'home', { name: '집' }, ctx);
      await repo.update('places', 'home', { id: 'hack', version: 99, name: '우리집' } as never, 1, ctx);
      const p = await repo.get<{ name: string }>('places', 'home');
      expect(p?.id).toBe('home');
      expect(p?.version).toBe(2);
      expect(p?.name).toBe('우리집');
    });

    it('배치는 원자적이다 — 하나라도 충돌하면 전부 반영 안 됨', async () => {
      const repo = await make();
      await repo.create('bills', 'b1', { amount: 1 }, ctx);
      const r = await repo.applyBatch(
        [
          { type: 'create', col: 'bills', id: 'b2', data: { amount: 2 } },
          { type: 'create', col: 'bills', id: 'b1', data: { amount: 3 } },
        ],
        ctx,
      );
      expect(r.ok).toBe(false);
      expect(r.conflicts).toEqual([{ col: 'bills', id: 'b1', reason: 'exists' }]);
      expect(await repo.list('bills')).toHaveLength(1);
    });

    it('배치 되돌리기 — 신규는 삭제, 수정은 이전 값 복원', async () => {
      const repo = await make();
      await repo.create('academies', 'a1', { name: '가나다영어' }, ctx);
      const r = await repo.applyBatch(
        [
          { type: 'create', col: 'academies', id: 'a2', data: { name: '라마바수학' } },
          { type: 'update', col: 'academies', id: 'a1', patch: { name: '가나다영어학원' }, expectVersion: 1 },
        ],
        ctx,
      );
      expect(r.ok).toBe(true);
      const rv = await repo.revertBatch(r.batchId, ctx);
      expect(rv).toEqual({ reverted: 2, conflicts: [] });
      const all = await repo.list<{ name: string }>('academies');
      expect(all.map((a) => a.name)).toEqual(['가나다영어']);
    });

    it('되돌리기 — 이후 다른 사람이 고친 항목은 덮어쓰지 않고 충돌로 보고', async () => {
      const repo = await make();
      const r = await repo.applyBatch([{ type: 'create', col: 'events', id: 'e1', data: { title: 'A' } }], ctx);
      await repo.update('events', 'e1', { title: 'B' }, 1, { ...ctx, by: 'dad' });
      const rv = await repo.revertBatch(r.batchId, ctx);
      expect(rv.reverted).toBe(0);
      expect(rv.conflicts).toEqual([{ col: 'events', id: 'e1' }]);
      expect((await repo.get<{ title: string }>('events', 'e1'))?.title).toBe('B');
    });

    it('watch 는 현재 목록을 바로 주고, 변경 시 다시 알린다', async () => {
      const repo = await make();
      const seen: number[] = [];
      const off = repo.watch('places', (docs) => seen.push(docs.length));
      await repo.create('places', 'p1', { name: '집' }, ctx);
      await waitFor(() => seen.at(-1) === 1);
      off();
      expect(seen[0]).toBe(0);
    });

    it('부모 전용 컬렉션도 같은 방식으로 동작한다', async () => {
      const repo = await make();
      await repo.create('bills', 'enr1:2026-11-01', { amount: 320000 }, ctx);
      expect((await repo.get('bills', 'enr1:2026-11-01'))?.version).toBe(1);
    });
  });
}

async function waitFor(cond: () => boolean, ms = 2000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}
