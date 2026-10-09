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
