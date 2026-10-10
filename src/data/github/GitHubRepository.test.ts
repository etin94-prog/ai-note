import { describe, expect, it } from 'vitest';

import { repositoryContract } from '../contract/repositoryContract';
import type { WriteContext } from '../repository';
import { FakeGitHubApi } from './FakeGitHubApi';
import { GitHubRepository } from './GitHubRepository';
import { docPath, parseDocPath } from './paths';

repositoryContract('GitHubRepository (FakeGitHubApi)', () => new GitHubRepository(new FakeGitHubApi()));

const mom: WriteContext = { by: 'mom', label: '납부 기록: 딸 영어 11월분', device: '엄마 아이폰' };
const dad: WriteContext = { by: 'dad', label: '일정 수정', device: '아빠 폰' };

describe('GitHub 모드 — 여러 기기', () => {
  it('엄마 기기 저장이 아빠 기기에서 sync 후 보인다 (S0-4)', async () => {
    const api = new FakeGitHubApi();
    const momRepo = new GitHubRepository(api);
    const dadRepo = new GitHubRepository(api);
    await dadRepo.list('payments'); // 아빠가 먼저 열어 둔 상태
    await momRepo.create('payments', 'p1', { amount: 320000 }, mom);
    expect(await dadRepo.list('payments')).toHaveLength(0); // 아직 확인 전
    await dadRepo.sync();
    expect(await dadRepo.list('payments')).toHaveLength(1);
  });

  it('다른 항목을 동시에 저장하면 둘 다 보존 (다른 기기가 먼저 커밋해도 재시도)', async () => {
    const api = new FakeGitHubApi();
    const momRepo = new GitHubRepository(api);
    const dadRepo = new GitHubRepository(api);
    await Promise.all([momRepo.list('events'), dadRepo.list('events')]);
    await Promise.all([
      momRepo.create('payments', 'p-mom', { amount: 1 }, mom),
      dadRepo.create('events', 'e-dad', { title: '수학' }, dad),
    ]);
    const check = new GitHubRepository(api);
    expect(await check.list('payments')).toHaveLength(1);
    expect(await check.list('events')).toHaveLength(1);
  });

  it('같은 항목을 같은 version 으로 동시에 고치면 한쪽은 충돌 (S0-6)', async () => {
    const api = new FakeGitHubApi();
    const a = new GitHubRepository(api);
    await a.create('events', 'e1', { title: '원본' }, mom);
    const b = new GitHubRepository(api);
    await b.list('events');
    expect(await a.update('events', 'e1', { title: '엄마 수정' }, 1, mom)).toBe('ok');
    expect(await b.update('events', 'e1', { title: '아빠 수정' }, 1, dad)).toBe('conflict');
  });

  it('배치 1개 = 커밋 1개, 커밋 메시지에 기기·작업 표시 (G-07)', async () => {
    const api = new FakeGitHubApi();
    const repo = new GitHubRepository(api);
    await repo.applyBatch(
      [
        { type: 'create', col: 'academies', id: 'a1', data: { name: '가나다영어' } },
        { type: 'create', col: 'bills', id: 'enr1:2026-11-01', data: { amount: 320000 } },
      ],
      { by: 'dad', label: '엑셀 가져오기', device: 'PC' },
    );
    expect(api.commits).toHaveLength(1);
    expect(api.commits[0].message).toBe('[PC] 엑셀 가져오기');
    expect(api.commits[0].paths).toEqual(['data/academies/a1.json', 'data/private/bills/enr1%3A2026-11-01.json']);
  });

  it('변경 없으면 다시 받지 않는다 (etag, G-09)', async () => {
    const api = new FakeGitHubApi();
    const repo = new GitHubRepository(api);
    await repo.create('places', 'home', { name: '집' }, mom);
    const blobs = api.calls.readBlob;
    await repo.sync();
    await repo.sync();
    expect(api.calls.readBlob).toBe(blobs);
  });

  it('앱 밖에서 지워진 파일은 캐시에서도 사라진다', async () => {
    const api = new FakeGitHubApi();
    const repo = new GitHubRepository(api);
    await repo.create('places', 'home', { name: '집' }, mom);
    await api.externalCommit([{ path: docPath('places', 'home'), content: null }]);
    await repo.sync();
    expect(await repo.list('places')).toHaveLength(0);
  });
});

describe('경로 규칙', () => {
  it('부모 전용 컬렉션은 data/private 아래', () => {
    expect(docPath('bills', 'x')).toBe('data/private/bills/x.json');
    expect(docPath('events', 'x')).toBe('data/events/x.json');
  });
  it('잘못 놓인 파일은 무시', () => {
    expect(parseDocPath('data/bills/x.json')).toBeNull();
    expect(parseDocPath('data/private/events/x.json')).toBeNull();
    expect(parseDocPath('README.md')).toBeNull();
    expect(parseDocPath('data/private/bills/enr1%3A2026-11-01.json')).toEqual({ col: 'bills', id: 'enr1:2026-11-01' });
  });
});

