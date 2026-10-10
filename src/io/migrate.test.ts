import { describe, expect, it } from 'vitest';

import { MemoryRepository } from '@/data/memory/MemoryRepository';

import { loadAll } from './backup';
import { migrate, reconcile } from './migrate';

const ctxOf = (label: string) => ({ by: 'dad', label });

async function seeded() {
  const repo = new MemoryRepository();
  await repo.applyBatch(
    [
      { type: 'create', col: 'academies', id: 'a1', data: { name: '가상수학', status: 'active' } },
      { type: 'create', col: 'bills', id: 'b1', data: { title: 'x', academyId: 'a1', amount: 300000 } },
      { type: 'create', col: 'payments', id: 'p1', data: { billId: 'b1', amount: 300000 } },
      { type: 'create', col: 'payments', id: 'p0', data: { billId: 'b1', amount: 999, voided: { by: 'dad', at: 't' } } },
      { type: 'create', col: 'refunds', id: 'r1', data: { billId: 'b1', requested: 100000 } },
      { type: 'create', col: 'receipts', id: 'rc1', data: { refundId: 'r1', billId: 'b1', amount: 60000 } },
      { type: 'create', col: 'receipts', id: 'rc2', data: { refundId: 'r1', billId: 'b1', amount: 40000 } },
    ],
    ctxOf('seed'),
  );
  return repo;
}

describe('저장 모드 이동 (D-M2, D-M3)', () => {
  it('빈 대상에 전체 복사 → 대조표 모두 일치', async () => {
    const src = await seeded();
    const dst = new MemoryRepository();
    const r = await migrate(src, dst, { overwrite: false, ctxOf });
    expect(r.copied).toBe(7);
    expect(r.ok).toBe(true);
    expect(r.rows.find((x) => x.label === '납부 금액 합계')).toMatchObject({ source: '300,000', target: '300,000' });
    expect(r.rows.find((x) => x.label === '환불 수령 합계')).toMatchObject({ target: '100,000', ok: true });
  });

  it('대상에 데이터가 있으면 확인 없이는 멈추고, 확인하면 덮어씀 (병합 안 함)', async () => {
    const src = await seeded();
    const dst = new MemoryRepository();
    await dst.create('places', 'old', { name: '옛 장소' }, ctxOf('x'));
    await expect(migrate(src, dst, { overwrite: false, ctxOf })).rejects.toThrow('이미 데이터 1건');
    const r = await migrate(src, dst, { overwrite: true, ctxOf });
    expect(r.ok).toBe(true);
    expect((await loadAll(dst)).places).toEqual([]);
  });

  it('대조표가 차이를 잡아낸다', async () => {
    const a = await loadAll(await seeded());
    const b = { ...a, payments: a.payments!.slice(1) };
    const rows = reconcile(a, b);
    expect(rows.filter((x) => !x.ok).map((x) => x.label)).toEqual(['payments 건수', '납부 금액 합계', '내용이 다른 문서']);
  });
});
