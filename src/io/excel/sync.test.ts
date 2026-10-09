import { describe, expect, it } from 'vitest';

import { MemoryRepository } from '@/data/memory/MemoryRepository';
import { type Collection, PRIVATE_COLLECTIONS, PUBLIC_COLLECTIONS } from '@/data/repository';
import { billState, type Bill, type Payment, type Receipt, type Refund } from '@/domain/money';

import { parseDate, parseMoney, parseSlots, parseTime, parseWeekdays } from './cells';
import { buildImportOps, type Data, defaultChoices, exportTables, planImport, refOptions, type Table } from './sync';
import { buildWorkbook, readWorkbook } from './workbook';

const ctx = { by: 'dad', label: 'test' };
let n = 0;
const newId = () => `new${++n}`;

async function seed() {
  const repo = new MemoryRepository();
  await repo.applyBatch(
    [
      { type: 'create', col: 'academies', id: 'a1', data: { name: '가나다수학', subject: '수학', status: 'active' } },
      { type: 'create', col: 'paymentInfos', id: 'a1', data: { academyId: 'a1', payType: 'monthlyLink', payer: 'dad' } },
      { type: 'create', col: 'enrollments', id: 'e1', data: { childId: 'son', academyId: 'a1', course: '정규반', slots: [{ weekday: 1, start: '19:00', end: '21:00' }, { weekday: 3, start: '19:00', end: '21:00' }], startDate: '2026-03-02', status: 'active' } },
      { type: 'create', col: 'enrollments', id: 'e2', data: { childId: 'daughter', academyId: 'a1', course: '중등반', slots: [], startDate: '2026-03-02', status: 'paused' } },
      { type: 'create', col: 'enrollmentCosts', id: 'c1', data: { enrollmentId: 'e1', effectiveFrom: '2026-03-01', amount: 320000, cycle: 'monthly', payDay: 5, timing: 'prepaid' } },
      { type: 'create', col: 'bills', id: 'e1:2026-03', data: { title: '가나다수학 정규반', academyId: 'a1', childId: 'son', enrollmentId: 'e1', period: '2026-03', amount: 320000, items: { tuition: 300000, books: 20000 }, dueDate: '2026-03-05', payer: 'dad', source: 'enrollment' } },
      { type: 'create', col: 'payments', id: 'p1', data: { billId: 'e1:2026-03', paidOn: '2026-03-04', amount: 320000, method: 'card', by: 'dad', at: 't' } },
      { type: 'create', col: 'refunds', id: 'r1', data: { billId: 'e1:2026-03', causeDate: '2026-03-20', requestedOn: '2026-03-21', reason: 'withdraw', requested: 160000, agreed: null } },
      { type: 'create', col: 'receipts', id: 'rc1', data: { refundId: 'r1', billId: 'e1:2026-03', receivedOn: '2026-03-25', amount: 100000, method: 'transfer', by: 'dad', at: 't' } },
      { type: 'create', col: 'receipts', id: 'rc2', data: { refundId: 'r1', billId: 'e1:2026-03', receivedOn: '2026-03-28', amount: 60000, method: 'transfer', by: 'dad', at: 't' } },
      { type: 'create', col: 'events', id: 'ev1', data: { kind: 'meeting', title: '반 모임', targets: ['daughter'], date: '2026-03-14', start: '14:00', end: '16:00', checklist: ['회비'], createdBy: 'mom' } },
      { type: 'create', col: 'exceptions', id: 'enrollment:e1@2026-03-09T19:00', data: { occurrenceKey: 'enrollment:e1@2026-03-09T19:00', status: 'cancelled', reason: '학원 사정' } },
      { type: 'create', col: 'holidays', id: 'h1', data: { name: '여름방학', memberIds: ['son', 'daughter'], start: '2026-07-20', end: '2026-08-16', skipSchool: true, skipClass: false } },
      { type: 'create', col: 'places', id: 'pl1', data: { name: '집' } },
    ],
    ctx,
  );
  return repo;
}

async function dataOf(repo: MemoryRepository): Promise<Data> {
  const out: Data = {};
  for (const c of [...PUBLIC_COLLECTIONS, ...PRIVATE_COLLECTIONS] as Collection[]) out[c] = await repo.list(c);
  return out;
}

async function roundTrip(data: Data, edit?: (t: Table[]) => void) {
  const tables = exportTables(data, { parent: true });
  edit?.(tables);
  const buf = await buildWorkbook(tables, { exportedAt: '2026-10-10 10:00', mode: 'GitHub', by: '아빠' }, refOptions(data));
  return readWorkbook(buf);
}

const T = (tables: Table[], name: string) => tables.find((t) => t.name === name)!;
const colOf = (t: Table, h: string) => t.headers.indexOf(h);

