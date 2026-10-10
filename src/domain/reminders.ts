import dayjs from 'dayjs';

import { todoItems, type Bill, type BillState, won } from './money';
import type { Occurrence } from './schedule';
import { type EventKind, EVENT_KIND_LABELS, MEMBERS, memberById, type MemberId, PARENTS } from './types';

/**
 * 알림 (Requirement 7장, D-05). R1a 는 앱 안 알림함·배너가 기본이고 (N-13, N-26),
 * 휴대폰 알림은 권한을 허용한 기기에서 앱이 열려 있을 때만 보낸다. 서버 푸시는 R1b.
 *
 * 설정은 컬렉션 reminderPolicies: 구성원별 문서(id = memberId) + 비용 알림 문서(id = 'cost').
 */

export const MINUTE_PRESETS = [1440, 180, 120, 60, 30, 15, 10, 5];
export const MAX_MINUTES = 10_080; // 7일
export const MAX_PER_LIST = 6;

export type KindKey = EventKind | 'default';

export interface ReminderPolicy {
  memberId: MemberId;
  /** 이 구성원 알림 전체 켜기·끄기 (부모가 정함). 자녀 본인의 끄기는 기기 설정으로 따로 */
  enabled: boolean;
  /** 일정 종류별 알림 시점(분 전). 없는 종류는 default */
  byKind: Partial<Record<KindKey, number[]>>;
}

export interface CostPolicy {
  /** 납부 기한 며칠 전 (0 = 당일) */
  dueDays: number[];
  /** 납부 담당이 아닌 부모에게도 */
  notifyOtherParent: boolean;
}

export const COST_POLICY_ID = 'cost';
export const DEFAULT_COST_POLICY: CostPolicy = { dueDays: [3, 0], notifyOtherParent: false };

export function defaultPolicy(memberId: MemberId): ReminderPolicy {
  const child = memberById(memberId)?.role === 'child';
  return { memberId, enabled: true, byKind: child ? { default: [30], class: [30] } : { default: [60] } };
}

/** 값 규칙 (N-21): 분 단위 정수, 1분~7일, 최대 6개, 중복 제거, 큰 값 먼저 */
export function normalizeMinutes(list: number[]): number[] {
  return [...new Set(list.map((m) => Math.round(m)).filter((m) => m >= 1 && m <= MAX_MINUTES))].sort((a, b) => b - a).slice(0, MAX_PER_LIST);
}

/** '1일', '2시간', '90분', '90', '1시간 30분' → 분 */
export function parseMinutes(text: string): number | null {
  const t = text.replace(/\s|전/g, '');
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+)일)?(?:(\d+(?:\.\d+)?)시간)?(?:(\d+)분)?$/.exec(t);
  if (!m || !(m[1] || m[2] || m[3])) return null;
  const v = Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return v > 0 ? Math.round(v) : null;
}

