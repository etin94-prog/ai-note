import { describe, expect, it } from 'vitest';

import { MemoryRepository } from '@/data/memory/MemoryRepository';

import { applyInChunks, countDocs, loadAll, makeBackup, parseBackup, resetOps, restoreOps } from './backup';

const ctx = (label: string) => ({ by: 'dad', label });

describe('백업·초기화·복원 (I-20)', () => {
  it('백업 → 초기화 → 복원하면 같은 내용', async () => {
    const repo = new MemoryRepository();
    await repo.applyBatch(
      [
        { type: 'create', col: 'academies', id: 'a1', data: { name: '가나다수학', status: 'active', phone: '0200000000' } },
        { type: 'create', col: 'bills', id: 'b1', data: { title: 'x', amount: 1 } },
        { type: 'create', col: 'places', id: 'p1', data: { name: '집' } },
      ],
      ctx('seed'),
    );
    const before = await loadAll(repo);
    const file = JSON.stringify(makeBackup(before, { exportedAt: 'now', mode: 'memory', by: '아빠' }));

    await applyInChunks(repo, resetOps(before), '초기화', ctx, 2);
    expect(countDocs(await loadAll(repo))).toBe(0);

    // 초기화 뒤 새로 입력한 것 + 백업과 같은 id 의 다른 내용
    await repo.create('places', 'p2', { name: '학교' }, ctx('x'));
    await repo.create('academies', 'a1', { name: '바뀐 이름', subject: '영어' }, ctx('x'));

    const b = parseBackup(file);
    await applyInChunks(repo, restoreOps(await loadAll(repo), b.data), '복원', ctx);
    const after = await loadAll(repo);
    expect(countDocs(after)).toBe(3);
    const a1 = after.academies!.find((d) => d.id === 'a1')!;
    expect(a1).toMatchObject({ name: '가나다수학', phone: '0200000000', subject: null });
    expect(after.places!.map((d) => d.id)).toEqual(['p1']);
  });

  it('다른 파일은 거부', () => {
    expect(() => parseBackup('{"a":1}')).toThrow('백업 파일이 아닙니다');
    expect(() => parseBackup('not json')).toThrow('JSON');
  });
});
