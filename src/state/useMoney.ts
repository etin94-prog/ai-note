import { useEffect, useMemo, useRef } from 'react';

import type { StoredDoc } from '@/data/repository';
import { today } from '@/domain/dates';
import {
  type Adjustment,
  addMonths,
  type Bill,
  billState,
  type BillState,
  type EnrollmentCost,
  type EnrollmentLite,
  type Expense,
  type Payment,
  plannedBills,
  type Receipt,
  type Refund,
} from '@/domain/money';
import type { Academy, Enrollment, PaymentInfo } from '@/domain/types';

import { useRepository } from './RepositoryContext';
import { useCollection } from './useCollection';

export interface BillRow {
  id: string;
  doc: StoredDoc<Bill>;
  bill: Bill;
  state: BillState;
  payments: StoredDoc<Payment>[];
  adjustments: StoredDoc<Adjustment>[];
  refunds: StoredDoc<Refund>[];
  receipts: StoredDoc<Receipt>[];
}

/** 학원비 데이터 묶음 + 계산된 상태 (부모 전용 화면에서만 사용) */
export function useMoney() {
  const bills = useCollection<Bill>('bills');
  const payments = useCollection<Payment>('payments');
  const adjustments = useCollection<Adjustment>('adjustments');
  const refunds = useCollection<Refund>('refunds');
  const receipts = useCollection<Receipt>('receipts');
  const expenses = useCollection<Expense>('expenses');
  const paymentInfos = useCollection<PaymentInfo>('paymentInfos');
  const academies = useCollection<Academy>('academies');
  const t = today();

  const rows: BillRow[] = useMemo(
    () =>
      bills.docs.map((b) => {
        const ps = payments.docs.filter((p) => p.billId === b.id);
        const ad = adjustments.docs.filter((a) => a.billId === b.id);
        const rf = refunds.docs.filter((r) => r.billId === b.id);
        const rc = receipts.docs.filter((r) => r.billId === b.id);
        return { id: b.id, doc: b, bill: b, state: billState(b, ps, ad, rf, rc, t), payments: ps, adjustments: ad, refunds: rf, receipts: rc };
      }),
    [bills.docs, payments.docs, adjustments.docs, refunds.docs, receipts.docs, t],
  );

  const loaded = [bills, payments, adjustments, refunds, receipts, expenses].every((c) => c.loaded);
  return {
    rows,
    loaded,
    payments: payments.docs,
    receipts: receipts.docs,
    expenses: expenses.docs,
    paymentInfos: paymentInfos.docs,
    academies: academies.docs,
  };
}

/**
 * 비용 화면을 열면 지난 2개월 ~ 다음 달 자동 청구를 만든다 (F-01).
 * create(billKey) 는 이미 있으면 아무것도 바꾸지 않으므로 여러 기기에서 동시에 실행해도 안전하다.
 */
export function useEnsureBills() {
  const { repo, writeContext, isChild } = useRepository();
  const enrollments = useCollection<Enrollment>('enrollments');
  const costs = useCollection<EnrollmentCost>('enrollmentCosts');
  const academies = useCollection<Academy>('academies');
  const infos = useCollection<PaymentInfo>('paymentInfos');
  const bills = useCollection<Bill>('bills');
  const running = useRef(false);

  const ready = enrollments.loaded && costs.loaded && academies.loaded && infos.loaded && bills.loaded;
  useEffect(() => {
    if (!repo || isChild || !ready || running.current) return;
    const now = today().slice(0, 7);
    const lite: EnrollmentLite[] = enrollments.docs.flatMap((e) => {
      const a = academies.docs.find((x) => x.id === e.academyId);
      if (!a || a.status !== 'active') return [];
      const payer = infos.docs.find((i) => i.id === e.academyId)?.payer ?? 'dad';
      return [{ id: e.id, childId: e.childId, academyId: e.academyId, academyName: a.name, course: e.course, startDate: e.startDate, endDate: e.endDate || undefined, status: e.status, payer }];
    });
    const byEnrollment = new Map<string, EnrollmentCost[]>();
    for (const c of costs.docs) byEnrollment.set(c.enrollmentId, [...(byEnrollment.get(c.enrollmentId) ?? []), c]);
    const existing = new Set(bills.docs.map((b) => b.id));
    const missing = plannedBills(lite, byEnrollment, addMonths(now, -2), addMonths(now, 1)).filter((p) => !existing.has(p.id));
    if (missing.length === 0) return;
    running.current = true;
    void (async () => {
      try {
        // 한 번에 생성 (GitHub 모드 커밋 1개). 다른 기기가 먼저 만든 청구가 있어 충돌하면
        // 하나씩 create — 이미 있는 청구는 'exists' 로 건너뜀 (기존 금액·납부 보존)
        const ctx = writeContext(`청구 자동 생성 ${missing.length}건 (${missing[0].bill.period}~)`);
        const r = await repo.applyBatch(
          missing.map((m) => ({ type: 'create' as const, col: 'bills' as const, id: m.id, data: m.bill as unknown as Record<string, unknown> })),
          ctx,
        );
        if (!r.ok) for (const m of missing) await repo.create('bills', m.id, m.bill as unknown as Record<string, unknown>, ctx);
      } finally {
        running.current = false;
      }
    })();
  }, [repo, isChild, ready, enrollments.docs, costs.docs, academies.docs, infos.docs, bills.docs, writeContext]);
}
