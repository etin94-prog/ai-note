import dayjs from 'dayjs';

import { addDays } from './dates';
import type { MemberId } from './types';

/**
 * 학원비 기록 도메인 (Requirement 4장, 구현계획서 3.5).
 * 앱은 결제를 하지 않고 기록만 한다 (D-03). 상태·잔액은 저장하지 않고 기록으로부터 계산한다.
 */

export type PayCycle = 'monthly' | 'manual';
export type PayTiming = 'prepaid' | 'postpaid';

/** 수강 비용 조건 — 부모 전용 enrollmentCosts, 적용 시작일별 여러 건 (A-03, A-08) */
export interface EnrollmentCost {
  enrollmentId: string;
  effectiveFrom: string;
  amount: number;
  cycle: PayCycle;
  /** 매월 결제일 (1~31, 말일 초과 시 말일) */
  payDay: number;
  timing: PayTiming;
  memo?: string;
}

/** 청구 1건 — 부모 전용 bills. 자동 생성 청구 id = `${enrollmentId}:${YYYY-MM}` (billKey) */
export interface Bill {
  title: string;
  academyId: string;
  childId: MemberId | 'common';
  enrollmentId?: string;
  /** 대상 월 'YYYY-MM' (청구 기준 집계) */
  period: string;
  amount: number;
  items?: { tuition?: number; books?: number; etc?: number };
  dueDate: string;
  payer: MemberId;
  payUrl?: string;
  source: 'enrollment' | 'manual' | 'kakao' | 'excel';
  needsReview?: boolean;
  cancelled?: boolean;
  memo?: string;
}

export interface Voided {
  by: string;
  at: string;
  reason?: string;
}

export type PayMethod = 'card' | 'transfer' | 'cash' | 'app' | 'local' | 'etc';
export const PAY_METHOD_LABELS: Record<PayMethod, string> = {
  card: '카드',
  transfer: '계좌이체',
  cash: '현금',
  app: '학원 앱',
  local: '지역화폐',
  etc: '기타',
};

/** 납부 기록 — 불변, 정정은 voided (F-34) */
export interface Payment {
  billId: string;
  paidOn: string;
  amount: number;
  method: PayMethod;
  card?: string;
  by: string;
  at: string;
  memo?: string;
  voided?: Voided;
}

/** 청구 조정(감액·면제) (F-19) */
export interface Adjustment {
  billId: string;
  amount: number;
  reason: string;
  by: string;
  at: string;
  voided?: Voided;
}

export type RefundReason = 'withdraw' | 'pause' | 'academy' | 'etc';
export const REFUND_REASON_LABELS: Record<RefundReason, string> = {
  withdraw: '퇴원',
  pause: '휴원',
  academy: '학원 사정',
  etc: '기타',
};

/** 환불 건 (F-11, F-16, F-18). 자동 종결은 저장하지 않고 계산 (F-35) */
export interface Refund {
  billId: string;
  causeDate: string;
  requestedOn: string;
  reason: RefundReason;
  requested: number;
  agreed?: number | null;
  manualClose?: { reason: string; by: string; at: string } | null;
  withdrawn?: boolean;
  memo?: string;
}

/** 환불 수령 기록 — 불변 (F-13) */
export interface Receipt {
  refundId: string;
  billId: string;
  receivedOn: string;
  amount: number;
  method: PayMethod;
  by: string;
  at: string;
  voided?: Voided;
}

export interface Expense {
  date: string;
  amount: number;
  category: string;
  childId: MemberId | 'common';
  academyId?: string;
  memo?: string;
}

export const DEFAULT_EXPENSE_CATEGORIES = ['교재비', '특강', '모의고사·시험', '교통비', '간식·식비', '준비물', '기타'];

// ───────────────────────── 금액 표시 ─────────────────────────

/** 320000 → '32만', 325000 → '32.5만', 3500 → '3,500원' */
export function won(n: number): string {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 10000) {
    const man = a / 10000;
    return `${sign}${Number.isInteger(man) ? man : man.toFixed(1).replace(/\.0$/, '')}만`;
  }
  return `${sign}${a.toLocaleString('ko-KR')}원`;
}
export const wonFull = (n: number) => `${n.toLocaleString('ko-KR')}원`;

/** '32만', '320,000원', '32.5만원', '320000' → 320000 */
export function parseWon(s: string): number | null {
  const t = s.replace(/[\s,원]/g, '');
  const m = /^(\d+(?:\.\d+)?)(만)?$/.exec(t);
  if (!m) return null;
  const v = Number(m[1]) * (m[2] ? 10000 : 1);
  return Number.isFinite(v) ? Math.round(v) : null;
}

// ───────────────────────── 청구 자동 생성 (F-01, A-08) ─────────────────────────

