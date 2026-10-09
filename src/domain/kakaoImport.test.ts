/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MemoryRepository } from '@/data/memory/MemoryRepository';

import { groupBills, parseKakaoExport, parseMessage } from './kakao';
import { type Alias, buildOps, type ImportContext, planRows } from './kakaoImport';
import { type Bill, billState, type Payment, type Receipt, type Refund } from './money';

const items = parseKakaoExport(readFileSync(join(__dirname, '../../fixtures/kakao/결제선생_가상.txt'), 'utf8'))
  .map((m) => parseMessage(m))
  .filter((x) => x !== null);
const { groups } = groupBills(items);

const aliases: Alias[] = [
  { kind: 'child', text: '홍길동(가상고)', targetId: 'son' },
  { kind: 'child', text: '홍길동아빠', targetId: 'son' },
  { kind: 'academy', text: '가나다코딩-본점', targetId: 'acad-coding' },
];
const ctx = (bills: ImportContext['bills'] = []): ImportContext => ({
  aliases,
  academies: [
    { id: 'acad-coding', name: '가나다코딩' },
    { id: 'acad-math', name: '라마바수학' },
  ],
  bills,
  payerOf: () => 'dad',
  by: 'dad',
  now: '2026-10-10T00:00:00Z',
});

describe('planRows', () => {
  it('별칭·학원 이름으로 연결, 모르는 이름은 unmapped', () => {
    const rows = planRows(groups, ctx());
    expect(rows.map((r) => [r.status, r.childId, r.academyId, r.period])).toEqual([
      ['new', 'son', 'acad-coding', '2025-11'],
      ['new', 'son', 'acad-coding', '2025-12'],
      // "라마바수학-라마바수학" → 학원 이름 포함으로 자동 연결
      ['new', 'son', 'acad-math', '2026-08'],
    ]);
    const unknown = planRows(groups, { ...ctx(), aliases: [] });
    expect(unknown.every((r) => r.status === 'unmapped')).toBe(true);
  });

  it('무시로 지정한 이름은 ignored', () => {
    const rows = planRows(groups, { ...ctx(), aliases: [...aliases, { kind: 'academy', text: '라마바수학-라마바수학', targetId: 'ignore' }] });
    expect(rows[2].status).toBe('ignored');
  });
});

describe('buildOps → 저장 결과', () => {
  it('청구·납부·취소(환불+수령)가 만들어지고, 12월분은 납부 후 전액 환불로 종결', async () => {
    const repo = new MemoryRepository();
    const rows = planRows(groups, ctx());
    const r = await repo.applyBatch(buildOps(rows, ctx()), { by: 'dad', label: '카톡 가져오기' });
    expect(r.ok).toBe(true);
    const bills = await repo.list<Bill>('bills');
    const payments = await repo.list<Payment>('payments');
    const refunds = await repo.list<Refund>('refunds');
    const receipts = await repo.list<Receipt>('receipts');
    expect(bills).toHaveLength(3);
    expect(payments).toHaveLength(1);
    expect(refunds).toHaveLength(1);
    const dec = bills.find((b) => b.period === '2025-12')!;
    expect(dec).toMatchObject({ amount: 700000, dueDate: '2025-12-05', source: 'kakao' });
    expect(dec.memo).toContain('자동결제 가상카드 1');
    const st = billState(dec, payments, [], refunds, receipts, '2026-10-10');
    expect(st.status).toBe('환불완료');
    expect(bills.find((b) => b.period === '2026-08')!.dueDate).toBe('2026-08-28');
  });

  it('같은 파일을 다시 가져오면 모두 "이미 있음" — 중복 없음 (X-28)', async () => {
    const repo = new MemoryRepository();
    await repo.applyBatch(buildOps(planRows(groups, ctx()), ctx()), { by: 'dad', label: 'x' });
    const existing = (await repo.list<Bill>('bills')).map((b) => ({ id: b.id, bill: b, version: b.version }));
    const again = planRows(groups, ctx(existing));
    expect(again.every((r) => r.status === 'exists')).toBe(true);
    expect(buildOps(again, ctx(existing))).toHaveLength(0);
  });

  it('지난 청구는 선택 시 납부로 기록 — 납부·취소 안내가 있는 청구는 건드리지 않음', async () => {
    const repo = new MemoryRepository();
    await repo.applyBatch(buildOps(planRows(groups, ctx()), ctx(), { assumePaidBefore: '2026-10-01' }), { by: 'dad', label: 'x' });
    const bills = await repo.list<Bill>('bills');
    const payments = await repo.list<Payment>('payments');
    const refunds = await repo.list<Refund>('refunds');
    const receipts = await repo.list<Receipt>('receipts');
    // 11월분·8월분에 간주 납부 1건씩 + 12월분 실제 납부 1건
    expect(payments).toHaveLength(3);
    for (const b of bills) expect(['납부완료', '환불완료']).toContain(billState(b, payments, [], refunds, receipts, '2026-10-10').status);
  });

  it('같은 학원·자녀·월 수강료 자동 청구가 있으면 새로 만들지 않고 금액 갱신 (X-27)', () => {
    // 품목 없는 학원 안내(형식 B) 를 가정
    const g = { ...groups[0], first: { ...groups[0].first, item: undefined, amount: 410000 } };
    const auto = { id: 'enr1:2025-11', version: 2, bill: { title: '코딩', academyId: 'acad-coding', childId: 'son' as const, period: '2025-11', amount: 400000, dueDate: '2025-11-05', payer: 'dad' as const, source: 'enrollment' as const } };
    const rows = planRows([g], ctx([auto]));
    expect(rows[0]).toMatchObject({ status: 'merge-auto', existingBillId: 'enr1:2025-11' });
    expect(buildOps(rows, ctx([auto]))[0]).toMatchObject({ type: 'update', id: 'enr1:2025-11', patch: { amount: 410000 }, expectVersion: 2 });
  });
});
