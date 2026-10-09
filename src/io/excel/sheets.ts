import type { Collection } from '@/data/repository';
import { PAY_METHOD_LABELS, REFUND_REASON_LABELS } from '@/domain/money';
import { EVENT_KIND_LABELS, PAY_TYPE_LABELS } from '@/domain/types';

import type { Cell } from './cells';

/**
 * 엑셀 동기화 파일 형식 (I-30, 구현계획서 3.8).
 * 시트 순서 = 가져올 때 처리 순서 (참조되는 시트가 먼저).
 */

export type FieldKind =
  | 'text'
  | 'date'
  | 'month'
  | 'time'
  | 'money'
  | 'int'
  | 'bool'
  | 'enum'
  | 'members'
  | 'weekdays'
  | 'slots'
  | 'list'
  | 'ref';

export interface Field {
  /** 문서 필드 경로 ('items.tuition' 처럼 점으로 중첩) */
  key: string;
  header: string;
  kind: FieldKind;
  required?: boolean;
  /** enum: 값 → 표시 이름 (드롭다운) */
  labels?: Record<string, string>;
  /** members: 고를 수 있는 구성원 */
  allowed?: string[];
  /** ref: 참조 대상 컬렉션. 보이는 열은 이름, 숨김 열 `${header} ID` 에 id */
  ref?: Collection;
  /** 비어 있을 때 기본값 */
  default?: unknown;
  /** 내보내기만 (가져올 때 무시) */
  readonly?: boolean;
  width?: number;
  /** 열 제목 메모 (입력 규칙) */
  note?: string;
}

export interface SheetDef {
  name: string;
  col: Collection;
  fields: Field[];
  /** 다른 시트에서 이 항목을 고를 때 보이는 이름 */
  label: (doc: Record<string, unknown>, labelOf: (col: Collection, id: unknown) => string) => string;
  /** ID 없는 행의 중복 후보 판별 */
  naturalKey?: (rec: Record<string, unknown>) => string;
  /** 불변 금전 기록 (F-34): 수정 = 원 기록 정정(voided) + 새 기록 */
  immutable?: boolean;
  /** 문서 id 를 내용에서 정함 (납부정보 = 학원 id, 일정 예외 = 회차 키) */
  idFrom?: (rec: Record<string, unknown>) => string;
  /** 새로 만들 때 채우는 값 (기록자 등) */
  onCreate?: (ctx: { by: string; now: string }) => Record<string, unknown>;
  /** 다른 문서에서 따라오는 값 (환불 수령 → 청구 id) */
  derive?: (rec: Record<string, unknown>, docOf: (col: Collection, id: string) => Record<string, unknown> | undefined) => Record<string, unknown>;
  /** 빈 양식의 예시 행 (ID 열 = '예시' 라 가져올 때 건너뜀) */
  example: Record<string, Cell>;
  /** 내보낼 때 제외 (정정된 금전 기록) */
  skipExport?: (doc: Record<string, unknown>) => boolean;
  parentOnly?: boolean;
}

const PARENT = { dad: '아빠', mom: '엄마' };
const CHILD = { son: '아들', daughter: '딸' };
const CHILD_COMMON = { ...CHILD, common: '공통' };
const ACADEMY_STATUS = { active: '운영', closed: '종료' };
const ENROLL_STATUS = { active: '다님', paused: '휴원', ended: '끝남' };
const CYCLE = { monthly: '매월', manual: '수동' };
const TIMING = { prepaid: '선불', postpaid: '후불' };
const SCOPE = { family: '가족', parents: '부모', self: '나만' };
const EXC = { cancelled: '휴강', absent: '결석' };
const SOURCE = { enrollment: '자동', manual: '직접', kakao: '카톡', excel: '엑셀' };

export const LABELS = { PARENT, CHILD, CHILD_COMMON, ACADEMY_STATUS, ENROLL_STATUS, CYCLE, TIMING, SCOPE, EXC, SOURCE };

const s = (v: unknown) => (v == null ? '' : String(v));
const monthLabel = (p: unknown) => (s(p) ? `${Number(s(p).slice(5))}월분` : '');
const recorded = (ctx: { by: string; now: string }) => ({ by: ctx.by, at: ctx.now });
const isVoided = (d: Record<string, unknown>) => !!d.voided;

