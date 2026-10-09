import { describe, expect, it } from 'vitest';

import { layoutLanes } from './layout';

describe('layoutLanes (시간표 겹침 배치)', () => {
  it('겹치는 일정은 칸을 나누고, 안 겹치는 일정은 전체 폭', () => {
    const r = layoutLanes([
      { key: 'math', start: '21:00', end: '22:30' },
      { key: 'eng', start: '22:00', end: '23:00' },
      { key: 'study', start: '22:00', end: '23:00' },
      { key: 'dentist', start: '19:00', end: '20:00' },
    ]);
    expect(r.get('dentist')).toEqual({ lane: 0, lanes: 1 });
    expect(r.get('math')).toEqual({ lane: 0, lanes: 3 });
    expect(new Set([r.get('eng')!.lane, r.get('study')!.lane])).toEqual(new Set([1, 2]));
  });

  it('끝난 칸은 재사용한다', () => {
    const r = layoutLanes([
      { key: 'a', start: '18:00', end: '19:00' },
      { key: 'b', start: '18:30', end: '20:00' },
      { key: 'c', start: '19:00', end: '19:30' },
    ]);
    expect(r.get('c')).toEqual({ lane: 0, lanes: 2 });
  });
});
