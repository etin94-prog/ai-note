/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MemoryRepository } from '@/data/memory/MemoryRepository';
import { buildWorkbook, readWorkbook } from '@/io/excel/workbook';

import { buildCardOps, type CardTxn, decodeText, matchTxns, type OpenBill, parseCardSms, parseCardTable, parseCsv } from './card';
import type { Payment } from './money';

const T = '2026-10-10';
// 실제 카드사 파일 구조만 본뜬 가상 데이터
const file = readFileSync(join(__dirname, '../../fixtures/card/가상카드_이용내역.csv'));
const csv = decodeText(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);

const academies = [
  { id: 'a-coding', name: '가나다코딩' },
  { id: 'a-math', name: '라마바수학' },
  { id: 'a-edu', name: '가상에듀학원' },
];
const bills: OpenBill[] = [
  { id: 'b-coding-10', label: '아들 코딩 10월분', academyId: 'a-coding', dueDate: '2026-10-05', due: 700000, remaining: 700000 },
  { id: 'b-math-10', label: '아들 수학 10월분', academyId: 'a-math', dueDate: '2026-10-05', due: 630000, remaining: 630000 },
  { id: 'b-math-11', label: '아들 수학 11월분', academyId: 'a-math', dueDate: '2026-11-05', due: 630000, remaining: 630000 },
  { id: 'b-edu-10', label: '딸 에듀 10월분', academyId: 'a-edu', dueDate: '2026-10-01', due: 300000, remaining: 300000 },
];

describe('카드 이용내역 파일 (C-01)', () => {
  it('제목 줄을 건너뛰고 머리글을 찾아 거래를 읽는다', () => {
    const p = parseCardTable(parseCsv(csv), T)!;
    expect(p.skipped).toBe(0);
    expect(p.txns.map((t) => [t.date, t.time, t.merchant, t.amount, t.cancelled, t.card])).toEqual([
      ['2026-10-05', '10:23', '가나다코딩-본점', 700000, false, '가상카드 1'],
      ['2026-10-05', '12:40', '가상편의점', 4500, false, '가상카드 1'],
      ['2026-10-06', '09:00', '라마바수학', 630000, false, '가상카드 1'],
      ['2026-10-07', '18:10', '(주)가상에듀', 300000, false, '가상카드 2'],
      ['2026-10-08', '11:00', '가나다코딩-본점', 700000, true, '가상카드 1'],
      ['2026-10-09', '19:30', '가상식당', 32000, false, '가상카드 2'],
    ]);
    // 같은 파일을 다시 읽어도 지문이 같다
    expect(parseCardTable(parseCsv(csv), T)!.txns.map((t) => t.fingerprint)).toEqual(p.txns.map((t) => t.fingerprint));
  });

  it('엑셀(.xlsx) 파일도 같은 결과 — 날짜 셀·숫자 금액', async () => {
    const rows = parseCsv(csv);
    const header = rows.findIndex((r) => r[0] === '이용일자');
    const typed = rows.map((r, i) =>
      i > header && r[0]
        ? [new Date(Date.UTC(2026, 9, Number(r[0].slice(8)))), r[1], r[2], r[3], Number(r[4].replace(/,/g, '')), r[5], r[6], r[7]]
        : r,
    );
    const buf = await buildWorkbook(
      [{ name: '이용내역', headers: typed[0] as string[], rows: typed.slice(1) }],
      { exportedAt: '', mode: '', by: '' },
      {},
    );
    const { tables } = await readWorkbook(buf);
    const t = tables.find((x) => x.name === '이용내역')!;
    const p = parseCardTable([t.headers, ...t.rows], T)!;
    expect(p.txns.map((x) => [x.date, x.amount, x.cancelled])).toEqual(
      parseCardTable(parseCsv(csv), T)!.txns.map((x) => [x.date, x.amount, x.cancelled]),
    );
  });
});

describe('승인 문자 (C-02)', () => {
  it('승인·승인취소 문자', () => {
    const r = parseCardSms(
      '[Web발신]\n가상카드(1234)승인\n홍*동\n700,000원 일시불\n10/05 10:23 가나다코딩-본점\n누적1,234,000원\n\n[Web발신] 가상카드(1234) 승인취소 700,000원 10/08 11:00 가나다코딩-본점',
      T,
    );
    expect(r.map((t) => [t.card, t.date, t.time, t.amount, t.merchant, t.cancelled])).toEqual([
      ['가상카드(1234)', '2026-10-05', '10:23', 700000, '가나다코딩-본점', false],
      ['가상카드(1234)', '2026-10-08', '11:00', 700000, '가나다코딩-본점', true],
    ]);
  });
  it('결제와 무관한 글은 빈 결과', () => {
    expect(parseCardSms('오늘 저녁 늦어요', T)).toEqual([]);
  });
});