export const SHEETS: SheetDef[] = [
  {
    name: '장소',
    col: 'places',
    fields: [
      { key: 'name', header: '이름', kind: 'text', required: true, width: 16 },
      { key: 'address', header: '주소', kind: 'text', width: 30 },
      { key: 'memo', header: '메모', kind: 'text', width: 24 },
    ],
    label: (d) => s(d.name),
    naturalKey: (r) => s(r.name),
    example: { 이름: '집', 주소: '', 메모: '' },
  },
  {
    name: '학원',
    col: 'academies',
    fields: [
      { key: 'name', header: '학원명', kind: 'text', required: true, width: 18 },
      { key: 'subject', header: '과목', kind: 'text', default: '', width: 10 },
      { key: 'status', header: '상태', kind: 'enum', labels: ACADEMY_STATUS, default: 'active', width: 8 },
      { key: 'phone', header: '전화', kind: 'text', width: 14 },
      { key: 'address', header: '주소', kind: 'text', width: 24 },
      { key: 'teacher', header: '선생님', kind: 'text', width: 10 },
      { key: 'memo', header: '메모', kind: 'text', width: 20 },
    ],
    label: (d) => s(d.name),
    naturalKey: (r) => s(r.name),
    example: { 학원명: '가나다수학', 과목: '수학', 상태: '운영' },
  },
  {
    name: '납부정보',
    col: 'paymentInfos',
    parentOnly: true,
    fields: [
      { key: 'academyId', header: '학원', kind: 'ref', ref: 'academies', required: true, width: 18 },
      { key: 'payType', header: '납부 방법', kind: 'enum', labels: PAY_TYPE_LABELS, required: true, width: 22 },
      { key: 'payer', header: '납부 담당', kind: 'enum', labels: PARENT, default: 'dad', width: 10 },
      { key: 'url', header: '결제 링크', kind: 'text', width: 30 },
      { key: 'bank', header: '은행', kind: 'text', width: 10 },
      { key: 'account', header: '계좌', kind: 'text', width: 18 },
      { key: 'holder', header: '예금주', kind: 'text', width: 10 },
      { key: 'appName', header: '앱 이름', kind: 'text', width: 12 },
      { key: 'memo', header: '메모', kind: 'text', width: 20 },
    ],
    label: (d, L) => L('academies', d.academyId),
    idFrom: (r) => s(r.academyId),
    example: { 학원: '가나다수학', '납부 방법': '매달 오는 알림톡·문자 링크', '납부 담당': '아빠' },
  },
  {
    name: '수강',
    col: 'enrollments',
    fields: [
      { key: 'childId', header: '자녀', kind: 'enum', labels: CHILD, required: true, width: 8 },
      { key: 'academyId', header: '학원', kind: 'ref', ref: 'academies', required: true, width: 18 },
      { key: 'course', header: '과정', kind: 'text', default: '', width: 14 },
      { key: 'slots', header: '시간표', kind: 'slots', width: 34, note: '예: 월 19:00-21:00, 수 19:00-21:00 (월수 19:00-21:00 도 가능)' },
      { key: 'startDate', header: '시작일', kind: 'date', required: true, width: 12 },
      { key: 'endDate', header: '종료일', kind: 'date', width: 12 },
      { key: 'status', header: '상태', kind: 'enum', labels: ENROLL_STATUS, default: 'active', width: 8 },
    ],
    label: (d, L) => [CHILD[d.childId as keyof typeof CHILD] ?? s(d.childId), L('academies', d.academyId), s(d.course)].filter(Boolean).join(' '),
    naturalKey: (r) => `${s(r.childId)}|${s(r.academyId)}|${s(r.course)}`,
    example: { 자녀: '아들', 학원: '가나다수학', 과정: '정규반', 시간표: '월 19:00-21:00, 수 19:00-21:00', 시작일: '2026-03-02', 상태: '다님' },
  },
  {
    name: '요금',
    col: 'enrollmentCosts',
    parentOnly: true,
    fields: [
      { key: 'enrollmentId', header: '수강', kind: 'ref', ref: 'enrollments', required: true, width: 24 },
      { key: 'effectiveFrom', header: '적용 시작일', kind: 'date', required: true, width: 12 },
      { key: 'amount', header: '금액', kind: 'money', required: true, width: 12 },
      { key: 'cycle', header: '주기', kind: 'enum', labels: CYCLE, default: 'monthly', width: 8 },
      { key: 'payDay', header: '결제일', kind: 'int', default: 1, width: 8, note: '매월 며칠 (1~31)' },
      { key: 'timing', header: '선불/후불', kind: 'enum', labels: TIMING, default: 'prepaid', width: 10 },
      { key: 'memo', header: '메모', kind: 'text', width: 20 },
    ],
    label: (d, L) => `${L('enrollments', d.enrollmentId)} ${s(d.effectiveFrom)}~`,
    naturalKey: (r) => `${s(r.enrollmentId)}|${s(r.effectiveFrom)}`,
    example: { 수강: '아들 가나다수학 정규반', '적용 시작일': '2026-03-01', 금액: 320000, 주기: '매월', 결제일: 5, '선불/후불': '선불' },
  },
  {
    name: '청구',
    col: 'bills',
    parentOnly: true,
    fields: [
      { key: 'period', header: '대상 월', kind: 'month', required: true, width: 10 },
      { key: 'childId', header: '자녀', kind: 'enum', labels: CHILD_COMMON, required: true, width: 8 },
      { key: 'academyId', header: '학원', kind: 'ref', ref: 'academies', required: true, width: 18 },
      { key: 'title', header: '제목', kind: 'text', required: true, width: 22 },
      { key: 'amount', header: '금액', kind: 'money', required: true, width: 12 },
      { key: 'items.tuition', header: '수업료', kind: 'money', width: 10 },
      { key: 'items.books', header: '교재비', kind: 'money', width: 10 },
      { key: 'items.etc', header: '기타 비용', kind: 'money', width: 10 },
      { key: 'dueDate', header: '납부 기한', kind: 'date', required: true, width: 12 },
      { key: 'payer', header: '납부 담당', kind: 'enum', labels: PARENT, default: 'dad', width: 10 },
      { key: 'payUrl', header: '결제 링크', kind: 'text', width: 26 },
      { key: 'cancelled', header: '청구 취소', kind: 'bool', width: 9 },
      { key: 'needsReview', header: '확인 필요', kind: 'bool', width: 9 },
      { key: 'memo', header: '메모', kind: 'text', width: 24 },
      { key: 'source', header: '출처', kind: 'enum', labels: SOURCE, readonly: true, width: 8 },
      { key: 'enrollmentId', header: '수강', kind: 'ref', ref: 'enrollments', width: 22 },
    ],
    label: (d, L) => `${CHILD_COMMON[d.childId as keyof typeof CHILD_COMMON] ?? ''} ${L('academies', d.academyId)} ${monthLabel(d.period)} ${s(d.title)}`.trim(),
    naturalKey: (r) => `${s(r.academyId)}|${s(r.childId)}|${s(r.period)}|${s(r.title)}`,
    onCreate: () => ({ source: 'excel' }),
    example: { '대상 월': '2026-03', 자녀: '아들', 학원: '가나다수학', 제목: '3월 수강료', 금액: 320000, '납부 기한': '2026-03-05', '납부 담당': '아빠' },
  },
  {
    name: '청구조정',
    col: 'adjustments',
    parentOnly: true,
    immutable: true,
    fields: [
      { key: 'billId', header: '청구', kind: 'ref', ref: 'bills', required: true, width: 30 },
      { key: 'amount', header: '감액', kind: 'money', required: true, width: 10 },
      { key: 'reason', header: '사유', kind: 'text', required: true, width: 24 },
    ],
    label: (d, L) => `${L('bills', d.billId)} 조정`,
    naturalKey: (r) => `${s(r.billId)}|${s(r.amount)}|${s(r.reason)}`,
    onCreate: recorded,
    skipExport: isVoided,
    example: { 청구: '아들 가나다수학 3월분 3월 수강료', 감액: 20000, 사유: '형제 할인' },
  },
  {
    name: '납부',
    col: 'payments',
    parentOnly: true,
    immutable: true,
    fields: [
      { key: 'billId', header: '청구', kind: 'ref', ref: 'bills', required: true, width: 30 },
      { key: 'paidOn', header: '납부일', kind: 'date', required: true, width: 12 },
      { key: 'amount', header: '금액', kind: 'money', required: true, width: 12 },
      { key: 'method', header: '수단', kind: 'enum', labels: PAY_METHOD_LABELS, default: 'card', width: 10 },
      { key: 'card', header: '카드', kind: 'text', width: 12 },
      { key: 'memo', header: '메모', kind: 'text', width: 20 },
    ],
    label: (d, L) => `${L('bills', d.billId)} 납부 ${s(d.paidOn)}`,
    naturalKey: (r) => `${s(r.billId)}|${s(r.paidOn)}|${s(r.amount)}`,
    onCreate: recorded,
    skipExport: isVoided,
    example: { 청구: '아들 가나다수학 3월분 3월 수강료', 납부일: '2026-03-04', 금액: 320000, 수단: '카드' },
  },
  {
    name: '환불',
    col: 'refunds',
    parentOnly: true,
    fields: [
      { key: 'billId', header: '청구', kind: 'ref', ref: 'bills', required: true, width: 30 },
      { key: 'causeDate', header: '사유 발생일', kind: 'date', required: true, width: 12 },
      { key: 'requestedOn', header: '요청일', kind: 'date', required: true, width: 12 },
      { key: 'reason', header: '사유', kind: 'enum', labels: REFUND_REASON_LABELS, default: 'etc', width: 10 },
      { key: 'requested', header: '요청액', kind: 'money', required: true, width: 12 },
      { key: 'agreed', header: '합의액', kind: 'money', width: 12 },
      { key: 'withdrawn', header: '요청 철회', kind: 'bool', width: 9 },
      { key: 'memo', header: '메모', kind: 'text', width: 20 },
    ],
    label: (d, L) => `${L('bills', d.billId)} 환불 ${s(d.requestedOn)}`,
    naturalKey: (r) => `${s(r.billId)}|${s(r.requestedOn)}`,
    example: { 청구: '아들 가나다수학 3월분 3월 수강료', '사유 발생일': '2026-03-20', 요청일: '2026-03-21', 사유: '퇴원', 요청액: 160000 },
  },
  {
    name: '환불수령',
    col: 'receipts',
    parentOnly: true,
    immutable: true,
    fields: [
      { key: 'refundId', header: '환불', kind: 'ref', ref: 'refunds', required: true, width: 36 },
      { key: 'receivedOn', header: '받은 날', kind: 'date', required: true, width: 12 },
      { key: 'amount', header: '금액', kind: 'money', required: true, width: 12 },
      { key: 'method', header: '수단', kind: 'enum', labels: PAY_METHOD_LABELS, default: 'transfer', width: 10 },
    ],
    label: (d, L) => `${L('refunds', d.refundId)} 수령 ${s(d.receivedOn)}`,
    naturalKey: (r) => `${s(r.refundId)}|${s(r.receivedOn)}|${s(r.amount)}`,
    onCreate: recorded,
    derive: (r, docOf) => ({ billId: docOf('refunds', s(r.refundId))?.billId ?? '' }),
    skipExport: isVoided,
    example: { 환불: '아들 가나다수학 3월분 3월 수강료 환불 2026-03-21', '받은 날': '2026-03-25', 금액: 160000, 수단: '계좌이체' },
  },
  {
    name: '기타지출',
    col: 'expenses',
    parentOnly: true,
    fields: [
      { key: 'date', header: '날짜', kind: 'date', required: true, width: 12 },
      { key: 'amount', header: '금액', kind: 'money', required: true, width: 12 },
      { key: 'category', header: '분류', kind: 'text', default: '기타', width: 12, note: '예: 교재비, 특강, 모의고사·시험, 교통비, 간식·식비, 준비물, 기타 (새 분류도 가능)' },
      { key: 'childId', header: '자녀', kind: 'enum', labels: CHILD_COMMON, default: 'common', width: 8 },
      { key: 'academyId', header: '학원', kind: 'ref', ref: 'academies', width: 18 },
      { key: 'memo', header: '메모', kind: 'text', width: 24 },
    ],
    label: (d) => `${s(d.date)} ${s(d.category)} ${s(d.amount)}`,
    naturalKey: (r) => `${s(r.date)}|${s(r.amount)}|${s(r.category)}`,
    example: { 날짜: '2026-03-10', 금액: 15000, 분류: '교재비', 자녀: '딸' },
  },
  {
    name: '일정',
    col: 'events',
    fields: [
      { key: 'kind', header: '종류', kind: 'enum', labels: EVENT_KIND_LABELS, default: 'etc', width: 10 },
      { key: 'title', header: '제목', kind: 'text', required: true, width: 20 },
      { key: 'targets', header: '대상', kind: 'members', allowed: ['dad', 'mom', 'son', 'daughter'], required: true, width: 14, note: '예: 아들, 딸' },
      { key: 'date', header: '날짜', kind: 'date', required: true, width: 12, note: '반복 일정은 첫 날짜' },
      { key: 'start', header: '시작', kind: 'time', required: true, width: 8 },
      { key: 'end', header: '끝', kind: 'time', required: true, width: 8 },
      { key: 'repeatWeekdays', header: '반복 요일', kind: 'weekdays', width: 10, note: '매주 반복이면 요일 (예: 월,수,금)' },
      { key: 'repeatUntil', header: '반복 끝', kind: 'date', width: 12 },
      { key: 'place', header: '장소', kind: 'text', width: 14 },
      { key: 'checklist', header: '준비물', kind: 'list', width: 20, note: '쉼표로 구분' },
      { key: 'scope', header: '공개', kind: 'enum', labels: SCOPE, width: 8 },
      { key: 'createdBy', header: '만든 사람', kind: 'enum', labels: { ...PARENT, ...CHILD }, width: 9 },
      { key: 'memo', header: '메모', kind: 'text', width: 20 },
    ],
    label: (d) => `${s(d.title)} ${s(d.date)}`,
    naturalKey: (r) => `${s(r.title)}|${s(r.date)}|${s(r.start)}`,
    onCreate: (ctx) => ({ createdBy: ctx.by }),
    example: { 종류: '모임', 제목: '반 모임', 대상: '딸', 날짜: '2026-03-14', 시작: '14:00', 끝: '16:00' },
  },
  {
    name: '일정예외',
    col: 'exceptions',
    fields: [
      { key: 'occurrenceKey', header: '회차', kind: 'text', required: true, width: 40, note: '앱에서 내보낸 값을 그대로 두세요' },
      { key: 'status', header: '상태', kind: 'enum', labels: EXC, width: 8, note: '휴강/결석, 비우면 정상' },
      { key: 'reason', header: '사유', kind: 'text', width: 16 },
      { key: 'start', header: '바뀐 시작', kind: 'time', width: 9 },
      { key: 'end', header: '바뀐 끝', kind: 'time', width: 9 },
      { key: 'checked', header: '챙긴 준비물', kind: 'list', width: 16 },
    ],
    label: (d) => s(d.occurrenceKey),
    idFrom: (r) => s(r.occurrenceKey),
    example: {},
  },
  {
    name: '방학휴일',
    col: 'holidays',
    fields: [
      { key: 'name', header: '이름', kind: 'text', required: true, width: 16 },
      { key: 'memberIds', header: '대상', kind: 'members', allowed: ['son', 'daughter'], required: true, width: 12 },
      { key: 'start', header: '시작일', kind: 'date', required: true, width: 12 },
      { key: 'end', header: '종료일', kind: 'date', required: true, width: 12 },
      { key: 'skipSchool', header: '등하교 빼기', kind: 'bool', default: true, width: 10 },
      { key: 'skipClass', header: '학원 빼기', kind: 'bool', default: false, width: 10 },
    ],
    label: (d) => `${s(d.name)} ${s(d.start)}`,
    naturalKey: (r) => `${s(r.name)}|${s(r.start)}`,
    example: { 이름: '여름방학', 대상: '아들, 딸', 시작일: '2026-07-20', 종료일: '2026-08-16', '등하교 빼기': '예', '학원 빼기': '아니오' },
  },
];

/** 엑셀에 담지 않는 항목 (정보 시트에 표시, I-30) */
export const NOT_IN_EXCEL = ['알림 설정', '가족 구성원·계정', '변경 이력', '이름 연결(별칭)', '정정(취소)된 납부·수령·조정 기록'];

export const META_HEADERS = { id: 'ID', version: 'version', updatedAt: '수정시각' } as const;
export const refIdHeader = (f: Field) => `${f.header} ID`;
export const EXAMPLE_ID = '예시';
export const SCHEMA = 1;
