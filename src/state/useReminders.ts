import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { addDays, nowLocal, today } from '@/domain/dates';
import {
  COST_POLICY_ID,
  type CostPolicy,
  DEFAULT_COST_POLICY,
  feeReminders,
  type InboxItem,
  inboxFor,
  normalizeMinutes,
  type ReminderPolicy,
  scheduleReminders,
} from '@/domain/reminders';
import { type MemberId, type ScheduleEvent } from '@/domain/types';

import { useRepository } from './RepositoryContext';
import { useCollection, useNow, useOccurrences } from './useCollection';
import { useMoney } from './useMoney';

/**
 * 이 기기 알림 설정 (localStorage): 자녀 본인 끄기(N-23, 사본 저장소는 읽기 전용이라 기기에 저장),
 * 휴대폰 알림 사용(N-26), 읽음·발송 기록.
 */
export interface DevicePrefs {
  muted: boolean;
  os: boolean;
  read: string[];
  fired: string[];
}
const KEY = 'ai-note.notify-device.v1';
const EMPTY: DevicePrefs = { muted: false, os: false, read: [], fired: [] };
let cache: DevicePrefs | null = null;
const listeners = new Set<() => void>();

function load(): DevicePrefs {
  if (cache) return cache;
  try {
    cache = { ...EMPTY, ...JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') };
  } catch {
    cache = EMPTY;
  }
  return cache!;
}
export function setDevicePrefs(patch: Partial<DevicePrefs>) {
  const next = { ...load(), ...patch };
  // 기록은 최근 500개만
  next.read = next.read.slice(-500);
  next.fired = next.fired.slice(-500);
  cache = next;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    // 저장 불가 브라우저 — 이번 실행 동안만 유지
  }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useDevicePrefs = () => useSyncExternalStore(subscribe, load, () => EMPTY);

/** 알림 설정 문서들 */
export function usePolicies() {
  const docs = useCollection<ReminderPolicy & CostPolicy>('reminderPolicies');
  return useMemo(() => {
    const members: Partial<Record<MemberId, ReminderPolicy>> = {};
    let cost: CostPolicy = DEFAULT_COST_POLICY;
    for (const d of docs.docs) {
      if (d.id === COST_POLICY_ID) cost = { dueDays: d.dueDays ?? DEFAULT_COST_POLICY.dueDays, notifyOtherParent: !!d.notifyOtherParent };
      else members[d.id as MemberId] = { memberId: d.id as MemberId, enabled: d.enabled !== false, byKind: d.byKind ?? {} };
    }
    return { members, cost, docs: docs.docs, loaded: docs.loaded };
  }, [docs.docs, docs.loaded]);
}

/** 이 기기 사용자의 알림함 (N-13). 앞으로 8일치 일정 + 학원비(부모) */
export function useReminders() {
  const { settings, isChild } = useRepository();
  const me = (settings.memberId || '') as MemberId;
  const now = nowLocal(useNow());
  const t = today();
  const { occurrences } = useOccurrences(t, addDays(t, 8));
  const events = useCollection<ScheduleEvent & { reminders?: number[] }>('events');
  const money = useMoney();
  const policies = usePolicies();
  const prefs = useDevicePrefs();

  const all: InboxItem[] = useMemo(() => {
    const overrides = new Map(events.docs.filter((e) => e.reminders?.length).map((e) => [e.id, normalizeMinutes(e.reminders!)]));
    const sched = prefs.muted ? [] : scheduleReminders(occurrences, policies.members, overrides);
    const fee = isChild ? [] : feeReminders(money.rows, policies.cost, t);
    return [...sched, ...fee];
  }, [occurrences, policies, events.docs, money.rows, isChild, prefs.muted, t]);

  const inbox = useMemo(() => (me ? inboxFor(me, all, now) : []), [me, all, now]);
  const unread = inbox.filter((i) => !prefs.read.includes(i.id));
  /** 아직 시각이 안 된 다음 알림 (설정 화면 미리보기) */
  const upcoming = useMemo(() => all.filter((i) => i.to.includes(me) && i.at > now).sort((a, b) => (a.at < b.at ? -1 : 1)), [all, me, now]);

  const markRead = useCallback((ids: string[]) => setDevicePrefs({ read: [...new Set([...load().read, ...ids])] }), []);
  return { inbox, unread, upcoming, markRead, prefs, me };
}
