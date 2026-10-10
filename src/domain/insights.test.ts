import { describe, expect, it } from 'vitest';

import { countSessions, estimateRefund, monthGrid, monthlySeries, totalsBy } from './insights';
import { type Bill, billState, type Payment } from './money';

describe('환불 예상액 도우미 (F-12, 참고용)', () => {
  it('학원법 시행령 1개월 기준 구간', () => {
    expect(estimateRefund(300000, 8, 0)).toMatchObject({ amount: 300000, ratio: 1 });
    expect(estimateRefund(300000, 8, 2)).toMatchObject({ amount: 200000 }); // 2/8 < 1/3
    expect(estimateRefund(300000, 9, 3)).toMatchObject({ amount: 150000 }); // 딱 1/3 → 1/2 구간
    expect(estimateRefund(300000, 8, 3)).toMatchObject({ amount: 150000 }); // 3/8 < 1/2
    expect(estimateRefund(300000, 8, 4)).toMatchObject({ amount: 0 }); // 딱 1/2 → 없음
    expect(estimateRefund(300000, 0, 0).amount).toBe(0);
    expect(estimateRefund(325000, 9, 1).amount).toBe(216660); // 10원 단위 버림
  });

  it('수업 횟수: 휴강은 빼고, 사유 발생일 전 수업만 "한 수업"', () => {
    const s = [
      { date: '2026-10-05', status: 'normal' },
      { date: '2026-10-07', status: 'cancelled' },
      { date: '2026-10-12', status: 'absent' },
      { date: '2026-10-14', status: 'normal' },
    ];
    expect(countSessions(s, '2026-10-12')).toEqual({ total: 3, done: 1 });
  });
});

describe('월별 추이·합계 (F-25)', () => {
  const bill = (period: string, amount: number, childId: 'son' | 'daughter', academyId: string): Bill => ({
    title: 't',
    academyId,
    childId,
    period,
    amount,
    dueDate: `${period}-05`,
    payer: 'dad',
    source: 'manual',
  });
  const pay = (billId: string, amount: number, paidOn: string): Payment & { id: string } => ({ id: `p-${billId}`, billId, amount, paidOn, method: 'card', by: 'dad', at: 't' });
  const bills = { b1: bill('2026-09', 300000, 'son', 'a1'), b2: bill('2026-10', 300000, 'son', 'a1'), b3: bill('2026-10', 200000, 'daughter', 'a2') };
  const payments = [pay('b1', 300000, '2026-09-04'), pay('b2', 100000, '2026-10-02')];
  const rows = Object.entries(bills).map(([id, b]) => ({ id, bill: b, state: billState(b, payments.filter((p) => p.billId === id), [], [], [], '2026-10-10') }));

  it('최근 3개월 (오래된 달 먼저)', () => {
    const s = monthlySeries('2026-10', 3, rows, payments, [], [{ date: '2026-10-03', amount: 15000, category: '교재비', childId: 'son' }]);
    expect(s.map((p) => [p.period, p.billed, p.paid, p.cashOut])).toEqual([
      ['2026-08', 0, 0, 0],
      ['2026-09', 300000, 300000, 300000],
      ['2026-10', 500000, 100000, 115000],
    ]);
  });

  it('자녀별·학원별 합계', () => {
    expect(totalsBy(rows, '2026-09', '2026-10', (b) => b.childId)).toEqual([
      { key: 'son', billed: 600000, paid: 400000 },
      { key: 'daughter', billed: 200000, paid: 0 },
    ]);
    expect(totalsBy(rows, '2026-10', '2026-10', (b) => b.academyId).map((t) => t.key)).toEqual(['a1', 'a2']);
  });
});

describe('월간 달력 칸 (S-V3)', () => {
  it('월요일 시작, 주 단위로 꽉 채움', () => {
    const g = monthGrid('2026-10'); // 10/1 = 목요일
    expect(g[0].map((d) => d.date.slice(5))).toEqual(['09-28', '09-29', '09-30', '10-01', '10-02', '10-03', '10-04']);
    expect(g[0].map((d) => d.inMonth)).toEqual([false, false, false, true, true, true, true]);
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g[g.length - 1].some((d) => d.date === '2026-10-31')).toBe(true);
    // 2월(월요일 시작·28일) 은 4주
    expect(monthGrid('2027-02')).toHaveLength(4);
  });
});
