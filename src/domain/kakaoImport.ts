import type { Op } from '@/data/repository';

import type { BillGroup } from './kakao';
import { normalizeName } from './kakao';
import type { Bill, Payment, Receipt, Refund } from './money';
import type { MemberId } from './types';

/** 별칭 (X-22, X-23) — 컬렉션 aliases. 카톡·카드에 적힌 이름 → 자녀·학원 */
export interface Alias {
  kind: 'child' | 'academy';
  text: string;
  /** 자녀 memberId 또는 academyId. 'ignore' 면 가져오지 않음 */
  targetId: string;
}

export const aliasId = (kind: Alias['kind'], text: string) => `${kind}:${normalizeName(text) || text}`;

export interface ImportContext {
  aliases: Alias[];
  academies: { id: string; name: string }[];
  /** 기존 청구 (중복·자동청구 겹침 확인용) */
  bills: { id: string; bill: Bill; version: number }[];
  payerOf: (academyId: string) => MemberId;
  by: string;
  now: string;
}

export type RowStatus = 'new' | 'exists' | 'merge-auto' | 'unmapped' | 'ignored';

export interface ImportRow {
  group: BillGroup;
  childId: MemberId | 'common' | null;
  academyId: string | null;
  status: RowStatus;
  /** merge-auto: 같은 학원·자녀·월의 수강료 자동 청구 */
  existingBillId?: string;
  title: string;
  period: string;
  amount: number;
}

/** 이름 → 대상 (별칭 우선, 학원은 이름이 같거나 포함되면 자동 연결) */
export function resolveChild(name: string, aliases: Alias[]): MemberId | 'ignore' | null {
  const a = aliases.find((x) => x.kind === 'child' && normalizeName(x.text) === normalizeName(name));
  return (a?.targetId as MemberId | 'ignore' | undefined) ?? null;
}

export function resolveAcademy(name: string, aliases: Alias[], academies: { id: string; name: string }[]): string | 'ignore' | null {
  const a = aliases.find((x) => x.kind === 'academy' && normalizeName(x.text) === normalizeName(name));
  if (a) return a.targetId;
  const n = normalizeName(name);
  const hit = academies.find((x) => {
    const m = normalizeName(x.name);
    return m && n && (m === n || m.includes(n) || n.includes(m));
  });
  return hit?.id ?? null;
}

/** 카톡 청구 묶음 → 미리보기 행 */
export function planRows(groups: BillGroup[], ctx: ImportContext): ImportRow[] {
  return groups.map((group) => {
    const f = group.first;
    const child = resolveChild(f.studentName, ctx.aliases);
    const academy = resolveAcademy(f.academyName, ctx.aliases, ctx.academies);
    const academyName = ctx.academies.find((a) => a.id === academy)?.name ?? f.academyName;
    const title = f.item ? f.item : academyName;
    const base = { group, title, period: group.period, amount: f.amount };
    if (child === 'ignore' || academy === 'ignore') return { ...base, childId: null, academyId: null, status: 'ignored' as const };
    if (!child || !academy) return { ...base, childId: child, academyId: academy, status: 'unmapped' as const };
    const id = `kakao:${group.key}`;
    if (ctx.bills.some((b) => b.id === id)) return { ...base, childId: child, academyId: academy, status: 'exists' as const };
    // X-27: 같은 학원·자녀·월의 수강료 자동 청구가 있으면 새로 만들지 않고 금액을 카톡 기준으로
    const auto = ctx.bills.find(
      (b) => b.bill.source === 'enrollment' && b.bill.academyId === academy && b.bill.childId === child && b.bill.period === group.period,
    );
    if (auto && !f.item) return { ...base, childId: child, academyId: academy, status: 'merge-auto' as const, existingBillId: auto.id };
    return { ...base, childId: child, academyId: academy, status: 'new' as const };
  });
}

