import { describe, expect, it } from 'vitest';

import { exportTables, planImport } from '@/io/excel/sync';

import { extractKnown, parseDateWord, parseTimeWord } from './extract';
import { pruneLog } from './history';
import { absorb, answer, buildOps, type ChatCtx, type ChatState, initialState, nextStep, reopen, SKIP_VALUE } from './guided';

const T = '2026-10-10'; // 토요일
const ctx: ChatCtx = {
  today: T,
  me: 'mom',
  academies: [
    { id: 'a-en', name: '가나다영어', subject: '영어' },
    { id: 'a-ma', name: '라마바수학', subject: '수학' },
  ],
  aliases: [{ kind: 'academy', text: '가나다', targetId: 'a-en' }],
  places: ['집', '학교'],
  categories: [],
  bills: [
    {
      id: 'b1',
      label: '딸 가나다영어 10월분',
      childId: 'daughter',
      academyId: 'a-en',
      period: '2026-10',
      remaining: 320000,
      due: 320000,
      paid: 0,
    },
    {
      id: 'b2',
      label: '아들 라마바수학 10월분',
      childId: 'son',
      academyId: 'a-ma',
      period: '2026-10',
      remaining: 0,
      due: 400000,
      paid: 400000,
    },
    {
      id: 'b3',
      label: '아들 라마바수학 11월분',
      childId: 'son',
      academyId: 'a-ma',
      period: '2026-11',
      remaining: 400000,
      due: 400000,
      paid: 0,
    },
  ],
  lastMethod: 'card',
};
let n = 0;
const newId = () => `id${++n}`;

/** 질문에 차례로 답하며 확인 카드까지 */
function run(first: string, answers: Record<string, string | { value: unknown }> = {}, kind?: ChatState['kind']) {
  let s = absorb({ ...initialState(), kind: kind ?? null }, first, ctx, {
    firstMessage: true,
  });
  const askedKeys: string[] = [];
  for (let i = 0; i < 20; i++) {
    const r = nextStep(s, ctx);
    s = r.state;
    if (r.step.type !== 'ask') return { state: s, step: r.step, askedKeys };
    const k = r.step.key;
    askedKeys.push(k);
    const a = answers[k];
    if (a === undefined) throw new Error(`예상하지 못한 질문: ${k} (${r.step.question})`);
    const res = answer(s, k, typeof a === 'string' ? { text: a } : a, ctx);
    if (res.error) throw new Error(`${k}: ${res.error}`);
    s = res.state;
  }
  throw new Error('끝나지 않음');
}

describe('알려진 단어 (I-21 ③)', () => {
  it('"딸 영어학원 월수금 7시~9시 32만원" → 자녀·학원·요일·시간·금액', () => {
    const e = extractKnown('딸 영어학원 월수금 7시~9시 32만원', ctx);
    expect(e).toMatchObject({
      children: ['daughter'],
      academyId: 'a-en',
      weekdays: [1, 3, 5],
      start: '19:00',
      end: '21:00',
      amount: 320000,
    });
    expect(e.leftover).toBe('');
  });
  it('날짜·시각 표현', () => {
    expect(parseDateWord('오늘', T)).toBe(T);
    expect(parseDateWord('다음주 화요일', T)).toBe('2026-10-13');
    expect(parseDateWord('일요일', T)).toBe('2026-10-11');
    expect(parseDateWord('11/5', T)).toBe('2026-11-05');
    expect(parseDateWord('1월 3일', T)).toBe('2027-01-03');
    expect(parseTimeWord('3시 반')).toBe('15:30');
    expect(parseTimeWord('오전 10시')).toBe('10:00');
    expect(parseTimeWord('19:00')).toBe('19:00');
  });
  it('"수학" 의 수는 요일이 아님, "3시간" 은 시각이 아님', () => {
    const e = extractKnown('아들 수학 보강 내일 4시 2시간', ctx);
    expect(e.weekdays).toBeUndefined();
    expect(e).toMatchObject({
      children: ['son'],
      date: '2026-10-11',
      start: '16:00',
      end: '18:00',
    });
  });
});

