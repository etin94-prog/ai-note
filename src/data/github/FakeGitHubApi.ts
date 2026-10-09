import type { CommitResult, FileChange, GitHubApi, TreeResult } from './GitHubApi';
import { gitBlobSha } from './gitSha';

/**
 * 테스트용 가짜 GitHub. 커밋·fast-forward 검사·etag 를 흉내 낸다.
 * 여러 GitHubRepository 가 같은 인스턴스를 공유하면 "여러 기기" 상황을 재현할 수 있다.
 */
export class FakeGitHubApi implements GitHubApi {
  head = 'c0';
  private files = new Map<string, { sha: string; content: string }>();
  private n = 0;
  commits: { sha: string; message: string; paths: string[] }[] = [];
  /** 테스트에서 호출 수 확인용 */
  calls = { readTree: 0, readBlob: 0, commit: 0 };

  async readTree(etag?: string): Promise<TreeResult> {
    this.calls.readTree++;
    if (etag === this.head) return { notModified: true };
    return {
      notModified: false,
      headSha: this.head,
      etag: this.head,
      entries: [...this.files].map(([path, f]) => ({ path, sha: f.sha })),
    };
  }

  async readBlob(sha: string): Promise<string> {
    this.calls.readBlob++;
    for (const f of this.files.values()) if (f.sha === sha) return f.content;
    throw new Error(`blob ${sha} 없음`);
  }

  async commit(changes: FileChange[], message: string, parentSha: string): Promise<CommitResult> {
    this.calls.commit++;
    if (parentSha !== this.head) return { ok: false, reason: 'non-fast-forward' };
    for (const c of changes) {
      if (c.content === null) this.files.delete(c.path);
      else this.files.set(c.path, { sha: await gitBlobSha(c.content), content: c.content });
    }
    this.head = `c${++this.n}`;
    this.commits.push({ sha: this.head, message, paths: changes.map((c) => c.path) });
    return { ok: true, headSha: this.head };
  }

  /** GitHub 웹 등 앱 밖에서 생긴 커밋 흉내 */
  async externalCommit(changes: FileChange[]) {
    return this.commit(changes, 'external', this.head);
  }
}
