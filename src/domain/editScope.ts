import type { Op } from '@/data/repository';

import { addDays } from './dates';
import { occurrenceKey } from './schedule';
import type { OccurrenceException, ScheduleEvent } from './types';

interface Doc<T> {
  id: string;
  version: number;
  data: T;
}

export type EditScope = 'this' | 'following' | 'all';

/**
 * 반복 일정의 시간 변경을 범위별 저장 작업으로 만든다 (S-03, 구현계획서 3.6).
 * - this: 해당 회차 예외에 시간 덮어쓰기
 * - all: 원본 일정 수정 (원래 시각 기준 예외는 키가 달라지므로 함께 옮김)
 * - following: 원본은 전날까지로 끊고, 이날부터 새 일정 생성 + 이후 예외를 새 일정으로 옮김
 */
export function planTimeChange(args: {
  scope: EditScope;
  event: Doc<ScheduleEvent>;
  date: string;
  start: string;
  end: string;
  exceptions: Doc<OccurrenceException>[];
  newId: string;
}): Op[] {
  const { scope, event, date, start, end, exceptions, newId } = args;
  const ev = event.data;
  const key = occurrenceKey('event', event.id, date, ev.start);

  if (scope === 'this' || !ev.repeatWeekdays?.length) {
    if (!ev.repeatWeekdays?.length && scope !== 'this') {
      // 1회성 일정은 원본을 바로 수정
      return [{ type: 'update', col: 'events', id: event.id, patch: { start, end }, expectVersion: event.version }];
    }
    const ex = exceptions.find((e) => e.id === key);
    return ex
      ? [{ type: 'update', col: 'exceptions', id: key, patch: { start, end }, expectVersion: ex.version }]
      : [{ type: 'create', col: 'exceptions', id: key, data: { occurrenceKey: key, start, end } }];
  }

  const prefix = `event:${event.id}@`;
  const mine = exceptions.filter((e) => e.id.startsWith(prefix));
  const moveExceptions = (from: string, toId: string, fromStart: string): Op[] =>
    mine
      .filter((e) => e.id.slice(prefix.length, prefix.length + 10) >= from)
      .flatMap((e) => {
        const d = e.id.slice(prefix.length, prefix.length + 10);
        const newKey = occurrenceKey('event', toId, d, start);
        if (newKey === e.id) return [];
        // "이번만" 시간 덮어쓰기는 새 기준 시각과 같으면 지운다
        const { occurrenceKey: _k, start: s, end: en, ...rest } = e.data;
        const keepTime = s && s !== fromStart && s !== start ? { start: s, end: en } : {};
        return [
          { type: 'delete' as const, col: 'exceptions' as const, id: e.id, expectVersion: e.version },
          { type: 'create' as const, col: 'exceptions' as const, id: newKey, data: { ...rest, ...keepTime, occurrenceKey: newKey } },
        ];
      });

  if (scope === 'all' || date <= ev.date) {
    return [
      { type: 'update', col: 'events', id: event.id, patch: { start, end }, expectVersion: event.version },
      ...moveExceptions(ev.date, event.id, ev.start),
    ];
  }

  // following
  const newEvent: ScheduleEvent = { ...ev, date, start, end };
  return [
    { type: 'update', col: 'events', id: event.id, patch: { repeatUntil: addDays(date, -1) }, expectVersion: event.version },
    { type: 'create', col: 'events', id: newId, data: newEvent as unknown as Record<string, unknown> },
    ...moveExceptions(date, newId, ev.start),
  ];
}
