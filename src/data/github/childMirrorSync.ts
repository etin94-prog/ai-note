import { childProjection, type MirrorSource } from '@/domain/childMirror';
import type { MemberId } from '@/domain/types';

import type { FileChange, GitHubApi } from './GitHubApi';
import { gitBlobSha } from './gitSha';
import { docPath, serializeDoc } from './paths';

export interface MirrorResult {
  child: MemberId;
  changed: number;
  error?: string;
}

/**
 * 자녀 사본 저장소를 부모 데이터와 맞춘다 (D-14).
 * 원하는 파일 목록과 저장소 현재 파일을 비교해 바뀐 것만 커밋 1개로 반영. 같은 상태면 아무것도 안 함.
 * 여러 부모 기기가 동시에 실행해도 결과가 같다 (멱등).
 */
export async function syncChildMirror(
  api: GitHubApi,
  child: MemberId,
  src: MirrorSource,
  message: string,
): Promise<MirrorResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const tree = await api.readTree();
    if (tree.notModified) throw new Error('unexpected notModified');
    const current = new Map(tree.entries.filter((e) => e.path.startsWith('data/')).map((e) => [e.path, e.sha]));

    const desired = new Map<string, string>();
    for (const d of childProjection(child, src)) desired.set(docPath(d.col, d.id), serializeDoc(d.doc));

    const changes: FileChange[] = [];
    for (const [path, content] of desired) {
      if (current.get(path) !== (await gitBlobSha(content))) changes.push({ path, content });
    }
    for (const path of current.keys()) if (!desired.has(path)) changes.push({ path, content: null });

    if (changes.length === 0) return { child, changed: 0 };
    const res = await api.commit(changes, message, tree.headSha);
    if (res.ok) return { child, changed: changes.length };
  }
  return { child, changed: 0, error: '다른 기기와 동시에 갱신 중 — 다음에 다시 시도' };
}
