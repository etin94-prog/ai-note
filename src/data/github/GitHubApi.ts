/**
 * GitHub 데이터 저장소 접근 (구현계획서 3.2).
 * GitHubRepository 는 이 인터페이스만 쓰고, 테스트에서는 FakeGitHubApi 로 바꿔 끼운다.
 */

export interface TreeEntry {
  path: string;
  sha: string;
}

export type TreeResult =
  | { notModified: true }
  | { notModified: false; headSha: string; etag?: string; entries: TreeEntry[] };

export interface FileChange {
  path: string;
  /** null 이면 삭제 */
  content: string | null;
}

export type CommitResult = { ok: true; headSha: string } | { ok: false; reason: 'non-fast-forward' };

export interface GitHubApi {
  /** 기본 브랜치의 전체 파일 목록. etag 가 같으면 notModified (요청 한도 절약). */
  readTree(etag?: string): Promise<TreeResult>;
  readBlob(sha: string): Promise<string>;
  /** 여러 파일 변경을 커밋 1개로. parentSha 가 현재 브랜치 끝이 아니면 non-fast-forward. */
  commit(changes: FileChange[], message: string, parentSha: string): Promise<CommitResult>;
}

export interface GitHubRepoRef {
  owner: string;
  repo: string;
  branch?: string;
}

export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 실제 GitHub REST API 구현. 토큰은 저장소 하나에만 Contents 권한이 있는 fine-grained token (G-01). */
export class FetchGitHubApi implements GitHubApi {
  private readonly base: string;
  private readonly branch: string;
  /** 응답 헤더의 토큰 만료 시각 (만료 14일 전 경고용) */
  tokenExpiresAt: string | null = null;

  constructor(
    ref: GitHubRepoRef,
    private readonly token: string,
    // 브라우저의 fetch 는 window 에 묶여 있어야 한다 — 객체 필드로 보관 후 그대로 호출하면 "Illegal invocation"
    private readonly fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init),
  ) {
    this.base = `https://api.github.com/repos/${ref.owner}/${ref.repo}`;
    this.branch = ref.branch ?? 'main';
  }

  private async call(path: string, init: RequestInit = {}, etag?: string): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (init.body) headers['Content-Type'] = 'application/json';
    if (etag) headers['If-None-Match'] = etag;
    const res = await this.fetchImpl(`${this.base}${path}`, { ...init, headers, cache: 'no-store' });
    const exp = res.headers.get('github-authentication-token-expiration');
    if (exp) this.tokenExpiresAt = exp;
    if (res.status === 304) return res;
    if (!res.ok) throw new GitHubApiError(res.status, `${init.method ?? 'GET'} ${path} → ${res.status}`);
    return res;
  }

  async readTree(etag?: string): Promise<TreeResult> {
    const refRes = await this.call(`/git/ref/heads/${this.branch}`, {}, etag);
    if (refRes.status === 304) return { notModified: true };
    const ref = (await refRes.json()) as { object: { sha: string } };
    const headSha = ref.object.sha;
    const commit = (await (await this.call(`/git/commits/${headSha}`)).json()) as { tree: { sha: string } };
    const tree = (await (await this.call(`/git/trees/${commit.tree.sha}?recursive=1`)).json()) as {
      tree: { path: string; sha: string; type: string }[];
      truncated: boolean;
    };
    if (tree.truncated) throw new GitHubApiError(500, '파일 목록이 너무 커서 잘렸습니다');
    return {
      notModified: false,
      headSha,
      etag: refRes.headers.get('etag') ?? undefined,
      entries: tree.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, sha: e.sha })),
    };
  }

  async readBlob(sha: string): Promise<string> {
    const blob = (await (await this.call(`/git/blobs/${sha}`)).json()) as { content: string; encoding: string };
    const bin = atob(blob.content.replace(/\n/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }

  async commit(changes: FileChange[], message: string, parentSha: string): Promise<CommitResult> {
    const parent = (await (await this.call(`/git/commits/${parentSha}`)).json()) as { tree: { sha: string } };
    const tree = (await (
      await this.call('/git/trees', {
        method: 'POST',
        body: JSON.stringify({
          base_tree: parent.tree.sha,
          tree: changes.map((c) =>
            c.content === null
              ? { path: c.path, mode: '100644', type: 'blob', sha: null }
              : { path: c.path, mode: '100644', type: 'blob', content: c.content },
          ),
        }),
      })
    ).json()) as { sha: string };
    const commit = (await (
      await this.call('/git/commits', {
        method: 'POST',
        body: JSON.stringify({ message, tree: tree.sha, parents: [parentSha] }),
      })
    ).json()) as { sha: string };
    try {
      await this.call(`/git/refs/heads/${this.branch}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha, force: false }),
      });
    } catch (e) {
      // 다른 기기가 먼저 커밋함 → 최신을 받아 다시 시도해야 함
      if (e instanceof GitHubApiError && e.status === 422) return { ok: false, reason: 'non-fast-forward' };
      throw e;
    }
    return { ok: true, headSha: commit.sha };
  }
}
