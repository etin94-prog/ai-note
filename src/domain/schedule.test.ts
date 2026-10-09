import { describe, expect, it } from 'vitest';

import { formatDate, mondayOf, normalizeTime } from './dates';
import { type ExpandInput, expandOccurrences, findConflicts, liveStatus, occurrenceKey } from './schedule';

// 2026-11-09 = 월요일 (4.2 공통 예시 주간)
const base: ExpandInput = {
  from: '2026-11-09',
  to: '2026-11-15',
  academies: [
    { id: 'math', data: { name: '수학학원', subject: '수학', status: 'active', address: '가상시 수학로 1' } },
    { id: 'eng', data: { name: '영어학원', subject: '영어', status: 'active' } },
    { id: 'old', data: { name: '그만둔학원', subject: '과학', status: 'closed' } },
  ],
  enrollments: [
    {
      id: 'e1',
      data: {
        childId: 'son',
        academyId: 'math',
        course: '고1 정규',
        startDate: '2026-03-02',
        status: 'active',
        slots: [
          { weekday: 1, start: '18:00', end: '20:00' },
          { weekday: 3, start: '18:00', end: '20:00' },
          { weekday: 5, start: '18:00', end: '20:00' },
        ],
      },
    },
    // 같은 날 2회차 (S-13)
    {
      id: 'e2',
      data: {
        childId: 'daughter',
        academyId: 'eng',
        course: '',
        startDate: '2026-11-11',
        status: 'active',
        slots: [
          { weekday: 3, start: '15:00', end: '16:00' },
          { weekday: 3, start: '19:00', end: '20:00' },
        ],
      },
    },
    { id: 'e3', data: { childId: 'son', academyId: 'old', course: '', startDate: '2026-01-01', status: 'active', slots: [{ weekday: 1, start: '10:00', end: '11:00' }] } },
    { id: 'e4', data: { childId: 'son', academyId: 'eng', course: '', startDate: '2026-01-01', status: 'paused', slots: [{ weekday: 2, start: '10:00', end: '11:00' }] } },
  ],
  events: [
    {
      id: 'ev1',
      data: { kind: 'appointment', title: '치과', targets: ['son'], date: '2026-11-10', start: '16:00', end: '17:00', createdBy: 'mom', checklist: ['보험증'] },
    },
    {
      id: 'school',
      data: { kind: 'school', title: '등교', targets: ['son', 'daughter'], date: '2026-03-02', start: '08:00', end: '08:30', createdBy: 'mom', repeatWeekdays: [1, 2, 3, 4, 5] },
    },
  ],
  exceptions: [],
};

describe('expandOccurrences', () => {
  it('수강 요일·시작일·상태를 반영해 회차를 만든다', () => {
    const occ = expandOccurrences(base);
    const math = occ.filter((o) => o.sourceId === 'e1');
    expect(math.map((o) => o.date)).toEqual(['2026-11-09', '2026-11-11', '2026-11-13']);
    expect(math[0]).toMatchObject({ title: '수학학원', subtitle: '고1 정규', targets: ['son'], place: '가상시 수학로 1', status: 'normal' });
    expect(occ.some((o) => o.sourceId === 'e3')).toBe(false); // 학원 종료
    expect(occ.some((o) => o.sourceId === 'e4')).toBe(false); // 휴원
  });

  it('같은 날 2회차는 키가 다르다', () => {
    const occ = expandOccurrences(base).filter((o) => o.sourceId === 'e2');
    expect(occ).toHaveLength(2);
    expect(new Set(occ.map((o) => o.key)).size).toBe(2);
  });

  it('반복 일정(등교)은 평일만, 1회성 일정은 그날만', () => {
    const occ = expandOccurrences(base);
    expect(occ.filter((o) => o.sourceId === 'school')).toHaveLength(5);
    expect(occ.filter((o) => o.sourceId === 'ev1').map((o) => o.checklist)).toEqual([['보험증']]);
  });

  it('휴강 예외와 준비물 체크가 회차에 적용된다', () => {
    const key = occurrenceKey('enrollment', 'e1', '2026-11-11', '18:00');
    const occ = expandOccurrences({
      ...base,
      exceptions: [{ id: key, data: { occurrenceKey: key, status: 'cancelled', checked: [] } }],
    });
    expect(occ.find((o) => o.key === key)?.status).toBe('cancelled');
  });

  it('시간순으로 정렬된다', () => {
    const occ = expandOccurrences(base);
    const starts = occ.map((o) => o.startAt);
    expect([...starts].sort()).toEqual(starts);
  });
});

describe('findConflicts', () => {
  it('같은 사람의 겹치는 일정만 충돌, 휴강은 제외', () => {
    const extra = {
      ...base,
      events: [
        ...base.events,
        { id: 'ev2', data: { kind: 'meeting' as const, title: '스터디', targets: ['son' as const], date: '2026-11-09', start: '19:00', end: '21:00', createdBy: 'son' as const } },
      ],
    };
    const occ = expandOccurrences(extra);
    const c = findConflicts(occ);
    expect(c.has(occurrenceKey('event', 'ev2', '2026-11-09', '19:00'))).toBe(true);
    expect(c.has(occurrenceKey('enrollment', 'e1', '2026-11-09', '18:00'))).toBe(true);
    const key = occurrenceKey('enrollment', 'e1', '2026-11-09', '18:00');
    const occ2 = expandOccurrences({ ...extra, exceptions: [{ id: key, data: { occurrenceKey: key, status: 'cancelled' } }] });
    expect(findConflicts(occ2).size).toBe(0);
  });
});

describe('liveStatus (S-V1)', () => {
  const son = expandOccurrences(base).filter((o) => o.date === '2026-11-09' && o.targets.includes('son'));
  it('수업 중', () => {
    expect(liveStatus(son, '2026-11-09T18:30')).toMatchObject({ state: 'busy', minutesLeft: 90 });
  });
  it('자투리 시간 — 등교 끝난 뒤 수학까지', () => {
    const s = liveStatus(son, '2026-11-09T16:30');
    expect(s).toMatchObject({ state: 'gap', minutesUntil: 90 });
  });
  it('오늘 끝 / 일정 없음', () => {
    expect(liveStatus(son, '2026-11-09T21:00').state).toBe('done');
    expect(liveStatus([], '2026-11-09T21:00').state).toBe('none');
  });
});

describe('dates', () => {
  it('normalizeTime', () => {
    expect(normalizeTime('7시')).toBe('07:00');
    expect(normalizeTime('19:30')).toBe('19:30');
    expect(normalizeTime('1930')).toBe('19:30');
    expect(normalizeTime('7시30분')).toBe('07:30');
    expect(normalizeTime('25:00')).toBeNull();
  });
  it('mondayOf / formatDate', () => {
    expect(mondayOf('2026-11-15')).toBe('2026-11-09');
    expect(mondayOf('2026-11-09')).toBe('2026-11-09');
    expect(formatDate('2026-10-09')).toBe('10/9(금)');
  });
});
