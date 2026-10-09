import { afterEach, describe, expect, it, vi } from 'vitest';

import { FetchGitHubApi, GitHubApiError } from './GitHubApi';

afterEach(() => vi.unstubAllGlobals());

describe('FetchGitHubApi', () => {
  it('기본 fetch 를 전역 this 로 호출한다 (브라우저 Illegal invocation 회귀 방지)', async () => {
    // 브라우저 fetch 처럼 this 가 전역이 아니면 실패하는 가짜
    const strictFetch = function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      return Promise.resolve(new Response(null, { status: 401 }));
    };
    vi.stubGlobal('fetch', strictFetch);
    const api = new FetchGitHubApi({ owner: 'o', repo: 'r' }, 'github_pat_x');
    await expect(api.readTree()).rejects.toMatchObject({ status: 401 });
  });

  it('인증 헤더와 저장소 경로로 요청하고 상태 코드를 오류에 담는다', async () => {
    const calls: { url: string; auth: string | null }[] = [];
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls.push({ url, auth: new Headers(init.headers).get('Authorization') });
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    const api = new FetchGitHubApi({ owner: 'etin94-prog', repo: 'ai-note-data' }, 'github_pat_x');
    const err = await api.readTree().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubApiError);
    expect((err as GitHubApiError).status).toBe(404);
    expect(calls[0]).toEqual({
      url: 'https://api.github.com/repos/etin94-prog/ai-note-data/git/ref/heads/main',
      auth: 'Bearer github_pat_x',
    });
  });
});
