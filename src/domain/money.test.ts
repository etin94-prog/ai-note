import { describe, expect, it } from 'vitest';

import {
  type Bill,
  billState,
  costFor,
  dueDateOf,
  type EnrollmentCost,
  monthSummary,
  parseWon,
  type Payment,
  plannedBills,
  type Receipt,
  type Refund,
  refundState,
  todoItems,
  won,
} from './money';

const TODAY = '2026-11-09';
const P = (billId: string, amount: number, paidOn: string, extra: Partial<Payment> = {}): Payment & { id: string } => ({
  id: `p-${billId}-${paidOn}`,
  billId,
  amount,
  paidOn,
  method: 'card',
  by: 'dad',
  at: `${paidOn}T10:00:00Z`,
  ...extra,
});
const bill = (title: string, childId: 'son' | 'daughter', amount: number, dueDate: string): Bill => ({
  title,
  childId,
  amount,
  dueDate,
  academyId: title,
  period: '2026-11',
  payer: 'dad',
  source: 'enrollment',
});

// 구현계획서 4.2 공통 예시
const bills = {
  math: bill('수학', 'son', 450000, '2026-11-05'),
  eng: bill('영어', 'son', 380000, '2026-11-10'),
  engD: bill('영어', 'daughter', 320000, '2026-11-01'),
  piano: bill('피아노', 'daughter', 150000, '2026-11-01'),
};
const payments = [P('math', 450000, '2026-11-03'), P('piano', 150000, '2026-10-30')];
const pianoRefund: Refund & { id: string } = {
  id: 'r1',
  billId: 'piano',
  causeDate: '2026-11-02',
  requestedOn: '2026-11-02',
  reason: 'withdraw',
  requested: 150000,
};
const receipts: (Receipt & { id: string })[] = [
  { id: 'rc1', refundId: 'r1', billId: 'piano', receivedOn: '2026-11-06', amount: 50000, method: 'transfer', by: 'dad', at: 'x' },
];

function states() {
  return Object.entries(bills).map(([id, b]) => ({
    id,
    bill: b,
    state: billState(
      b,
      payments.filter((p) => p.billId === id),
      [],
      id === 'piano' ? [pianoRefund] : [],
      receipts.filter((r) => r.billId === id),
      TODAY,
    ),
  }));
}

describe('billState (4.2 상태 판정)', () => {
  it('공통 예시의 각 청구 상태', () => {
    const s = Object.fromEntries(states().map((x) => [x.id, x.state]));
    expect(s.math.status).toBe('납부완료');
    expect(s.eng.status).toBe('예정');
    expect(s.engD.status).toBe('미납');
    expect(s.engD.overdue).toBe(true);
    expect(s.piano.status).toBe('환불진행');
    expect(s.piano.refunds[0].state.balance).toBe(100000);
  });

  it('부분 납부·정정(취소 기록 제외)·조정(면제)', () => {
    const b = bill('수학', 'son', 400000, '2026-11-05');
    const ps = [P('x', 100000, '2026-11-01'), P('x', 300000, '2026-11-02', { voided: { by: 'dad', at: 'x', reason: '잘못 입력' } })];
    expect(billState(b, ps, [], [], [], TODAY)).toMatchObject({ status: '부분납부', paid: 100000, remaining: 300000 });
    const adj = [{ billId: 'x', amount: 300000, reason: '퇴원 면제', by: 'dad', at: 'x' }];
    expect(billState(b, ps, adj, [], [], TODAY)).toMatchObject({ status: '납부완료', due: 100000, remaining: 0 });
  });

  it('과납 경고값', () => {
    const b = bill('수학', 'son', 100000, '2026-11-05');
    expect(billState(b, [P('x', 120000, '2026-11-01')], [], [], [], TODAY).overpaid).toBe(20000);
  });
});