// 앱에서 쓰는 방식: 화면 먼저 반영 + 뒤에서 전송. 계약 테스트도 그대로 통과해야 한다.
repositoryContract('GitHubRepository (화면 먼저 반영)', () => new GitHubRepository(new FakeGitHubApi(), { optimistic: true, retryDelayMs: 0 }));

describe('GitHub 모드 — 화면 먼저 반영 (저장 즉시 보이고 뒤에서 전송)', () => {
  const opt = (api: FakeGitHubApi) => new GitHubRepository(api, { optimistic: true, retryDelayMs: 0 });

  it('저장 직후 화면에 보이고, 전송 중 건수가 알려지고, 끝나면 GitHub 에 있다', async () => {
    const api = new FakeGitHubApi(20);
    const repo = opt(api);
    await repo.list('events');
    const seen: number[] = [];
    repo.watch('events', (d) => seen.push(d.length));
    const pend: number[] = [];
    repo.pending((p) => pend.push(p.count));

    const r = await repo.create('events', 'e1', { title: '치과' }, mom);
    expect(r).toBe('created');
    expect(api.commits).toHaveLength(0); // 아직 보내는 중
    expect(seen[seen.length - 1]).toBe(1); // 그런데 화면에는 이미 있음
    expect(await repo.get('events', 'e1')).toMatchObject({ title: '치과', version: 1 });
    expect(Math.max(...pend)).toBe(1);

    expect(await repo.flush(2000)).toBe(true);
    expect(api.commits).toHaveLength(1);
    expect(pend[pend.length - 1]).toBe(0);
    const other = new GitHubRepository(api);
    expect(await other.get('events', 'e1')).toMatchObject({ title: '치과' });
  });

  it('보내기 전에 같은 항목을 이어서 고쳐도 순서대로 반영 (추가 → 수정 → 삭제)', async () => {
    const api = new FakeGitHubApi(5);
    const repo = opt(api);
    await repo.create('places', 'p1', { name: '집' }, mom);
    expect(await repo.update('places', 'p1', { name: '우리 집' }, 1, mom)).toBe('ok');
    await repo.create('places', 'p2', { name: '학교' }, mom);
    expect(await repo.remove('places', 'p2', 1, mom)).toBe('ok');
    expect((await repo.list<{ name: string }>('places')).map((p) => p.name)).toEqual(['우리 집']);
    await repo.flush(2000);
    const other = new GitHubRepository(api);
    expect((await other.list<{ name: string }>('places')).map((p) => [p.name, p.version])).toEqual([['우리 집', 2]]);
    expect(api.commits).toHaveLength(4);
  });

  it('다른 기기가 먼저 바꾼 항목이면 되돌리고 실패를 알린다', async () => {
    const api = new FakeGitHubApi();
    const momRepo = opt(api);
    const dadRepo = new GitHubRepository(api);
    await momRepo.create('events', 'e1', { title: '원래' }, mom);
    await momRepo.flush(2000);
    await dadRepo.sync();
    await dadRepo.update('events', 'e1', { title: '아빠가 수정' }, 1, dad); // 엄마 기기는 아직 모름

    let last = { count: 0, failed: 0, lastError: undefined as string | undefined };
    momRepo.pending((p) => (last = { count: p.count, failed: p.failed, lastError: p.lastError }));
    expect(await momRepo.update('events', 'e1', { title: '엄마가 수정' }, 1, mom)).toBe('ok'); // 화면에는 일단 반영
    expect(await momRepo.get('events', 'e1')).toMatchObject({ title: '엄마가 수정' });
    await momRepo.flush(2000);
    expect(await momRepo.get('events', 'e1')).toMatchObject({ title: '아빠가 수정', version: 2 }); // 되돌리고 최신 내용
    expect(last.failed).toBe(1);
    expect(last.lastError).toContain('다른 기기');
    momRepo.ackFailures();
    expect(last.failed).toBe(0);
  });

  it('통신 오류는 다시 시도하고, 계속 실패하면 되돌린다', async () => {
    const api = new FakeGitHubApi();
    const repo = opt(api);
    await repo.list('expenses');
    api.failCommits = 2; // 두 번 실패 후 성공
    await repo.create('expenses', 'x1', { amount: 1000 }, mom);
    await repo.flush(2000);
    expect(api.commits).toHaveLength(1);

    api.failCommits = 5; // 계속 실패
    let failed = 0;
    repo.pending((p) => (failed = p.failed));
    await repo.create('expenses', 'x2', { amount: 2000 }, mom);
    expect(await repo.list('expenses')).toHaveLength(2);
    await repo.flush(2000);
    expect((await repo.list('expenses')).map((d) => d.id)).toEqual(['x1']);
    expect(failed).toBe(1);
  });

  it('되돌리기(실행 취소)도 전송이 끝난 뒤 순서대로', async () => {
    const api = new FakeGitHubApi(5);
    const repo = opt(api);
    const r = await repo.applyBatch([{ type: 'create', col: 'payments', id: 'p1', data: { amount: 1 } }], mom);
    const rev = await repo.revertBatch(r.batchId, mom);
    expect(rev.reverted).toBe(1);
    expect(await repo.list('payments')).toHaveLength(0);
  });
});
