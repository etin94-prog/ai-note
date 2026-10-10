/**
 * 저장소 계층 공통 계약 (구현계획서 3.1).
 * 화면·도메인 로직은 이 인터페이스만 사용하고, 저장 모드(GitHub / Firebase)는 모른다.
 */

/** 컬렉션 이름. 경로 규칙: `{컬렉션}/{id}` (두 모드 공통, Requirement 13장). */
export const PUBLIC_COLLECTIONS = [
  'members',
  'accountLinks',
  'joinRequests',
  'reminderPolicies',
  'places',
  'holidays',
  'academies',
  'enrollments',
  'events',
  'exceptions',
  'aliases',
  'notifications',
] as const;

/** 부모 전용 컬렉션 — Firestore: private/finance 아래, GitHub: data/private 아래. */
export const PRIVATE_COLLECTIONS = [
  'enrollmentCosts',
  'paymentInfos',
  'bills',
  'payments',
  'adjustments',
  'refunds',
  'receipts',
  'expenses',
  'expenseCategories',
  'cardTxns',
  'inboundMessages',
  'auditLogs',
  'importBatches',
  /** 30일 휴지통 (X-08) — 지운 문서 보관 */
  'trash',
] as const;

export type PublicCollection = (typeof PUBLIC_COLLECTIONS)[number];
export type PrivateCollection = (typeof PRIVATE_COLLECTIONS)[number];
export type Collection = PublicCollection | PrivateCollection;

export function isPrivateCollection(col: Collection): col is PrivateCollection {
  return (PRIVATE_COLLECTIONS as readonly string[]).includes(col);
}

/** 모든 문서의 공통 필드. */
export interface DocMeta {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** memberId (U-13) */
  updatedBy: string;
  schemaVersion: number;
}

export type StoredDoc<T = Record<string, unknown>> = T & DocMeta;

/** 쓰기 주체 정보. 커밋 메시지·변경 이력에 사용. */
export interface WriteContext {
  by: string;
  /** 사람이 읽는 작업 설명, 예: "납부 기록: 딸 영어 11월분" */
  label: string;
  /** 기기 이름, 예: "엄마 아이폰" (GitHub 커밋 메시지용) */
  device?: string;
}

export type Op =
  | { type: 'create'; col: Collection; id: string; data: Record<string, unknown> }
  | { type: 'update'; col: Collection; id: string; patch: Record<string, unknown>; expectVersion: number }
  | { type: 'delete'; col: Collection; id: string; expectVersion: number };

export type CreateResult = 'created' | 'exists';
export type UpdateResult = 'ok' | 'conflict' | 'missing';

export interface BatchResult {
  ok: boolean;
  batchId: string;
  /** 실패 시 충돌·누락된 항목 */
  conflicts: { col: Collection; id: string; reason: 'conflict' | 'exists' | 'missing' }[];
}

export interface RevertResult {
  reverted: number;
  /** 가져온 뒤 다른 변경이 생겨 되돌리지 않은 항목 */
  conflicts: { col: Collection; id: string }[];
}

export interface PendingState {
  /** 서버로 보내는 중인 저장 건수 */
  count: number;
  /** 보내지 못해 되돌린 저장 건수 (사용자가 확인하면 0으로) */
  failed: number;
  online: boolean;
  /** 마지막 실패 내용 (사람이 읽는 문장) */
  lastError?: string;
}

export type Unsubscribe = () => void;
export type Listener<T> = (value: T) => void;

export interface Repository {
  readonly mode: 'github' | 'firebase' | 'memory';

  /** 컬렉션 전체를 구독. 변경 시마다 다시 호출된다. */
  watch<T>(col: Collection, listener: Listener<StoredDoc<T>[]>): Unsubscribe;
  get<T>(col: Collection, id: string): Promise<StoredDoc<T> | undefined>;
  list<T>(col: Collection): Promise<StoredDoc<T>[]>;

  /** id 고정 생성 — 이미 있으면 아무것도 바꾸지 않고 'exists' (멱등, Codex v1.1 #4·#7). */
  create<T extends Record<string, unknown>>(col: Collection, id: string, data: T, ctx: WriteContext): Promise<CreateResult>;
  /** version 이 다르면 'conflict' (Codex v1.0 #8). */
  update<T extends Record<string, unknown>>(
    col: Collection,
    id: string,
    patch: Partial<T>,
    expectVersion: number,
    ctx: WriteContext,
  ): Promise<UpdateResult>;
  remove(col: Collection, id: string, expectVersion: number, ctx: WriteContext): Promise<UpdateResult>;

  /** 여러 작업을 원자적으로. 하나라도 충돌하면 전부 반영하지 않는다. */
  applyBatch(ops: Op[], ctx: WriteContext): Promise<BatchResult>;
  /** applyBatch 로 반영한 작업을 되돌린다. 이후 다른 변경이 있는 항목은 건너뛰고 보고한다. */
  revertBatch(batchId: string, ctx: WriteContext): Promise<RevertResult>;

  pending(listener: Listener<PendingState>): Unsubscribe;
  /** 전송 대기 작업을 모두 보낼 때까지 최대 timeoutMs 대기. 다 보냈으면 true (U-12). */
  flush(timeoutMs: number): Promise<boolean>;
  /** 저장 실패 알림을 확인했음 (failed·lastError 초기화). 실패가 생길 수 없는 저장소는 없어도 됨 */
  ackFailures?(): void;
}
