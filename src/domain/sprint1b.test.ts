import { describe, expect, it } from 'vitest';

import { childProjection, type MirrorSource } from './childMirror';
import { planTimeChange } from './editScope';
import { expandOccurrences, occurrenceKey } from './schedule';
import type { ScheduleEvent } from './types';

const meta = (id: string) => ({
  id,
  version: 1,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  updatedBy: 'mom',
  schemaVersion: 1,
});

const school: ScheduleEvent = {
  kind: 'school',
  title: '등교',
  targets: ['son', 'daughter'],
  date: '2026-09-01',
  start: '08:00',
  end: '08:30',
  createdBy: 'mom',
  repeatWeekdays: [1, 2, 3, 4, 5],
};

describe('방학·휴일 (S-05, S-14)', () => {
  const base = {
    from: '2026-12-28',
    to: '2027-01-03',
    academies: [{ id: 'a', data: { name: '수학', subject: '', status: 'active' as const } }],
    enrollments: [
      {
        id: 'e',
        data: {
          childId: 'son' as const,
          academyId: 'a',
          course: '',
          startDate: '2026-01-01',
          status: 'active' as const,
          slots: [{ weekday: 1 as const, start: '18:00', end: '20:00' }],
        },
      },
    ],
    events: [{ id: 'school', data: school }],
    exceptions: [],
  };

  it('아들 방학이면 아들 등교만 빠지고 딸 등교는 남는다', () => {
    const occ = expandOccurrences({
      ...base,
      holidays: [
        { id: 'h', data: { name: '겨울방학', memberIds: ['son'], start: '2026-12-26', end: '2027-02-28', skipSchool: true, skipClass: false } },
      ],
    });
    const schoolOcc = occ.filter((o) => o.sourceId === 'school');
    expect(schoolOcc.length).toBe(5);
    expect(schoolOcc.every((o) => o.targets.length === 1 && o.targets[0] === 'daughter')).toBe(true);
    // 학원 수업은 skipClass=false 라 유지
    expect(occ.filter((o) => o.sourceId === 'e')).toHaveLength(1);
  });

  it('skipClass 면 학원 수업도 빠진다, 둘 다 방학이면 등교 회차 자체가 없다', () => {
    const occ = expandOccurrences({
      ...base,
      holidays: [
        { id: 'h', data: { name: '방학', memberIds: ['son', 'daughter'], start: '2026-12-26', end: '2027-02-28', skipSchool: true, skipClass: true } },
      ],
    });
    expect(occ).toHaveLength(0);
  });
});

describe('"이번만" 시간 변경 (S-03)', () => {
  it('회차 키는 원래 시각 그대로, 표시 시각만 바뀐다', () => {
    const key = occurrenceKey('event', 'school', '2026-11-09', '08:00');
    const occ = expandOccurrences({
      from: '2026-11-09',
      to: '2026-11-09',
      academies: [],
      enrollments: [],
      events: [{ id: 'school', data: school }],
      exceptions: [{ id: key, data: { occurrenceKey: key, start: '10:00', end: '10:30' } }],
    });
    expect(occ[0]).toMatchObject({ key, start: '10:00', startAt: '2026-11-09T10:00', moved: true, originalStart: '08:00' });
  });
});