describe('refundState (F-16, F-35)', () => {
  it('잔액 0 이면 자동 종결, 수령 취소하면 다시 열림', () => {
    const full: Receipt[] = [{ ...receipts[0], amount: 150000 }];
    expect(refundState(pianoRefund, full)).toMatchObject({ closed: true, closedBy: 'auto', balance: 0 });
    const voided: Receipt[] = [{ ...full[0], voided: { by: 'dad', at: 'x' } }];
    expect(refundState(pianoRefund, voided)).toMatchObject({ closed: false, balance: 150000 });
  });
  it('합의액·수동 종결·법정 기한 참고(+5일)', () => {
    const r = { ...pianoRefund, agreed: 100000 };
    expect(refundState(r, receipts)).toMatchObject({ target: 100000, balance: 50000, legalDue: '2026-11-07' });
    expect(refundState({ ...r, manualClose: { reason: '합의', by: 'dad', at: 'x' } }, receipts).closedBy).toBe('manual');
  });
});

describe('monthSummary (4.2 지표)', () => {
  it('청구 130 · 납부 60 · 남은 70(연체 32) · 환불 미수령 10 · 11월 현금 40', () => {
    const s = monthSummary('2026-11', states(), payments, receipts, []);
    expect(s).toMatchObject({ billed: 1300000, paid: 600000, remaining: 700000, overdue: 320000, refundOpen: 100000, cashOut: 400000 });
  });
});

describe('todoItems (F-32 처리 필요)', () => {
  it('연체 → 환불 → 임박 순서', () => {
    const t = todoItems(states(), TODAY);
    expect(t.map((x) => `${x.kind}:${x.billId}`)).toEqual(['overdue:engD', 'refund:piano', 'dueSoon:eng']);
    expect(t[1].text).toContain('법정기한 참고일 지남');
  });
});

describe('plannedBills (F-01, A-08, A-13)', () => {
  const costs: EnrollmentCost[] = [
    { enrollmentId: 'e1', effectiveFrom: '2026-03-01', amount: 450000, cycle: 'monthly', payDay: 31, timing: 'prepaid' },
    { enrollmentId: 'e1', effectiveFrom: '2026-11-01', amount: 480000, cycle: 'monthly', payDay: 31, timing: 'prepaid' },
  ];
  const e = { id: 'e1', childId: 'son' as const, academyId: 'a', academyName: '수학', startDate: '2026-09-15', status: 'active' as const, payer: 'dad' as const };

  it('적용 시작일별 금액, 말일 보정, 중도 시작 달은 확인 필요', () => {
    const out = plannedBills([e], new Map([['e1', costs]]), '2026-09', '2026-11');
    expect(out.map((o) => [o.id, o.bill.amount, o.bill.dueDate, !!o.bill.needsReview])).toEqual([
      ['e1:2026-09', 450000, '2026-09-30', true],
      ['e1:2026-10', 450000, '2026-10-31', false],
      ['e1:2026-11', 480000, '2026-11-30', false],
    ]);
  });
  it('후납은 다음 달 결제일, 휴원·종료는 생성 안 함', () => {
    const post = costs.map((c) => ({ ...c, timing: 'postpaid' as const, payDay: 5 }));
    expect(plannedBills([e], new Map([['e1', post]]), '2026-10', '2026-10')[0].bill.dueDate).toBe('2026-11-05');
    expect(plannedBills([{ ...e, status: 'paused' }], new Map([['e1', costs]]), '2026-10', '2026-10')).toHaveLength(0);
  });
  it('costFor / dueDateOf', () => {
    expect(costFor(costs, '2026-10')?.amount).toBe(450000);
    expect(dueDateOf('2026-02', 31)).toBe('2026-02-28');
  });
});

describe('금액 표시·입력', () => {
  it('won / parseWon', () => {
    expect(won(320000)).toBe('32만');
    expect(won(325000)).toBe('32.5만');
    expect(won(3500)).toBe('3,500원');
    expect(parseWon('32만')).toBe(320000);
    expect(parseWon('320,000원')).toBe(320000);
    expect(parseWon('32.5만원')).toBe(325000);
    expect(parseWon('삼십만')).toBeNull();
  });
});
