import { type Collection, isPrivateCollection, PRIVATE_COLLECTIONS, PUBLIC_COLLECTIONS } from '../repository';

/**
 * GitHub 모드 파일 경로 규칙 (Requirement 13장).
 *   공개: data/{컬렉션}/{id}.json
 *   부모 전용: data/private/{컬렉션}/{id}.json
 * id 는 파일명에 안전하도록 인코딩한다 (청구 billKey 의 ':' 등 — Windows 체크아웃 대비).
 */
export function docPath(col: Collection, id: string): string {
  const dir = isPrivateCollection(col) ? `data/private/${col}` : `data/${col}`;
  return `${dir}/${encodeURIComponent(id)}.json`;
}

const ALL = new Set<string>([...PUBLIC_COLLECTIONS, ...PRIVATE_COLLECTIONS]);

export function parseDocPath(path: string): { col: Collection; id: string } | null {
  const m = /^data\/(?:private\/)?([^/]+)\/([^/]+)\.json$/.exec(path);
  if (!m || !ALL.has(m[1])) return null;
  const col = m[1] as Collection;
  // 공개 컬렉션이 private 아래 있거나 그 반대면 무시 (잘못 놓인 파일)
  if (path.startsWith('data/private/') !== isPrivateCollection(col)) return null;
  return { col, id: decodeURIComponent(m[2]) };
}

/** 사람이 GitHub 에서 읽기 쉬운 JSON (diff 친화). */
export function serializeDoc(doc: unknown): string {
  return JSON.stringify(doc, null, 2) + '\n';
}
