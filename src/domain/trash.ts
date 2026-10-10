import type { Collection, Op, StoredDoc } from '@/data/repository';

/**
 * 30일 휴지통 (X-08, Sprint 6). 지우면 원래 문서를 없애고 `trash` 컬렉션(부모 전용)에 보관한다.
 * 30일 안에는 같은 id 로 되살릴 수 있고, 지나면 휴지통 화면을 열 때 정리된다.
 */

export const TRASH_DAYS = 30;

interface Part {
  col: Collection;
  id: string;
  data: Record<string, unknown>;
}

export interface TrashItem {
  /** 화면에 보일 이름, 예: "일정: 치과 10/12" */
  label: string;
  deletedAt: string;
  deletedBy: string;
  /** 첫 항목이 본체, 나머지는 함께 지운 딸린 문서 (일정의 휴강·준비물 기록 등) */
  parts: Part[];
}

const META = ['id', 'version', 'createdAt', 'updatedAt', 'updatedBy', 'schemaVersion'];
const body = (d: StoredDoc) => Object.fromEntries(Object.entries(d).filter(([k]) => !META.includes(k)));

/** 지우기 = 원본 삭제 + 휴지통에 보관 (한 번에) */
export function trashOps(args: { trashId: string; label: string; by: string; now: string; docs: { col: Collection; doc: StoredDoc }[] }): Op[] {
  const item: TrashItem = {
    label: args.label,
    deletedAt: args.now,
    deletedBy: args.by,
    parts: args.docs.map(({ col, doc }) => ({ col, id: doc.id, data: body(doc) })),
  };
  return [
    ...args.docs.map(({ col, doc }): Op => ({ type: 'delete', col, id: doc.id, expectVersion: doc.version })),
    { type: 'create', col: 'trash', id: args.trashId, data: item as unknown as Record<string, unknown> },
  ];
}

/** 되살리기 = 원본을 같은 id 로 다시 만들고 휴지통에서 제거 */
export function restoreFromTrash(item: StoredDoc<TrashItem>): Op[] {
  return [
    ...item.parts.map((p): Op => ({ type: 'create', col: p.col, id: p.id, data: p.data })),
    { type: 'delete', col: 'trash', id: item.id, expectVersion: item.version },
  ];
}

export const daysLeft = (item: TrashItem, now: string) => TRASH_DAYS - Math.floor((Date.parse(now) - Date.parse(item.deletedAt)) / 86_400_000);

/** 30일 지난 항목 (완전히 지울 대상) */
export const expiredTrash = <T extends TrashItem>(items: T[], now: string) => items.filter((i) => daysLeft(i, now) <= 0);