describe('셀 변환 (I-13)', () => {
  it('해석 가능한 변형은 고치고 경고', () => {
    expect(parseWeekdays('월수금')).toEqual({ ok: true, value: [1, 3, 5], warn: "'월수금' → 월,수,금" });
    expect(parseMoney('32만')).toMatchObject({ ok: true, value: 320000 });
    expect(parseMoney('삼십만')).toMatchObject({ ok: false });
    expect(parseDate('2026.3.5')).toMatchObject({ ok: true, value: '2026-03-05' });
    expect(parseDate(new Date(Date.UTC(2026, 2, 5)))).toMatchObject({ value: '2026-03-05' });
    expect(parseTime('오후 7시 30분')).toMatchObject({ value: '19:30' });
    expect(parseTime(0.8125)).toMatchObject({ value: '19:30' });
    expect(parseSlots('월수 7시~9시')).toMatchObject({
      ok: true,
      value: [
        { weekday: 1, start: '19:00', end: '21:00' },
        { weekday: 3, start: '19:00', end: '21:00' },
      ],
    });
  });
});

describe('엑셀 왕복 (S0-7, I-18)', { timeout: 30_000 }, () => {
  it('내보낸 파일을 그대로 가져오면 모두 "변경 없음", 파일에 없음 0', async () => {
    const data = await dataOf(await seed());
    const { tables, info } = await roundTrip(data);
    expect(info).toMatchObject({ kind: '우리집 학원 노트 동기화 파일', schema: 1, mode: 'GitHub', purpose: '동기화' });
    const plan = planImport(tables, data, { parent: true, newId });
    const notSame = plan.items.filter((i) => i.status !== 'same');
    expect(notSame.map((i) => [i.sheet, i.status, i.errors, i.changes])).toEqual([]);
    expect(plan.items.length).toBe(14);
    expect(plan.missing).toEqual([]);
    expect(plan.ignored).toEqual([]);
  });

  it('자녀용 내보내기에는 비용 시트가 없음', () => {
    const names = exportTables({}, { parent: false }).map((t) => t.name);
    expect(names).not.toContain('청구');
    expect(names).not.toContain('납부정보');
    expect(names).toContain('수강');
  });
});