describe('planTimeChange', () => {
  const event = { id: 'school', version: 3, data: school };
  const exKey = (d: string, t = '08:00') => occurrenceKey('event', 'school', d, t);
  const exceptions = [
    { id: exKey('2026-11-02'), version: 1, data: { occurrenceKey: exKey('2026-11-02'), status: 'cancelled' as const } },
    { id: exKey('2026-11-16'), version: 1, data: { occurrenceKey: exKey('2026-11-16'), checked: ['교과서'] } },
  ];

  it('이번만 → 예외 생성', () => {
    const ops = planTimeChange({ scope: 'this', event, date: '2026-11-09', start: '09:00', end: '09:30', exceptions, newId: 'n' });
    expect(ops).toEqual([
      { type: 'create', col: 'exceptions', id: exKey('2026-11-09'), data: { occurrenceKey: exKey('2026-11-09'), start: '09:00', end: '09:30' } },
    ]);
  });

  it('이후 모두 → 원본 전날까지 + 새 일정 + 이후 예외만 이동 (이전 예외는 유지)', () => {
    const ops = planTimeChange({ scope: 'following', event, date: '2026-11-09', start: '08:20', end: '08:50', exceptions, newId: 'n' });
    expect(ops[0]).toMatchObject({ type: 'update', id: 'school', patch: { repeatUntil: '2026-11-08' }, expectVersion: 3 });
    expect(ops[1]).toMatchObject({ type: 'create', col: 'events', id: 'n', data: { date: '2026-11-09', start: '08:20', end: '08:50' } });
    const newKey = occurrenceKey('event', 'n', '2026-11-16', '08:20');
    expect(ops.slice(2)).toEqual([
      { type: 'delete', col: 'exceptions', id: exKey('2026-11-16'), expectVersion: 1 },
      { type: 'create', col: 'exceptions', id: newKey, data: { checked: ['교과서'], occurrenceKey: newKey } },
    ]);
  });

  it('전체 → 원본 수정 + 모든 예외 키 이동', () => {
    const ops = planTimeChange({ scope: 'all', event, date: '2026-11-09', start: '08:10', end: '08:40', exceptions, newId: 'n' });
    expect(ops[0]).toMatchObject({ type: 'update', id: 'school', patch: { start: '08:10', end: '08:40' } });
    expect(ops.filter((o) => o.type === 'delete')).toHaveLength(2);
  });
});

describe('자녀 사본 (D-14, G-03)', () => {
  const src: MirrorSource = {
    academies: [
      { ...meta('a-son'), name: '수학', subject: '', status: 'active' },
      { ...meta('a-dau'), name: '피아노', subject: '', status: 'active' },
    ],
    enrollments: [
      { ...meta('e-son'), childId: 'son', academyId: 'a-son', course: '', startDate: '2026-01-01', status: 'active', slots: [] },
      { ...meta('e-dau'), childId: 'daughter', academyId: 'a-dau', course: '', startDate: '2026-01-01', status: 'active', slots: [] },
    ],
    events: [
      { ...meta('school'), ...school },
      { ...meta('dau-only'), ...school, title: '딸 상담', targets: ['daughter'] },
      { ...meta('parents'), ...school, title: '부부 모임', targets: ['dad', 'mom'], scope: 'parents' },
    ],
    exceptions: [
      { ...meta('enrollment:e-son@2026-11-09T18:00'), occurrenceKey: 'enrollment:e-son@2026-11-09T18:00', status: 'cancelled' },
      { ...meta('enrollment:e-dau@2026-11-09T18:00'), occurrenceKey: 'enrollment:e-dau@2026-11-09T18:00', status: 'cancelled' },
    ],
    places: [{ ...meta('home'), name: '집' }],
    holidays: [{ ...meta('h'), name: '방학', memberIds: ['son', 'daughter'], start: '2026-12-26', end: '2027-02-28', skipSchool: true, skipClass: false }],
  };

  const out = childProjection('son', src);
  const ids = (col: string) => out.filter((d) => d.col === col).map((d) => d.id);

  it('아들 사본에는 아들 학원·수강·일정·예외만', () => {
    expect(ids('academies')).toEqual(['a-son']);
    expect(ids('enrollments')).toEqual(['e-son']);
    expect(ids('events')).toEqual(['school']);
    expect(ids('exceptions')).toEqual(['enrollment:e-son@2026-11-09T18:00']);
  });

  it('형제 정보가 남지 않는다 (공동 일정 대상자·방학 대상자에서 딸 제거)', () => {
    const json = JSON.stringify(out);
    expect(json).not.toContain('daughter');
    expect(json).not.toContain('피아노');
    expect(json).not.toContain('부부 모임');
  });

  it('부모 전용 컬렉션은 절대 포함하지 않는다', () => {
    const cols = new Set(out.map((d) => d.col));
    for (const c of ['bills', 'payments', 'paymentInfos', 'enrollmentCosts', 'expenses', 'refunds', 'receipts']) expect(cols.has(c as never)).toBe(false);
  });
});