describe('청구와 짝짓기 (C-01, C-03)', () => {
  const txns = parseCardTable(parseCsv(csv), T)!.txns;
  const ctx = { bills, paidBills: [] as OpenBill[], aliases: [], academies, existing: new Set<string>() };

  it('금액 + 기간 + 가맹점 이름으로 짝짓고, 학원이 아닌 거래는 무시', () => {
    const rows = matchTxns(txns, ctx);
    expect(rows.map((r) => [r.txn.merchant, r.status, r.billId])).toEqual([
      ['가나다코딩-본점', 'match', 'b-coding-10'],
      ['가상편의점', 'other', undefined],
      // 10월분·11월분 중 기간 안의 10월분
      ['라마바수학', 'match', 'b-math-10'],
      // '(주)가상에듀' → 등록 이름 '가상에듀학원' 과 이름이 겹쳐 자동 연결
      ['(주)가상에듀', 'match', 'b-edu-10'],
      ['가나다코딩-본점', 'cancel', undefined],
      ['가상식당', 'other', undefined],
    ]);
  });

  it('모르는 학원 가맹점은 이름 연결 필요 → 별칭 저장 후 자동 연결, 이미 가져온 거래는 "이미 있음"', () => {
    const t: CardTxn = { ...txns[3], merchant: '하늘빛교육센터', fingerprint: 'card:sky' };
    expect(matchTxns([t], ctx)[0].status).toBe('unknown');
    const rows = matchTxns([t, txns[0]], {
      ...ctx,
      aliases: [{ kind: 'academy', text: '하늘빛교육센터', targetId: 'a-edu' }],
      existing: new Set([txns[0].fingerprint]),
    });
    expect(rows[0]).toMatchObject({ status: 'match', billId: 'b-edu-10' });
    expect(rows[1].status).toBe('exists');
    // 짧은 낱말만 겹치면('코딩') 자동 연결하지 않고 물어본다
    expect(matchTxns([{ ...t, merchant: '하늘코딩교실' }], { ...ctx, academies: [{ id: 'a-c', name: '코딩학원' }] })[0].status).toBe('unknown');
    expect(matchTxns([{ ...t, merchant: '코딩학원', amount: 1 }], { ...ctx, academies: [{ id: 'a-c', name: '코딩학원' }] })[0].academyId).toBe('a-c');
    // 학원 같지 않은 이름이라도 열린 청구와 금액이 같으면 물어본다
    expect(matchTxns([{ ...t, merchant: '가상페이*결제' }], ctx)[0].status).toBe('unknown');
  });

  it('금액이 다르면 바로 짝짓지 않고 고르게 함 (부분납부·확인 필요)', () => {
    const t: CardTxn = { ...txns[2], amount: 600000, fingerprint: 'card:x' };
    const r = matchTxns([t], ctx)[0];
    expect(r.status).toBe('choose');
    expect(r.billId).toBeUndefined();
    expect(r.candidates.map((c) => c.id)).toEqual(['b-math-10', 'b-math-11']);
  });

  it('같은 금액 청구가 이미 납부 완료면 "이미 기록됨"', () => {
    const paid = { ...bills[0], remaining: 0 };
    const r = matchTxns([txns[0]], { ...ctx, bills: bills.slice(1), paidBills: [paid] });
    expect(r[0].status).toBe('already');
  });

  it('납부 기록 + 카드 거래 기록 저장, 다시 저장해도 중복 없음', async () => {
    const repo = new MemoryRepository();
    const rows = matchTxns(txns, ctx).filter((r) => r.status === 'match');
    const ops = buildCardOps(
      rows.map((row) => ({ row, billId: row.billId! })),
      { by: 'dad', now: 'now' },
    );
    expect((await repo.applyBatch(ops, { by: 'dad', label: 'x' })).ok).toBe(true);
    const pays = await repo.list<Payment>('payments');
    expect(pays.map((p) => [p.billId, p.amount, p.method, p.card])).toEqual([
      ['b-coding-10', 700000, 'card', '가상카드 1'],
      ['b-math-10', 630000, 'card', '가상카드 1'],
      ['b-edu-10', 300000, 'card', '가상카드 2'],
    ]);
    expect(await repo.create('payments', ops[0].id, {}, { by: 'dad', label: 'x' })).toBe('exists');
  });
});