export const billKey = (enrollmentId: string, period: string) => `${enrollmentId}:${period}`;

/** 해당 월의 결제일 (말일 보정) */
export function dueDateOf(period: string, payDay: number): string {
  const end = dayjs(`${period}-01`).endOf('month').date();
  return `${period}-${String(Math.min(Math.max(payDay, 1), end)).padStart(2, '0')}`;
}

export const addMonths = (period: string, n: number) => dayjs(`${period}-01`).add(n, 'month').format('YYYY-MM');

/** period 에 적용되는 비용 조건 (적용 시작일이 그 달 말일 이전인 것 중 가장 최근) */
export function costFor(costs: EnrollmentCost[], period: string): EnrollmentCost | undefined {
  const monthEnd = dayjs(`${period}-01`).endOf('month').format('YYYY-MM-DD');
  return [...costs].filter((c) => c.effectiveFrom <= monthEnd).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
}

export interface EnrollmentLite {
  id: string;
  childId: MemberId;
  academyId: string;
  academyName: string;
  course?: string;
  startDate: string;
  endDate?: string;
  status: 'active' | 'paused' | 'ended';
  payer: MemberId;
}

/**
 * 기간 [fromPeriod, toPeriod] 의 자동 청구 후보. 저장은 create(billKey) — 이미 있으면 건드리지 않음.
 * 휴원·종료 수강은 생성하지 않음. 첫 달·마지막 달이 한 달 전체가 아니면 확인 필요 (A-13).
 */
export function plannedBills(
  enrollments: EnrollmentLite[],
  costsByEnrollment: Map<string, EnrollmentCost[]>,
  fromPeriod: string,
  toPeriod: string,
): { id: string; bill: Bill }[] {
  const out: { id: string; bill: Bill }[] = [];
  for (const e of enrollments) {
    if (e.status !== 'active') continue;
    const costs = costsByEnrollment.get(e.id) ?? [];
    for (let p = fromPeriod; p <= toPeriod; p = addMonths(p, 1)) {
      const monthStart = `${p}-01`;
      const monthEnd = dayjs(monthStart).endOf('month').format('YYYY-MM-DD');
      if (e.startDate > monthEnd) continue;
      if (e.endDate && e.endDate < monthStart) continue;
      const cost = costFor(costs, p);
      if (!cost || cost.cycle !== 'monthly' || cost.amount <= 0) continue;
      const partial = e.startDate > monthStart || (!!e.endDate && e.endDate < monthEnd);
      const duePeriod = cost.timing === 'postpaid' ? addMonths(p, 1) : p;
      out.push({
        id: billKey(e.id, p),
        bill: {
          title: `${e.academyName}${e.course ? ` ${e.course}` : ''}`,
          academyId: e.academyId,
          childId: e.childId,
          enrollmentId: e.id,
          period: p,
          amount: cost.amount,
          dueDate: dueDateOf(duePeriod, cost.payDay),
          payer: e.payer,
          source: 'enrollment',
          ...(partial ? { needsReview: true } : {}),
        },
      });
    }
  }
  return out;
}

// ───────────────────────── 상태·잔액 (4.2, F-16, F-35) ─────────────────────────

export const valid = <T extends { voided?: Voided }>(xs: T[]) => xs.filter((x) => !x.voided);
const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);

export interface RefundState {
  received: number;
  target: number;
  balance: number;
  closed: boolean;
  closedBy: 'auto' | 'manual' | 'withdrawn' | null;
  /** 법정 반환 기한 참고 = 사유 발생일 + 5일 (F-17) */
  legalDue: string;
}

export function refundState(r: Refund, receipts: Receipt[]): RefundState {
  const received = sum(valid(receipts));
  const target = r.agreed ?? r.requested;
  const balance = target - received;
  const closedBy = r.withdrawn ? 'withdrawn' : r.manualClose ? 'manual' : balance <= 0 ? 'auto' : null;
  return { received, target, balance, closed: closedBy !== null, closedBy, legalDue: addDays(r.causeDate, 5) };
}

export type BillStatus = '취소' | '환불진행' | '환불완료' | '납부완료' | '부분납부' | '미납' | '예정';

export interface BillState {
  status: BillStatus;
  paid: number;
  adjusted: number;
  /** 낼 돈 = 금액 − 조정 */
  due: number;
  remaining: number;
  overdue: boolean;
  overpaid: number;
  refunds: { refund: Refund & { id: string }; state: RefundState }[];
}

