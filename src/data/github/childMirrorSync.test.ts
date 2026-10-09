import { describe, expect, it } from 'vitest';

import type { MirrorSource } from '@/domain/childMirror';

import { syncChildMirror } from './childMirrorSync';
import { FakeGitHubApi } from './FakeGitHubApi';

const meta = (id: string) => ({ id, version: 1, createdAt: 'x', updatedAt: 'x', updatedBy: 'dad', schemaVersion: 1 });
const src: MirrorSource = {
  academies: [{ ...meta('a'), name: '수학', subject: '', status: 'active' }],
  enrollments: [{ ...meta('e'), childId: 'son', academyId: 'a', course: '', startDate: '2026-01-01', status: 'active', slots: [] }],
  events: [],
  exceptions: [],
  places: [],
  holidays: [],
};

describe('syncChildMirror', () => {
  it('처음엔 파일 생성, 같은 상태로 다시 돌리면 커밋 없음, 원본에서 빠지면 삭제', async () => {
    const api = new FakeGitHubApi();
    expect((await syncChildMirror(api, 'son', src, '사본 갱신')).changed).toBe(2);
    expect(api.commits).toHaveLength(1);
    expect((await syncChildMirror(api, 'son', src, '사본 갱신')).changed).toBe(0);
    expect(api.commits).toHaveLength(1);
    const r = await syncChildMirror(api, 'son', { ...src, enrollments: [] }, '사본 갱신');
    expect(r.changed).toBe(2); // 수강 삭제 + 그 학원도 더 이상 안 보임
  });

  it('부모 전용 경로(data/private)는 사본에 생기지 않는다', async () => {
    const api = new FakeGitHubApi();
    await syncChildMirror(api, 'son', src, '사본 갱신');
    expect(api.commits[0].paths.some((p) => p.startsWith('data/private/'))).toBe(false);
  });
});
