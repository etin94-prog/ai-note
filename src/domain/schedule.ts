import { eachDay, minutesBetween, weekdayOf } from './dates';
import type {
  Academy,
  Enrollment,
  EventKind,
  ExceptionStatus,
  MemberId,
  OccurrenceException,
  ScheduleEvent,
} from './types';

/** 일정 원본 + 예외를 기간 안의 회차 목록으로 펼친 결과 (구현계획서 3.6) */
export interface Occurrence {
  /** 회차 고유 키 = 원본 + 원래 시작 시각 (S-13) */
  key: string;
  source: 'enrollment' | 'event';
  sourceId: string;
  kind: EventKind;
  title: string;
  subtitle?: string;
  targets: MemberId[];
  date: string;
  start: string;
  end: string;
  /** 'YYYY-MM-DDTHH:mm' */
  startAt: string;
  endAt: string;
  status: 'normal' | ExceptionStatus;
  place?: string;
  checklist: string[];
  checked: string[];
  academyId?: string;
}

export const occurrenceKey = (source: Occurrence['source'], sourceId: string, date: string, start: string) =>
  `${source}:${sourceId}@${date}T${start}`;

interface Input<T> {
  id: string;
  data: T;
}

export interface ExpandInput {
  from: string;
  to: string;
  academies: Input<Academy>[];
  enrollments: Input<Enrollment>[];
  events: Input<ScheduleEvent>[];
  exceptions: Input<OccurrenceException>[];
}

/** 기간 [from, to] 의 모든 회차. 시간순 정렬. */
export function expandOccurrences(input: ExpandInput): Occurrence[] {
  const academyName = new Map(input.academies.map((a) => [a.id, a.data]));
  const exByKey = new Map(input.exceptions.map((e) => [e.data.occurrenceKey, e.data]));
  const out: Occurrence[] = [];

  const push = (o: Omit<Occurrence, 'key' | 'startAt' | 'endAt' | 'status' | 'checked'>) => {
    const key = occurrenceKey(o.source, o.sourceId, o.date, o.start);
    const ex = exByKey.get(key);
    out.push({
      ...o,
      key,
      startAt: `${o.date}T${o.start}`,
      endAt: `${o.date}T${o.end}`,
      status: ex?.status ?? 'normal',
      checked: ex?.checked ?? [],
    });
  };

  for (const { id, data: e } of input.enrollments) {
    if (e.status !== 'active') continue;
    const academy = academyName.get(e.academyId);
    if (!academy || academy.status !== 'active') continue;
    const from = e.startDate > input.from ? e.startDate : input.from;
    const to = e.endDate && e.endDate < input.to ? e.endDate : input.to;
    for (const date of eachDay(from, to)) {
      const wd = weekdayOf(date);
      for (const slot of e.slots) {
        if (slot.weekday !== wd) continue;
        push({
          source: 'enrollment',
          sourceId: id,
          kind: 'class',
          title: academy.name,
          subtitle: e.course || academy.subject,
          targets: [e.childId],
          date,
          start: slot.start,
          end: slot.end,
          place: academy.address,
          checklist: [],
          academyId: e.academyId,
        });
      }
    }
  }

  for (const { id, data: ev } of input.events) {
    const base = {
      source: 'event' as const,
      sourceId: id,
      kind: ev.kind,
      title: ev.title,
      targets: ev.targets,
      start: ev.start,
      end: ev.end,
      place: ev.place,
      checklist: ev.checklist ?? [],
    };
    if (ev.repeatWeekdays?.length) {
      const from = ev.date > input.from ? ev.date : input.from;
      const to = ev.repeatUntil && ev.repeatUntil < input.to ? ev.repeatUntil : input.to;
      for (const date of eachDay(from, to)) if (ev.repeatWeekdays.includes(weekdayOf(date))) push({ ...base, date });
    } else if (ev.date >= input.from && ev.date <= input.to) {
      push({ ...base, date: ev.date });
    }
  }

  return out.sort((a, b) => (a.startAt === b.startAt ? a.title.localeCompare(b.title) : a.startAt < b.startAt ? -1 : 1));
}

export const visibleFor = (occ: Occurrence[], member: MemberId | 'all') =>
  member === 'all' ? occ : occ.filter((o) => o.targets.includes(member));

/** S-10 같은 사람의 겹치는 회차 키 (휴강·결석 제외) */
export function findConflicts(occ: Occurrence[]): Set<string> {
  const active = occ.filter((o) => o.status === 'normal');
  const conflicts = new Set<string>();
  for (let i = 0; i < active.length; i++)
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      if (b.startAt >= a.endAt) continue;
      if (a.targets.some((t) => b.targets.includes(t)) && a.startAt < b.endAt && b.startAt < a.endAt) {
        conflicts.add(a.key);
        conflicts.add(b.key);
      }
    }
  return conflicts;
}

export type LiveStatus =
  | { state: 'busy'; occ: Occurrence; minutesLeft: number; next?: Occurrence }
  | { state: 'gap'; next: Occurrence; minutesUntil: number; after?: Occurrence }
  | { state: 'done' }
  | { state: 'none' };

/**
 * S-V1 실시간 상태: 지금 진행 중인 일정 / 다음 일정까지 남은 시간(자투리) / 오늘 끝.
 * occ 는 한 사람의 오늘 회차.
 */
export function liveStatus(occ: Occurrence[], now: string): LiveStatus {
  const active = occ.filter((o) => o.status === 'normal');
  if (active.length === 0) return { state: 'none' };
  const current = active.find((o) => o.startAt <= now && now < o.endAt);
  const next = active.find((o) => o.startAt > now);
  if (current) return { state: 'busy', occ: current, minutesLeft: minutesBetween(now, current.endAt), next };
  if (next) {
    const prev = [...active].reverse().find((o) => o.endAt <= now);
    return { state: 'gap', next, minutesUntil: minutesBetween(now, next.startAt), after: prev };
  }
  return { state: 'done' };
}
