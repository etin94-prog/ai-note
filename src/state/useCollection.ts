import { useEffect, useMemo, useState } from 'react';

import type { Collection, StoredDoc } from '@/data/repository';
import { addDays } from '@/domain/dates';
import { expandOccurrences, type Occurrence } from '@/domain/schedule';
import type { Academy, Enrollment, Holiday, OccurrenceException, ScheduleEvent } from '@/domain/types';

import { useRepository } from './RepositoryContext';

/** 컬렉션 실시간 구독. 저장 모드가 없으면 빈 목록. */
export function useCollection<T>(col: Collection) {
  const { repo } = useRepository();
  const [docs, setDocs] = useState<StoredDoc<T>[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!repo) {
      setDocs([]);
      setLoaded(true);
      return;
    }
    setLoaded(false);
    return repo.watch<T>(col, (d) => {
      setDocs(d);
      setLoaded(true);
    });
  }, [repo, col]);
  return { docs, loaded };
}

const asInput = <T,>(docs: StoredDoc<T>[]) => docs.map((d) => ({ id: d.id, data: d as T }));

/** 기간 [from, to] 의 회차 목록 (학원 수강 + 직접 만든 일정 + 예외 반영) */
export function useOccurrences(from: string, to: string) {
  const academies = useCollection<Academy>('academies');
  const enrollments = useCollection<Enrollment>('enrollments');
  const events = useCollection<ScheduleEvent>('events');
  const exceptions = useCollection<OccurrenceException>('exceptions');
  const holidays = useCollection<Holiday>('holidays');

  const occurrences: Occurrence[] = useMemo(
    () =>
      expandOccurrences({
        from,
        to,
        academies: asInput(academies.docs),
        enrollments: asInput(enrollments.docs),
        events: asInput(events.docs),
        exceptions: asInput(exceptions.docs),
        holidays: asInput(holidays.docs),
      }),
    [from, to, academies.docs, enrollments.docs, events.docs, exceptions.docs, holidays.docs],
  );
  const loaded = academies.loaded && enrollments.loaded && events.loaded && exceptions.loaded && holidays.loaded;
  return { occurrences, loaded, exceptions: exceptions.docs, events: events.docs };
}

/** 1분마다 바뀌는 현재 시각 (실시간 상태 카드용) */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export const weekRange = (monday: string) => ({ from: monday, to: addDays(monday, 6) });
