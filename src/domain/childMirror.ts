import type { Collection, StoredDoc } from '@/data/repository';

import type { Academy, Enrollment, Holiday, MemberId, OccurrenceException, Place, ScheduleEvent } from './types';

/**
 * GitHub 모드 자녀 사본 (D-14, G-03): 부모 데이터에서 "그 아이에게 보여도 되는 것"만 고른다.
 * 비용·납부 정보(부모 전용 컬렉션)와 형제 데이터, 부모 개인 일정은 절대 포함하지 않는다.
 */
export interface MirrorSource {
  academies: StoredDoc<Academy>[];
  enrollments: StoredDoc<Enrollment>[];
  events: StoredDoc<ScheduleEvent>[];
  exceptions: StoredDoc<OccurrenceException>[];
  places: StoredDoc<Place>[];
  holidays: StoredDoc<Holiday>[];
  /** 알림 설정 — 그 아이 문서만 */
  reminderPolicies?: StoredDoc[];
}

export interface MirrorDoc {
  col: Collection;
  id: string;
  doc: StoredDoc;
}

export function childProjection(child: MemberId, src: MirrorSource): MirrorDoc[] {
  const enrollments = src.enrollments.filter((e) => e.childId === child);
  const academyIds = new Set(enrollments.map((e) => e.academyId));
  const academies = src.academies.filter((a) => academyIds.has(a.id));
  // 아이가 대상인 일정만. 아이가 대상이면 공개범위는 가족 일정이어야 함 (부모 전용 범위 제외)
  const events = src.events.filter((e) => e.targets.includes(child) && (e.scope ?? 'family') === 'family');
  const visibleSources = new Set([
    ...enrollments.map((e) => `enrollment:${e.id}@`),
    ...events.map((e) => `event:${e.id}@`),
  ]);
  const exceptions = src.exceptions.filter((x) => [...visibleSources].some((p) => x.id.startsWith(p)));
  const holidays = src.holidays.filter((h) => h.memberIds.includes(child));

  // 형제가 함께 대상인 일정은 아이 본인만 남긴다 (형제 비공개, U-06)
  const ownEvents = events.map((e) => ({ ...e, targets: [child] }));

  const pick = <T,>(col: Collection, docs: StoredDoc<T>[]) => docs.map((doc) => ({ col, id: doc.id, doc: doc as StoredDoc }));
  return [
    ...pick('academies', academies),
    ...pick('enrollments', enrollments),
    ...pick('events', ownEvents),
    ...pick('exceptions', exceptions),
    // 연결 테스트 기록(spikeTest)은 사본에 넣지 않음
    ...pick('places', src.places.filter((p) => !(p as unknown as { spikeTest?: boolean }).spikeTest)),
    ...pick('holidays', holidays.map((h) => ({ ...h, memberIds: [child] }))),
    ...pick('reminderPolicies', (src.reminderPolicies ?? []).filter((p) => p.id === child)),
  ];
}

/** 자녀 사본 저장소 이름 */
export const MIRROR_REPOS: Partial<Record<MemberId, string>> = {
  son: 'ai-note-son',
  daughter: 'ai-note-daughter',
};
