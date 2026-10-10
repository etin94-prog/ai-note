import { describe, expect, it } from 'vitest';

import type { Bill, BillState } from './money';
import { billState } from './money';
import {
  DEFAULT_COST_POLICY,
  defaultPolicy,
  feeReminders,
  inboxFor,
  labelMinutes,
  liveTitle,
  normalizeMinutes,
  parseMinutes,
  type ReminderPolicy,
  scheduleReminders,
} from './reminders';
import type { Occurrence } from './schedule';

const occ = (over: Partial<Occurrence> = {}): Occurrence => ({
  key: 'enrollment:e1@2026-10-12T19:00',
  source: 'enrollment',
  sourceId: 'e1',
  kind: 'class',
  title: '가상영어',
  targets: ['daughter'],
  date: '2026-10-12',
  start: '19:00',
  end: '21:00',
  startAt: '2026-10-12T19:00',
  endAt: '2026-10-12T21:00',
  status: 'normal',
  checklist: [],
  checked: [],
  ...over,
});

describe('알림 시점 값 (N-21)', () => {
  it('정리·해석·표시', () => {
    expect(normalizeMinutes([30, 60, 30, 0, 99999, 15, 5, 10, 120, 1440])).toEqual([1440, 120, 60, 30, 15, 10]);
    expect(parseMinutes('1일')).toBe(1440);
    expect(parseMinutes('1시간 30분')).toBe(90);
    expect(parseMinutes('45')).toBe(45);
    expect(parseMinutes('곧')).toBeNull();
    expect(labelMinutes(90)).toBe('1시간 30분 전');
    expect(labelMinutes(2880)).toBe('2일 전');
  });
});

describe('일정 알림 (N-01, N-20, N-22)', () => {
  it('당사자 + 부모에게 각자 설정한 시점으로', () => {
    const items = scheduleReminders([occ()], {});
    // 딸(수업 30분) + 아빠·엄마(기본 60분)
    expect(items.map((i) => [i.to[0], i.at])).toEqual([
      ['daughter', '2026-10-12T18:30'],
      ['dad', '2026-10-12T18:00'],
      ['mom', '2026-10-12T18:00'],
    ]);
    expect(items[0].title).toBe('30분 뒤 가상영어');
    // 화면에서는 지금 기준 남은 시간
    expect(liveTitle(items[1], '2026-10-12T18:20')).toBe('40분 뒤 가상영어');
  });

  it('부모가 끈 구성원·휴강 회차는 알림 없음, 종류별 시점', () => {
    const policies: Record<string, ReminderPolicy> = {
      dad: { ...defaultPolicy('dad'), enabled: false },
      mom: { memberId: 'mom', enabled: true, byKind: { default: [60], class: [1440, 10] } },
    };
    const items = scheduleReminders([occ(), occ({ key: 'x', status: 'cancelled' })], policies);
    expect(items.filter((i) => i.to[0] === 'dad')).toEqual([]);
    expect(items.filter((i) => i.to[0] === 'mom').map((i) => i.at)).toEqual(['2026-10-11T19:00', '2026-10-12T18:50']);
  });

  it('일정 1건만 다른 시점', () => {
    const items = scheduleReminders([occ()], {}, new Map([['e1', [1440]]]));
    expect(new Set(items.map((i) => i.at))).toEqual(new Set(['2026-10-11T19:00']));
  });

  it('알림함: 시각이 지났고 일정 시작 전인 것만', () => {
    const items = scheduleReminders([occ()], {});
    expect(inboxFor('daughter', items, '2026-10-12T18:00')).toHaveLength(0);
    expect(inboxFor('daughter', items, '2026-10-12T18:40')).toHaveLength(1);
    expect(inboxFor('daughter', items, '2026-10-12T19:00')).toHaveLength(0);
    expect(inboxFor('son', items, '2026-10-12T18:40')).toHaveLength(0);
  });
});

describe('학원비 알림 (N-02~N-04, N-25)', () => {
  const bill = (over: Partial<Bill>): Bill => ({ title: '가상수학', academyId: 'a', childId: 'son', period: '2026-10', amount: 300000, dueDate: '2026-10-13', payer: 'dad', source: 'manual', ...over });
  const row = (id: string, b: Bill): { id: string; bill: Bill; state: BillState } => ({ id, bill: b, state: billState(b, [], [], [], [], '2026-10-10') });

  it('기한 D-3·당일은 담당 부모에게, 연체는 부모 모두에게', () => {
    const rows = [row('b1', bill({})), row('b2', bill({ dueDate: '2026-10-11' })), row('b3', bill({ dueDate: '2026-10-01' }))];
    const items = feeReminders(rows, DEFAULT_COST_POLICY, '2026-10-10');
    expect(items.map((i) => [i.id, i.to])).toEqual([
      ['f|over|b3', ['dad', 'mom']],
      ['f|due|b1|3', ['dad']],
    ]);
    // D-1 은 설정에 없어서 빠짐. 다른 부모에게도 켜면 둘 다
    const both = feeReminders(rows, { dueDays: [1], notifyOtherParent: true }, '2026-10-10');
    expect(both.find((i) => i.id === 'f|due|b2|1')?.to).toEqual(['dad', 'mom']);
  });

  it('자녀에게는 비용 알림이 가지 않음', () => {
    const items = feeReminders([row('b3', bill({ dueDate: '2026-10-01' }))], DEFAULT_COST_POLICY, '2026-10-10');
    expect(inboxFor('son', items, '2026-10-10T09:00')).toEqual([]);
  });
});