export function billState(
  bill: Bill,
  payments: Payment[],
  adjustments: Adjustment[],
  refunds: (Refund & { id: string })[],
  receipts: (Receipt & { id: string })[],
  today: string,
): BillState {
  const paid = sum(valid(payments));
  const adjusted = sum(valid(adjustments));
  const due = Math.max(0, bill.amount - adjusted);
  const remaining = Math.max(0, due - paid);
  const overpaid = Math.max(0, paid - due);
  const rs = refunds.map((refund) => ({ refund, state: refundState(refund, receipts.filter((x) => x.refundId === refund.id)) }));
  const activeRefunds = rs.filter((r) => !r.refund.withdrawn);
  let status: BillStatus;
  if (bill.cancelled) status = '취소';
  else if (activeRefunds.some((r) => !r.state.closed)) status = '환불진행';
  else if (activeRefunds.length > 0) status = '환불완료';
  else if (paid >= due) status = '납부완료';
  else if (paid > 0) status = '부분납부';
  else if (bill.dueDate < today) status = '미납';
  else status = '예정';
  const overdue = !bill.cancelled && remaining > 0 && bill.dueDate < today;
  return { status, paid, adjusted, due, remaining, overdue, overpaid, refunds: rs };
}

// ───────────────────────── 집계 (F-23, F-24, F-32) ─────────────────────────

export interface MonthSummary {
  billed: number;
  paid: number;
  remaining: number;
  overdue: number;
  refundOpen: number;
  /** 현금 기준: 그 달 실제 납부 − 환불 수령 + 기타 지출 */
  cashOut: number;
  expenses: number;
}

export function monthSummary(
  period: string,
  bills: { bill: Bill; state: BillState }[],
  allPayments: Payment[],
  allReceipts: Receipt[],
  expenses: Expense[],
): MonthSummary {
  const inMonth = bills.filter((b) => b.bill.period === period && !b.bill.cancelled);
  const inP = (d: string) => d.startsWith(period);
  const exp = sum(expenses.filter((e) => inP(e.date)));
  return {
    billed: inMonth.reduce((s, b) => s + b.state.due, 0),
    paid: inMonth.reduce((s, b) => s + b.state.paid, 0),
    remaining: inMonth.reduce((s, b) => s + b.state.remaining, 0),
    overdue: inMonth.filter((b) => b.state.overdue).reduce((s, b) => s + b.state.remaining, 0),
    refundOpen: bills.reduce((s, b) => s + b.state.refunds.filter((r) => !r.state.closed).reduce((t, r) => t + Math.max(0, r.state.balance), 0), 0),
    cashOut: sum(valid(allPayments).filter((p) => inP(p.paidOn))) - sum(valid(allReceipts).filter((r) => inP(r.receivedOn))) + exp,
    expenses: exp,
  };
}

export type TodoKind = 'overdue' | 'dueSoon' | 'refund' | 'review';
export interface TodoItem {
  kind: TodoKind;
  billId: string;
  title: string;
  amount: number;
  date: string;
  payer: MemberId;
  childId: MemberId | 'common';
  text: string;
}

/** 처리 필요 — 기간 무관 (F-32): 연체, 3일 이내 기한, 미종결 환불, 확인 필요 청구 */
export function todoItems(bills: { id: string; bill: Bill; state: BillState }[], today: string): TodoItem[] {
  const out: TodoItem[] = [];
  const soon = addDays(today, 3);
  for (const { id, bill, state } of bills) {
    if (bill.cancelled) continue;
    const base = { billId: id, title: bill.title, payer: bill.payer, childId: bill.childId };
    if (state.remaining > 0 && state.status !== '환불진행' && state.status !== '환불완료') {
      if (bill.dueDate < today) {
        const days = dayjs(today).diff(bill.dueDate, 'day');
        out.push({ ...base, kind: 'overdue', amount: state.remaining, date: bill.dueDate, text: `${Number(bill.period.slice(5))}월분 연체 D+${days}` });
      } else if (bill.dueDate <= soon) {
        const days = dayjs(bill.dueDate).diff(today, 'day');
        out.push({ ...base, kind: 'dueSoon', amount: state.remaining, date: bill.dueDate, text: `${Number(bill.period.slice(5))}월분 ${days === 0 ? '오늘' : `D-${days}`}` });
      }
    }
    for (const r of state.refunds) {
      if (r.state.closed) continue;
      const days = dayjs(today).diff(r.refund.requestedOn, 'day');
      const legal = r.state.legalDue < today ? ' · 법정기한 참고일 지남' : '';
      out.push({ ...base, kind: 'refund', amount: r.state.balance, date: r.refund.requestedOn, text: `환불 잔액 · ${days}일째${legal}` });
    }
    if (bill.needsReview && state.paid === 0) {
      out.push({ ...base, kind: 'review', amount: bill.amount, date: bill.dueDate, text: `${Number(bill.period.slice(5))}월분 금액 확인 필요(중도 시작·종료)` });
    }
  }
  const order: Record<TodoKind, number> = { overdue: 0, refund: 1, dueSoon: 2, review: 3 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || (a.date < b.date ? -1 : 1));
}
