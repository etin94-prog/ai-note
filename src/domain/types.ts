/**
 * 도메인 타입 (Requirement 13장). 저장 시 공통 필드(id, version …)는 Repository 가 붙인다.
 * 날짜·시각은 한국 현지 시각 문자열로 다룬다: 날짜 'YYYY-MM-DD', 시각 'HH:mm'.
 */

export type MemberId = 'dad' | 'mom' | 'son' | 'daughter';
export type Role = 'parent' | 'child';

export interface MemberInfo {
  id: MemberId;
  name: string;
  role: Role;
  color: string;
}

/** Sprint 1: 가족 구성원 고정 (Sprint 0 결정, 가입·승인은 Firebase 모드 작업 때) */
export const MEMBERS: MemberInfo[] = [
  { id: 'dad', name: '아빠', role: 'parent', color: '#2563EB' },
  { id: 'mom', name: '엄마', role: 'parent', color: '#DB2777' },
  { id: 'son', name: '아들', role: 'child', color: '#059669' },
  { id: 'daughter', name: '딸', role: 'child', color: '#D97706' },
];
export const CHILDREN = MEMBERS.filter((m) => m.role === 'child');
export const PARENTS = MEMBERS.filter((m) => m.role === 'parent');
export const memberById = (id: string) => MEMBERS.find((m) => m.id === id);

/** 0=일 … 6=토 (dayjs day() 와 같음) */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;
/** 화면 표시 순서: 월~일 */
export const WEEK_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

export interface Academy {
  name: string;
  subject: string;
  address?: string;
  phone?: string;
  teacher?: string;
  memo?: string;
  status: 'active' | 'closed';
}

/** A-12 납부 유형 */
export type PayType = 'fixedLink' | 'monthlyLink' | 'app' | 'transfer' | 'visit' | 'other';
export const PAY_TYPE_LABELS: Record<PayType, string> = {
  fixedLink: '고정 결제 링크',
  monthlyLink: '매달 오는 알림톡·문자 링크',
  app: '학원 전용 앱',
  transfer: '계좌이체',
  visit: '방문·현금',
  other: '기타',
};

/** A-10 납부 정보 — 부모 전용 컬렉션 paymentInfos, 문서 id = academyId */
export interface PaymentInfo {
  academyId: string;
  payType: PayType;
  url?: string;
  bank?: string;
  account?: string;
  holder?: string;
  appName?: string;
  payer: MemberId;
  memo?: string;
}

export interface TimeSlot {
  weekday: Weekday;
  start: string;
  end: string;
}

export interface Enrollment {
  childId: MemberId;
  academyId: string;
  course: string;
  slots: TimeSlot[];
  startDate: string;
  endDate?: string;
  status: 'active' | 'paused' | 'ended';
}

export type EventKind = 'class' | 'makeup' | 'school' | 'meeting' | 'appointment' | 'consult' | 'family' | 'etc';
export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  class: '학원 수업',
  makeup: '보강',
  school: '등하교',
  meeting: '모임',
  appointment: '약속',
  consult: '상담',
  family: '가족',
  etc: '기타',
};

/** 직접 만드는 일정 (1회성 또는 매주 반복). 학원 수업은 Enrollment 에서 자동 생성. */
export interface ScheduleEvent {
  kind: EventKind;
  title: string;
  targets: MemberId[];
  date: string;
  start: string;
  end: string;
  /** 매주 반복 요일. 없으면 1회성 */
  repeatWeekdays?: Weekday[];
  repeatUntil?: string;
  place?: string;
  memo?: string;
  checklist?: string[];
  /** S-08 부모 일정 공개 범위 */
  scope?: 'self' | 'parents' | 'family';
  createdBy: MemberId;
  /** 보강이면 원래 휴강 회차 */
  makeupFor?: string;
}

export type ExceptionStatus = 'cancelled' | 'absent';
export const EXCEPTION_LABELS: Record<ExceptionStatus, string> = { cancelled: '휴강', absent: '결석' };

/** 학원 수업·보강은 휴강/결석, 그 외 일정은 '취소' 하나로 표시 */
export const isClassKind = (kind: EventKind) => kind === 'class' || kind === 'makeup';
export const exceptionLabel = (kind: EventKind, status: ExceptionStatus) =>
  isClassKind(kind) ? EXCEPTION_LABELS[status] : '취소';

/** 회차 예외 — 컬렉션 exceptions, 문서 id = occurrenceKey */
export interface OccurrenceException {
  occurrenceKey: string;
  status?: ExceptionStatus;
  reason?: string;
  /** S-16 회차별 준비물 체크 */
  checked?: string[];
}