describe('가져오기 비교 규칙 (구현계획서 3.8)', { timeout: 30_000 }, () => {
  it('수정·충돌·신규·중복 후보·오류·파일에 없음 + 반영 + 되돌리기', async () => {
    const repo = await seed();
    const before = await dataOf(repo);
    const { tables } = await roundTrip(before, (ts) => {
      const bills = T(ts, '청구');
      bills.rows[0][colOf(bills, '금액')] = '33만'; // 수정
      const ev = T(ts, '일정');
      ev.rows[0][colOf(ev, '제목')] = '반 모임(변경)'; // 앱에서도 수정됨 → 충돌
      const ac = T(ts, '학원');
      ac.rows.push(ac.headers.map((h) => ({ 학원명: '라마바영어', 과목: '영어' })[h] ?? null)); // 신규
      ac.rows.push(ac.headers.map((h) => ({ 학원명: '가나다수학' })[h] ?? null)); // 중복 후보
      const en = T(ts, '수강');
      // 새 학원을 이름으로 참조하는 새 수강 + 요일 변형
      en.rows.push(en.headers.map((h) => ({ 자녀: '딸', 학원: '라마바영어', 과정: '중등', 시간표: '화목 5시~7시', 시작일: '2026.4.1' })[h] ?? null));
      en.rows.push(en.headers.map((h) => ({ 자녀: '딸', 학원: '없는학원', 시작일: '2026-04-01' })[h] ?? null)); // 오류
      const pay = T(ts, '납부');
      pay.rows[0][colOf(pay, '금액')] = 330000; // 불변 기록 수정 → 정정 + 새 기록
      const pl = T(ts, '장소');
      pl.rows.splice(0, 1); // 파일에서 지움
    });
    // 내보낸 뒤 앱에서 일정 수정
    await repo.update('events', 'ev1', { memo: '앱에서 수정' }, 1, ctx);
    const data = await dataOf(repo);

    const plan = planImport(tables, data, { parent: true, newId });
    const by = (sheet: string) => plan.items.filter((i) => i.sheet === sheet && i.status !== 'same').map((i) => i.status);
    expect(by('청구')).toEqual(['update']);
    expect(plan.items.find((i) => i.sheet === '청구')!.changes).toEqual([{ field: '금액', from: '320000', to: '330000' }]);
    expect(plan.items.find((i) => i.sheet === '청구')!.warnings[0]).toContain('33만');
    expect(by('일정')).toEqual(['conflict']);
    expect(by('학원')).toEqual(['new', 'dup']);
    expect(by('수강')).toEqual(['new', 'error']);
    const err = plan.items.find((i) => i.status === 'error')!;
    expect(err.rowNo).toBe(5);
    expect(err.errors[0]).toContain("'없는학원'");
    expect(plan.items.find((i) => i.sheet === '수강' && i.status === 'new')!.warnings.join()).toContain('오후로 추정');
    expect(by('납부')).toEqual(['update']);
    expect(plan.missing.map((m) => [m.sheet, m.label])).toEqual([['장소', '집']]);

    const choices = defaultChoices(plan);
    // 충돌은 기본 앱 값 유지, 중복 후보는 건너뜀, 파일에 없음은 지우지 않음
    const r = buildImportOps(plan, choices, data, { by: 'mom', now: 'now', newId });
    expect(r.counts).toEqual({ create: 2, update: 2, remove: 0 });
    const res = await repo.applyBatch(r.ops, { by: 'mom', label: '엑셀 가져오기' });
    expect(res.ok).toBe(true);

    const bill = (await repo.get<Bill>('bills', 'e1:2026-03'))!;
    expect(bill.amount).toBe(330000);
    expect(bill.items).toEqual({ tuition: 300000, books: 20000 });
    const pays = await repo.list<Payment>('payments');
    expect(pays.find((p) => p.id === 'p1')!.voided).toMatchObject({ reason: '엑셀에서 수정' });
    expect(pays.filter((p) => !p.voided).map((p) => p.amount)).toEqual([330000]);
    const newAcademy = (await repo.list<{ name: string }>('academies')).find((a) => a.name === '라마바영어')!;
    const newEnroll = (await repo.list<{ academyId: string; slots: unknown[] }>('enrollments')).find((e) => e.academyId === newAcademy.id)!;
    expect(newEnroll.slots).toHaveLength(2);
    expect((await repo.get<{ title: string }>('events', 'ev1'))!.title).toBe('반 모임');
    // 환불 1건 + 수령 2건 그대로 → 환불완료
    const st = billState(bill, pays, [], await repo.list<Refund>('refunds'), await repo.list<Receipt>('receipts'), '2026-10-10');
    expect(st.refunds[0].state.received).toBe(160000);

    // 되돌리기
    await repo.revertBatch(res.batchId, { by: 'mom', label: '되돌리기' });
    expect((await repo.get<Bill>('bills', 'e1:2026-03'))!.amount).toBe(320000);
    expect((await repo.list<{ name: string }>('academies')).some((a) => a.name === '라마바영어')).toBe(false);
    expect((await repo.get<Payment>('payments', 'p1'))!.voided).toBeUndefined();
  });

  it('충돌에서 파일 값 선택, 중복 후보 추가, 파일에 없음 삭제, 참조 대상 제외 시 함께 제외', async () => {
    const repo = await seed();
    const data0 = await dataOf(repo);
    const { tables } = await roundTrip(data0, (ts) => {
      const ev = T(ts, '일정');
      ev.rows[0][colOf(ev, '제목')] = '파일 제목';
      const ac = T(ts, '학원');
      ac.rows.push(ac.headers.map((h) => ({ 학원명: '새학원' })[h] ?? null));
      const en = T(ts, '수강');
      en.rows.push(en.headers.map((h) => ({ 자녀: '딸', 학원: '새학원', 시작일: '2026-04-01' })[h] ?? null));
      const pl = T(ts, '장소');
      pl.rows.splice(0, 1);
    });
    await repo.update('events', 'ev1', { memo: 'x' }, 1, ctx);
    const data = await dataOf(repo);
    const plan = planImport(tables, data, { parent: true, newId });
    const choices = defaultChoices(plan);
    choices[plan.items.find((i) => i.status === 'conflict')!.key] = true;
    choices[plan.missing[0].key] = true;
    choices[plan.items.find((i) => i.sheet === '학원' && i.status === 'new')!.key] = false;
    const r = buildImportOps(plan, choices, data, { by: 'dad', now: 'now', newId });
    expect(r.dropped.map((d) => d.item.sheet)).toEqual(['수강']);
    await repo.applyBatch(r.ops, ctx);
    expect((await repo.get<{ title: string }>('events', 'ev1'))!.title).toBe('파일 제목');
    expect(await repo.get('places', 'pl1')).toBeUndefined();
  });

  it('빈 양식: 예시 행은 가져오지 않음', async () => {
    const tables = exportTables({}, { parent: true, template: true });
    expect(T(tables, '학원').rows).toHaveLength(1);
    const plan = planImport(tables, {}, { parent: true, newId });
    expect(plan.items).toEqual([]);
    // 빈 양식으로 새 학원만 넣어 가져오면 기존 항목은 '파일에 없음' 으로 잡지 않음
    const data = await dataOf(await seed());
    const ac = T(tables, '학원');
    ac.rows.push(ac.headers.map((h) => ({ 학원명: '새학원' })[h] ?? null));
    const p2 = planImport(tables, data, { parent: true, newId, detectMissing: false });
    expect(p2.items.map((i) => i.status)).toEqual(['new']);
    expect(p2.missing).toEqual([]);
  });
});
