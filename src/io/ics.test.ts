import { describe, expect, it } from 'vitest';

import type { Occurrence } from '@/domain/schedule';

import { buildIcs, fold } from './ics';

const o = (over: Partial<Occurrence>): Occurrence => ({
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
  checklist: ['단어장'],
  checked: [],
  ...over,
});

describe('.ics 내보내기', () => {
  it('회차마다 VEVENT, 휴강은 제외, 서울 시간대', () => {
    const ics = buildIcs([o({}), o({ key: 'k2', status: 'cancelled' }), o({ key: 'k3', place: '가상빌딩, 3층' })], { calName: '딸 일정', stamp: '20261010T000000Z' });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('DTSTART;TZID=Asia/Seoul:20261012T190000');
    expect(ics).toContain('SUMMARY:가상영어 (딸)');
    expect(ics).toContain('LOCATION:가상빌딩\\, 3층');
    expect(ics).toContain('DESCRIPTION:학원 수업\\n준비물: 단어장');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('긴 줄은 75바이트 이하로 접는다', () => {
    const line = `SUMMARY:${'가'.repeat(60)}`;
    for (const part of fold(line).split('\r\n')) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
  });
});