export function labelMinutes(min: number): string {
  if (min % 1440 === 0) return `${min / 1440}일 전`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h ? `${h}시간` : ''}${h && m ? ' ' : ''}${m ? `${m}분` : ''} 전`;
}

export const minutesFor = (p: ReminderPolicy, kind: EventKind) => normalizeMinutes(p.byKind[kind] ?? p.byKind.default ?? []);

// ───────────── 알림함 항목 ─────────────

export interface InboxItem {
  /** 같은 알림이면 같은 id (읽음·발송 기록용) */
  id: string;
  type: 'schedule' | 'fee';
  /** 받는 사람 */
  to: MemberId[];
  /** 알림 시각 'YYYY-MM-DDTHH:mm' */
  at: string;
  title: string;
  body: string;
  /** 눌렀을 때 갈 곳 */
  link: { pathname: string; params?: Record<string, string> };
  /** 숫자가 작을수록 위 */
  priority: number;
  /** 일정 알림: 회차 시작 시각 */
  eventAt?: string;
  /** 일정 알림: 일정 이름 (화면에서 남은 시간을 붙여 보여 줌) */
  subject?: string;
}

/** 화면 표시용 제목: 일정 알림은 지금 기준 남은 시간 ("40분 뒤 상담") */
export function liveTitle(i: InboxItem, now: string): string {
  if (i.type !== 'schedule' || !i.eventAt || !i.subject) return i.title;
  const mins = dayjs(i.eventAt).diff(dayjs(now), 'minute');
  if (mins <= 0) return `지금 ${i.subject}`;
  return `${labelMinutes(mins).replace(' 전', ' 뒤')} ${i.subject}`;
}

const fmt = (d: dayjs.Dayjs) => d.format('YYYY-MM-DDTHH:mm');

/**
 * 일정 사전 알림 (N-01). 받는 사람 = 일정 당사자 + 부모 (각자 자기 설정의 시점으로).
 * overrides: 일정 1건에만 지정한 시점 (N-22) — sourceId → 분 목록.
 */
export function scheduleReminders(
  occurrences: Occurrence[],
  policies: Partial<Record<MemberId, ReminderPolicy>>,
  overrides: Map<string, number[]> = new Map(),
): InboxItem[] {
  const out: InboxItem[] = [];
  for (const o of occurrences) {
    if (o.status !== 'normal') continue;
    const recipients = [...new Set<MemberId>([...o.targets, ...PARENTS.map((p) => p.id)])];
    for (const m of recipients) {
      const p = policies[m] ?? defaultPolicy(m);
      if (!p.enabled) continue;
      const mins = overrides.get(o.sourceId) ?? minutesFor(p, o.kind);
      const who = o.targets.length === MEMBERS.length ? '가족' : o.targets.map((t) => memberById(t)?.name).join('·');
      for (const min of mins) {
        out.push({
          id: `s|${o.key}|${m}|${min}`,
          type: 'schedule',
          to: [m],
          at: fmt(dayjs(o.startAt).subtract(min, 'minute')),
          title: `${labelMinutes(min).replace(' 전', ' 뒤')} ${o.title}`,
          body: `${who} · ${EVENT_KIND_LABELS[o.kind]} · ${o.date.slice(5).replace('-', '/')} ${o.start}~${o.end}${o.place ? ` · ${o.place}` : ''}`,
          link: { pathname: '/occurrence', params: { key: o.key } },
          priority: 2,
          eventAt: o.startAt,
          subject: o.title,
        });
      }
    }
  }
  return out;
}

/** 학원비 알림 (N-02~N-04, N-25): 기한 D-n·당일, 연체, 환불 미종결 */
export function feeReminders(rows: { id: string; bill: Bill; state: BillState }[], policy: CostPolicy, today: string): InboxItem[] {
  const out: InboxItem[] = [];
  const parents = PARENTS.map((p) => p.id);
  const toFor = (payer: MemberId) => (policy.notifyOtherParent ? parents : [payer]);
  const days = new Set(policy.dueDays);
  for (const t of todoItems(rows, today)) {
    const link = { pathname: '/bill', params: { id: t.billId } };
    const who = t.childId === 'common' ? '공통' : (memberById(t.childId)?.name ?? '');
    const head = `${who} ${t.title} ${won(t.amount)}`;
    if (t.kind === 'dueSoon') {
      const d = dayjs(t.date).diff(dayjs(today), 'day');
      if (!days.has(d)) continue;
      out.push({ id: `f|due|${t.billId}|${d}`, type: 'fee', to: toFor(t.payer), at: `${today}T07:00`, title: d === 0 ? `오늘 납부 기한: ${head}` : `납부 D-${d}: ${head}`, body: t.text, link, priority: 1 });
    } else if (t.kind === 'overdue') {
      out.push({ id: `f|over|${t.billId}`, type: 'fee', to: parents, at: `${t.date}T07:00`, title: `연체: ${head}`, body: t.text, link, priority: 0 });
    } else if (t.kind === 'refund') {
      const d = dayjs(today).diff(dayjs(t.date), 'day');
      if (d < 7 && !t.text.includes('법정기한')) continue;
      out.push({ id: `f|refund|${t.billId}|${t.date}`, type: 'fee', to: parents, at: `${t.date}T07:00`, title: `환불 확인: ${head}`, body: t.text, link, priority: 1 });
    }
  }
  return out;
}

/**
 * 지금 보여 줄 알림 (알림함, N-13): 받는 사람이 me 이고 알림 시각이 지났으며
 * 일정 알림은 일정이 아직 시작 전 (지난 일정 알림은 버림, N-14 와 같은 원칙). 최신·중요한 것 먼저.
 */
export function inboxFor(me: MemberId, items: InboxItem[], now: string): InboxItem[] {
  return items
    .filter((i) => i.to.includes(me) && i.at <= now && (i.type !== 'schedule' || (!!i.eventAt && i.eventAt > now)))
    .sort((a, b) => a.priority - b.priority || (a.at < b.at ? 1 : -1));
}