/** 선택된 행 → 저장 작업 (청구·납부·환불·수령). 문서 id 는 지문 기반이라 다시 가져와도 중복 없음 */
export function buildOps(rows: ImportRow[], ctx: ImportContext, opts: { assumePaidBefore?: string } = {}): Op[] {
  const ops: Op[] = [];
  const R = (o: object) => o as unknown as Record<string, unknown>;
  for (const r of rows) {
    if (r.status !== 'new' && r.status !== 'merge-auto') continue;
    const g = r.group;
    const f = g.first;
    const childId = r.childId as MemberId;
    const academyId = r.academyId!;
    let billId = `kakao:${g.key}`;
    if (r.status === 'merge-auto' && r.existingBillId) {
      const ex = ctx.bills.find((b) => b.id === r.existingBillId)!;
      billId = ex.id;
      if (ex.bill.amount !== f.amount || f.breakdown || f.url) {
        ops.push({
          type: 'update',
          col: 'bills',
          id: billId,
          patch: R({ amount: f.amount, ...(f.breakdown ? { items: f.breakdown } : {}), ...(f.url ? { payUrl: f.url } : {}), needsReview: false }),
          expectVersion: ex.version,
        });
      }
    } else {
      const bill: Bill = {
        title: r.title,
        academyId,
        childId,
        period: g.period,
        amount: f.amount,
        ...(f.breakdown ? { items: f.breakdown } : {}),
        // 기한: 만료일 > 자동결제 일시 > 안내 받은 날
        dueDate: f.dueDate ?? g.autopay?.at?.slice(0, 10) ?? f.date,
        payer: ctx.payerOf(academyId),
        ...(f.url ? { payUrl: f.url } : {}),
        source: 'kakao',
        ...(g.periodSource === 'date' ? { needsReview: true } : {}),
        memo: `카톡 ${f.date} 안내${g.resends.length ? ` (재안내 ${g.resends.length}회)` : ''}${g.autopay?.card ? ` · 자동결제 ${g.autopay.card}` : ''}`,
      };
      ops.push({ type: 'create', col: 'bills', id: billId, data: R(bill) });
      // 지난 청구는 카톡 밖에서 이미 냈을 가능성이 높음 → 선택 시 납부로 기록 (연체 목록이 과거 건으로 가득 차지 않게)
      if (opts.assumePaidBefore && g.paid.length === 0 && g.cancels.length === 0 && bill.dueDate < opts.assumePaidBefore) {
        const pay: Payment = { billId, paidOn: bill.dueDate, amount: f.amount, method: 'etc', by: ctx.by, at: ctx.now, memo: '카톡 가져오기 때 지난 청구라 납부한 것으로 표시' };
        ops.push({ type: 'create', col: 'payments', id: `kakao:assumed:${g.key}`, data: R(pay) });
      }
    }
    // 납부완료 메시지 → 납부 기록 (X-26)
    for (const p of g.paid) {
      const pay: Payment = {
        billId,
        paidOn: (p.at ?? p.date).slice(0, 10),
        amount: p.amount,
        method: 'card',
        card: g.autopay?.card ?? '',
        by: ctx.by,
        at: ctx.now,
        memo: '카톡 납부완료 안내로 기록',
      };
      ops.push({ type: 'create', col: 'payments', id: `kakao:${p.fingerprint}`, data: R(pay) });
    }
    // 결제 취소 → (납부 기록이 없으면 취소로 확인된 납부) + 환불 건 + 수령
    for (const c of g.cancels) {
      if (g.paid.length === 0) {
        const pay: Payment = { billId, paidOn: f.date, amount: c.amount, method: 'card', by: ctx.by, at: ctx.now, memo: '결제 취소 안내로 확인된 납부 (날짜는 청구 안내일)' };
        ops.push({ type: 'create', col: 'payments', id: `kakao:paid-by-cancel:${c.fingerprint}`, data: R(pay) });
      }
      const refundId = `kakao:${c.fingerprint}`;
      const refund: Refund = { billId, causeDate: c.date, requestedOn: c.date, reason: 'etc', requested: c.amount, memo: `결제 취소 (${c.reason ?? '사유 미기재'})` };
      const receipt: Receipt = { refundId, billId, receivedOn: c.date, amount: c.amount, method: 'card', by: ctx.by, at: ctx.now };
      ops.push({ type: 'create', col: 'refunds', id: refundId, data: R(refund) });
      ops.push({ type: 'create', col: 'receipts', id: `kakao:rc:${c.fingerprint}`, data: R(receipt) });
    }
  }
  return ops;
}