describe('안내형 흐름', () => {
  it('일정: 한 문장으로 거의 다 채우고, 빠진 끝 시각만 묻는다 (I-22)', () => {
    const r = run('딸 반 모임 토요일 3시', {
      end: '5시',
      place: { value: SKIP_VALUE },
    });
    expect(r.askedKeys).toEqual(['end', 'place']);
    expect(r.step).toMatchObject({ type: 'confirm' });
    const { ops } = buildOps(r.state, ctx, newId, 'now');
    expect(ops[0]).toMatchObject({
      col: 'events',
      data: {
        title: '반 모임',
        targets: ['daughter'],
        date: '2026-10-10',
        start: '15:00',
        end: '17:00',
        repeatWeekdays: [],
        createdBy: 'mom',
        scope: 'family',
      },
    });
  });

  it('일정: 처음에 아무것도 없으면 제목부터 하나씩', () => {
    const r = run(
      '',
      {
        title: '치과',
        targets: { value: ['son'] },
        date: '다음주 화요일',
        start: '4시',
        end: '1시간',
        place: '학교',
      },
      'event',
    );
    expect(r.askedKeys).toEqual(['title', 'targets', 'date', 'start', 'end', 'place']);
    expect(buildOps(r.state, ctx, newId, 'now').ops[0]).toMatchObject({
      data: {
        title: '치과',
        date: '2026-10-13',
        start: '16:00',
        end: '17:00',
        place: '학교',
      },
    });
  });

  it('잘못된 답은 다시 묻는다', () => {
    let s = absorb({ ...initialState(), kind: 'event' }, '아들 치과 내일', ctx, { firstMessage: true });
    s = nextStep(s, ctx).state;
    const r = answer(s, 'start', { text: '점심쯤' }, ctx);
    expect(r.error).toContain('알아듣지 못했어요');
  });

  it('수강: 새 학원 이름이면 학원도 함께 만든다 + 수강료·결제일', () => {
    const r = run('아들 코딩학원 화목 5시~7시', {
      amount: '25만',
      payDay: { value: 10 },
    });
    expect(r.askedKeys).toEqual(['amount', 'payDay']);
    const { ops } = buildOps(r.state, ctx, newId, 'now');
    expect(ops.map((o) => o.col)).toEqual(['academies', 'enrollments', 'enrollmentCosts']);
    expect(ops[0]).toMatchObject({
      data: { name: '코딩학원', status: 'active' },
    });
    expect(ops[1]).toMatchObject({
      data: {
        childId: 'son',
        startDate: T,
        slots: [
          { weekday: 2, start: '17:00', end: '19:00' },
          { weekday: 4, start: '17:00', end: '19:00' },
        ],
      },
    });
    expect(ops[2]).toMatchObject({
      data: { amount: 250000, payDay: 10, effectiveFrom: T },
    });
  });

  it('납부: "딸 영어 냈어" → 청구 하나로 좁혀 금액·날짜·수단 자동 (I-24)', () => {
    const r = run('딸 가나다영어 10월분 냈어');
    expect(r.askedKeys).toEqual([]);
    expect(buildOps(r.state, ctx, newId, 'now').ops[0]).toMatchObject({
      col: 'payments',
      data: {
        billId: 'b1',
        amount: 320000,
        paidOn: T,
        method: 'card',
        by: 'mom',
      },
    });
  });

  it('납부: 후보가 여럿이면 선택지', () => {
    const s = absorb(initialState(), '학원비 납부', ctx, {
      firstMessage: true,
    });
    const r = nextStep(s, ctx);
    expect(r.step).toMatchObject({ type: 'ask', key: 'billId' });
    if (r.step.type === 'ask') expect(r.step.choices.map((c) => c.value)).toEqual(['b3', 'b1']);
  });

  it('지출: 분류·자녀를 문장에서', () => {
    const r = run('딸 교재비 15000원 어제');
    expect(buildOps(r.state, ctx, newId, 'now').ops[0]).toMatchObject({
      col: 'expenses',
      data: {
        amount: 15000,
        category: '교재비',
        childId: 'daughter',
        date: '2026-10-09',
      },
    });
  });

  it('환불: 퇴원 사유, 낸 금액 전부', () => {
    const r = run('아들 라마바수학 10월분 퇴원 환불', {
      amount: { value: 400000 },
    });
    expect(buildOps(r.state, ctx, newId, 'now').ops[0]).toMatchObject({
      col: 'refunds',
      data: { billId: 'b2', reason: 'withdraw', requested: 400000 },
    });
  });

  it('확인 카드에서 항목 고치기', () => {
    const r = run('딸 반 모임 토요일 3시', {
      end: '5시',
      place: { value: SKIP_VALUE },
    });
    const s = reopen(r.state, 'start');
    const step = nextStep(s, ctx).step;
    expect(step).toMatchObject({ type: 'ask', key: 'start' });
  });
});

describe('채팅 기록 30일 삭제 (I-27)', () => {
  it('30일 지난 줄은 지운다', () => {
    const now = new Date('2026-10-10T12:00:00Z');
    const lines = [
      { at: '2026-09-09T11:00:00Z', role: 'me' as const, text: 'old' },
      { at: '2026-09-11T00:00:00Z', role: 'me' as const, text: 'keep' },
    ];
    expect(pruneLog(lines, now).map((l) => l.text)).toEqual(['keep']);
  });
});

describe('세 입력 방식 동등 (Sprint 3 완료 기준)', () => {
  it('같은 수강 1건 — 채팅과 엑셀이 같은 데이터', () => {
    const chat = run('딸 가나다영어 월수 7시~9시', {
      amount: '32만',
      payDay: { value: 5 },
    });
    const chatOps = buildOps(chat.state, ctx, newId, 'now').ops;
    const enroll = chatOps.find((o) => o.col === 'enrollments')!;
    const cost = chatOps.find((o) => o.col === 'enrollmentCosts')!;

    const data = {
      academies: [
        {
          id: 'a-en',
          name: '가나다영어',
          subject: '영어',
          status: 'active',
          version: 1,
          createdAt: '',
          updatedAt: '',
          updatedBy: '',
          schemaVersion: 1,
        },
      ],
    };
    const tables = exportTables(data, { parent: true });
    const en = tables.find((t) => t.name === '수강')!;
    en.rows.push(
      en.headers.map(
        (h) =>
          ({
            자녀: '딸',
            학원: '가나다영어',
            시간표: '월수 19:00-21:00',
            시작일: T,
          })[h] ?? null,
      ),
    );
    const plan = planImport(tables, data, {
      parent: true,
      newId,
      detectMissing: false,
    });
    const excel = plan.items.find((i) => i.col === 'enrollments')!.rec;

    if (enroll.type !== 'create' || cost.type !== 'create') throw new Error();
    const pick = (o: Record<string, unknown>) => ({
      childId: o.childId,
      academyId: o.academyId,
      course: o.course,
      slots: o.slots,
      startDate: o.startDate,
      status: o.status,
    });
    expect(pick(enroll.data)).toEqual(pick(excel));
    expect(cost.data).toMatchObject({
      amount: 320000,
      payDay: 5,
      cycle: 'monthly',
      timing: 'prepaid',
    });
  });
});
