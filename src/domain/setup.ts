import type { Op } from '@/data/repository';

import type { EnrollmentCost } from './money';
import type { Academy, Enrollment, MemberId, PayType, PaymentInfo, Place, Weekday } from './types';

/**
 * 처음 설정 마법사 (I-03): 장소(집·학교) → 학원(납부 정보) → 수강(시간표·비용) 을 한 번에 저장.
 * 저장 모양은 각 화면 폼과 같다 (I-05). 반영은 applyBatch 1회 (GitHub 모드 커밋 1개).
 */

export interface DraftAcademy {
  key: string;
  name: string;
  subject: string;
  phone: string;
  payType: PayType;
  url: string;
  payer: MemberId;
}

export interface DraftEnrollment {
  key: string;
  academyKey: string;
  childId: MemberId;
  course: string;
  weekdays: Weekday[];
  start: string;
  end: string;
  fee: number;
  payDay: number;
  startDate: string;
}

export interface SetupDraft {
  homeAddress: string;
  schools: Partial<Record<'son' | 'daughter', string>>;
  academies: DraftAcademy[];
  enrollments: DraftEnrollment[];
}

export const emptyDraft = (): SetupDraft => ({ homeAddress: '', schools: {}, academies: [], enrollments: [] });

export function buildSetupOps(d: SetupDraft, ctx: { newId: () => string; existingPlaces: string[] }): Op[] {
  const R = (o: object) => o as unknown as Record<string, unknown>;
  const ops: Op[] = [];
  const places: Place[] = [];
  if (!ctx.existingPlaces.includes('집')) places.push({ name: '집', address: d.homeAddress.trim(), memo: '' });
  for (const [child, label] of [
    ['son', '아들'],
    ['daughter', '딸'],
  ] as const) {
    const name = d.schools[child]?.trim();
    if (name && !ctx.existingPlaces.includes(name)) places.push({ name, address: '', memo: `${label} 학교` });
  }
  for (const p of places) ops.push({ type: 'create', col: 'places', id: ctx.newId(), data: R(p) });

  const academyIds = new Map<string, string>();
  for (const a of d.academies) {
    if (!a.name.trim()) continue;
    const id = ctx.newId();
    academyIds.set(a.key, id);
    const academy: Academy = { name: a.name.trim(), subject: a.subject.trim(), phone: a.phone.trim(), status: 'active' };
    ops.push({ type: 'create', col: 'academies', id, data: R(academy) });
    const info: PaymentInfo = { academyId: id, payType: a.payType, payer: a.payer, ...(a.url.trim() ? { url: a.url.trim() } : {}) };
    ops.push({ type: 'create', col: 'paymentInfos', id, data: R(info) });
  }

  for (const e of d.enrollments) {
    const academyId = academyIds.get(e.academyKey);
    if (!academyId || e.weekdays.length === 0) continue;
    const enrollmentId = ctx.newId();
    const en: Enrollment = {
      childId: e.childId,
      academyId,
      course: e.course.trim(),
      slots: e.weekdays.map((weekday) => ({ weekday, start: e.start, end: e.end })),
      startDate: e.startDate,
      endDate: '',
      status: 'active',
    };
    ops.push({ type: 'create', col: 'enrollments', id: enrollmentId, data: R(en) });
    if (e.fee > 0) {
      const cost: EnrollmentCost = {
        enrollmentId,
        effectiveFrom: e.startDate,
        amount: e.fee,
        payDay: Math.min(31, Math.max(1, e.payDay || 1)),
        timing: 'prepaid',
        cycle: 'monthly',
      };
      ops.push({ type: 'create', col: 'enrollmentCosts', id: `${enrollmentId}:${e.startDate}`, data: R(cost) });
    }
  }
  return ops;
}

/** 단계별로 막는 이유 (없으면 null) */
export function enrollmentProblem(e: DraftEnrollment): string | null {
  if (!e.academyKey) return '학원을 골라 주세요';
  if (e.weekdays.length === 0) return '요일을 하나 이상 골라 주세요';
  if (!e.start || !e.end || e.end <= e.start) return '끝나는 시각이 시작보다 늦어야 합니다';
  return null;
}
