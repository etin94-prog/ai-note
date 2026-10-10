import dayjs from 'dayjs';

import { addMonths, type Bill, type BillState, type Expense, monthSummary, type Payment, type Receipt } from './money';

/**
 * Sprint 6 (R1b-2) 계산: 환불 예상액 도우미(F-12), 월별 추이·연간 누적(F-25), 월간 달력 칸(S-V3).
 * 모두 저장하지 않고 기록에서 계산한다.
 */

// ───────────── 환불 예상액 (F-12) ─────────────

export interface RefundEstimate {
  /** 돌려받을 것으로 보이는 금액 (원 단위 버림) */
  amount: number;
  ratio: number;
  rule: string;
}

/**
 * 학원법 시행령 별표 4 의 "교습기간 1개월 이내" 기준을 한 달 청구 1건에 적용한 참고값.
 * 교습 시작 전 전액 / 총 교습의 1/3 경과 전 2/3 / 1/2 경과 전 1/2 / 그 뒤 없음.
 * 실제 금액은 학원 약관·교재비 등에 따라 다르므로 화면에 "참고"로만 보여 준다.
 */
export function estimateRefund(paid: number, totalSessions: number, doneSessions: number): RefundEstimate {
  if (paid <= 0 || totalSessions <= 0) return { amount: 0, ratio: 0, rule: '수업 횟수를 알 수 없어 계산하지 못했습니다' };
  const done = Math.max(0, Math.min(doneSessions, totalSessions));
  let ratio: number;
  let rule: string;
  if (done === 0) [ratio, rule] = [1, '수업 시작 전 → 전액'];
  else if (done * 3 < totalSessions) [ratio, rule] = [2 / 3, '총 수업의 1/3 지나기 전 → 2/3'];
  else if (done * 2 < totalSessions) [ratio, rule] = [1 / 2, '총 수업의 1/2 지나기 전 → 1/2'];
  else [ratio, rule] = [0, '총 수업의 1/2 지난 뒤 → 반환 없음'];
  return { amount: Math.floor((paid * ratio) / 10) * 10, ratio, rule: `${totalSessions}회 중 ${done}회 수업 · ${rule}` };
}

/** 그 달 수업 회차(휴강 제외) 중 사유 발생일 전에 한 수업 수 */
export function countSessions(sessions: { date: string; status: string }[], causeDate: string): { total: number; done: number } {
  const held = sessions.filter((s) => s.status !== 'cancelled');
  return { total: held.length, done: held.filter((s) => s.date < causeDate).length };
}

// ───────────── 월별 추이 (F-25) ─────────────

export interface MonthPoint {
  period: string;
  billed: number;
  paid: number;
  /** 그 달 실제로 나간 돈 (납부 − 환불 수령 + 기타 지출) */
  cashOut: number;
  expenses: number;
}

type Row = { id: string; bill: Bill; state: BillState };

/** endPeriod 까지 n 개월 (오래된 달 먼저) */
export function monthlySeries(endPeriod: string, n: number, rows: Row[], payments: Payment[], receipts: Receipt[], expenses: Expense[]): MonthPoint[] {
  return Array.from({ length: n }, (_, i) => addMonths(endPeriod, i - n + 1)).map((period) => {
    const s = monthSummary(period, rows, payments, receipts, expenses);
    return { period, billed: s.billed, paid: s.paid, cashOut: s.cashOut, expenses: s.expenses };
  });
}

export interface GroupTotal {
  key: string;
  billed: number;
  paid: number;
}

/** 기간 안 청구를 자녀별·학원별로 합산 (취소 청구 제외, 청구액 큰 순) */
export function totalsBy(rows: Row[], from: string, to: string, keyOf: (b: Bill) => string): GroupTotal[] {
  const map = new Map<string, GroupTotal>();
  for (const r of rows) {
    if (r.bill.cancelled || r.bill.period < from || r.bill.period > to) continue;
    const key = keyOf(r.bill);
    const cur = map.get(key) ?? { key, billed: 0, paid: 0 };
    cur.billed += r.state.due;
    cur.paid += r.state.paid;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.billed - a.billed);
}

// ───────────── 월간 달력 (S-V3) ─────────────

/** 그 달 달력 칸 (월요일 시작, 앞뒤 달 날짜 포함한 주 단위) */
export function monthGrid(period: string): { date: string; inMonth: boolean }[][] {
  const first = dayjs(`${period}-01`);
  const start = first.subtract((first.day() + 6) % 7, 'day');
  const last = first.endOf('month');
  const weeks: { date: string; inMonth: boolean }[][] = [];
  for (let d = start; !d.isAfter(last, 'day') || weeks.length === 0 || weeks[weeks.length - 1].length < 7; d = d.add(1, 'day')) {
    if (weeks.length === 0 || weeks[weeks.length - 1].length === 7) {
      if (d.isAfter(last, 'day')) break;
      weeks.push([]);
    }
    weeks[weeks.length - 1].push({ date: d.format('YYYY-MM-DD'), inMonth: d.format('YYYY-MM') === period });
  }
  return weeks;
}
