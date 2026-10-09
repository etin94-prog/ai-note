import { describe, expect, it } from 'vitest';

import { MemoryRepository } from '@/data/memory/MemoryRepository';

import { buildSetupOps, emptyDraft, enrollmentProblem } from './setup';

let n = 0;
const newId = () => `id${++n}`;

describe('처음 설정 마법사 (I-03)', () => {
  it('장소·학원(납부 정보)·수강(비용)을 한 번에 저장', async () => {
    const d = emptyDraft();
    d.homeAddress = '가상시 가상구 1';
    d.schools = { son: '가상고등학교', daughter: '가상중학교' };
    d.academies = [{ key: 'k1', name: '가나다수학', subject: '수학', phone: '0200000000', payType: 'monthlyLink', url: '', payer: 'dad' }];
    d.enrollments = [
      {
        key: 'e1',
        academyKey: 'k1',
        childId: 'son',
        course: '정규반',
        weekdays: [1, 3],
        start: '19:00',
        end: '21:00',
        fee: 320000,
        payDay: 5,
        startDate: '2026-10-01',
      },
      {
        key: 'e2',
        academyKey: 'k1',
        childId: 'daughter',
        course: '',
        weekdays: [2],
        start: '17:00',
        end: '18:30',
        fee: 0,
        payDay: 1,
        startDate: '2026-10-01',
      },
    ];
    const ops = buildSetupOps(d, { newId, existingPlaces: ['가상중학교'] });
    expect(ops.map((o) => o.col)).toEqual([
      'places',
      'places',
      'academies',
      'paymentInfos',
      'enrollments',
      'enrollmentCosts',
      'enrollments',
    ]);
    const repo = new MemoryRepository();
    expect((await repo.applyBatch(ops, { by: 'mom', label: '처음 설정' })).ok).toBe(true);
    const [academy] = await repo.list<{ name: string }>('academies');
    expect(await repo.get('paymentInfos', academy.id)).toMatchObject({ academyId: academy.id, payType: 'monthlyLink', payer: 'dad' });
    expect(await repo.list('enrollmentCosts')).toEqual([
      expect.objectContaining({ amount: 320000, payDay: 5, effectiveFrom: '2026-10-01' }),
    ]);
  });

  it('입력 검사', () => {
    const e = {
      key: 'e',
      academyKey: 'k',
      childId: 'son' as const,
      course: '',
      weekdays: [],
      start: '19:00',
      end: '21:00',
      fee: 0,
      payDay: 1,
      startDate: '2026-10-01',
    };
    expect(enrollmentProblem(e)).toContain('요일');
    expect(enrollmentProblem({ ...e, weekdays: [1], end: '18:00' })).toContain('늦어야');
    expect(enrollmentProblem({ ...e, weekdays: [1] })).toBeNull();
  });
});
