import dayjs from 'dayjs';

import type { Op } from '@/data/repository';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  type EnrollmentCost,
  type Expense,
  PAY_METHOD_LABELS,
  type PayMethod,
  parseWon,
  type Payment,
  type Refund,
  REFUND_REASON_LABELS,
  type RefundReason,
  won,
} from '@/domain/money';
import { type Academy, type Enrollment, type MemberId, memberById, type ScheduleEvent, WEEKDAY_LABELS, type Weekday } from '@/domain/types';

import { extractKnown, type KnownCtx, parseDateWord, parseTimeWord, parseWeekdayWord } from './extract';

/**
 * 안내형 채팅 (D-08, I-21~I-24, I-28). 외부 AI 없이:
 * 입력 종류 → 첫 문장에서 알려진 단어로 칸 미리 채움 → 빠진 필수 항목을 하나씩 질문(칩·짧은 답) → 확인 카드 → 저장.
 * 저장 데이터 모양은 폼과 같다 (I-05).
 */

export type ChatKind = 'event' | 'enrollment' | 'payment' | 'refund' | 'expense';
export const KIND_LABELS: Record<ChatKind, string> = {
  event: '일정',
  enrollment: '수강',
  payment: '납부',
  refund: '환불',
  expense: '지출',
};

export interface BillCand {
  id: string;
  label: string;
  childId: string;
  academyId: string;
  period: string;
  remaining: number;
  due: number;
  paid: number;
}

export interface ChatCtx extends KnownCtx {
  me: MemberId;
  bills: BillCand[];
  lastMethod: PayMethod;
}

export interface Values {
  title?: string;
  targets?: MemberId[];
  child?: MemberId | 'common';
  academyId?: string;
  /** 등록되지 않은 학원 → 새로 만듦 */
  newAcademy?: string;
  course?: string;
  date?: string;
  start?: string;
  end?: string;
  weekdays?: Weekday[];
  repeat?: boolean;
  amount?: number;
  payDay?: number;
  billId?: string;
  method?: PayMethod;
  category?: string;
  reason?: RefundReason;
  place?: string;
  memo?: string;
  period?: string;
}
type Key = keyof Values;

export interface ChatState {
  kind: ChatKind | null;
  values: Values;
  /** 한 번 물었거나 건너뛴 선택 항목 */
  asked: Key[];
}

export const initialState = (): ChatState => ({
  kind: null,
  values: {},
  asked: [],
});

export interface Choice {
  label: string;
  value: unknown;
}

interface Slot {
  key: Key;
  label: string;
  q: (s: ChatState, c: ChatCtx) => string;
  optional?: boolean;
  /** 질문하지 않고 기본값을 채움 */
  auto?: (s: ChatState, c: ChatCtx) => unknown;
}

const SKIP = '__skip__';
const NEW_ACADEMY = '__new__';

const SLOTS: Record<ChatKind, Slot[]> = {
  event: [
    {
      key: 'title',
      label: '제목',
      q: () => '어떤 일정인가요? (예: 반 모임, 치과)',
    },
    { key: 'targets', label: '누구', q: () => '누구 일정인가요?' },
    {
      key: 'date',
      label: '날짜',
      q: (s) => (s.values.repeat ? '언제부터 시작하나요?' : '언제인가요?'),
      auto: (s) => (s.values.repeat && s.values.weekdays ? nextWeekday(s.values.weekdays[0]) : undefined),
    },
    {
      key: 'start',
      label: '시작',
      q: () => '몇 시에 시작하나요? (예: 3시, 오후 3시 30분)',
    },
    { key: 'end', label: '끝', q: () => '몇 시에 끝나나요?' },
    { key: 'place', label: '장소', q: () => '장소가 있나요?', optional: true },
  ],
  enrollment: [
    { key: 'child', label: '자녀', q: () => '누가 다니나요?' },
    {
      key: 'academyId',
      label: '학원',
      q: () => '어느 학원인가요? (등록되지 않은 학원은 이름을 쓰면 새로 추가)',
    },
    {
      key: 'weekdays',
      label: '요일',
      q: () => '무슨 요일에 가나요? (예: 월수금)',
    },
    {
      key: 'start',
      label: '시작',
      q: () => '몇 시에 시작하나요? (예: 7시~9시 처럼 한 번에 써도 돼요)',
    },
    { key: 'end', label: '끝', q: () => '몇 시에 끝나나요?' },
    {
      key: 'date',
      label: '시작일',
      q: () => '언제부터 다니나요?',
      auto: (_s, c) => c.today,
    },
    {
      key: 'amount',
      label: '월 수강료',
      q: () => '한 달 수강료는 얼마인가요? (예: 32만)',
      optional: true,
    },
    {
      key: 'payDay',
      label: '결제일',
      q: () => '매달 며칠에 내나요?',
      auto: (s) => (s.values.amount ? undefined : null),
    },
  ],
  payment: [
    { key: 'billId', label: '청구', q: () => '어느 청구를 냈나요?' },
    {
      key: 'amount',
      label: '금액',
      q: () => '얼마 냈나요?',
      auto: (s, c) => billOf(s, c)?.remaining || billOf(s, c)?.due,
    },
    {
      key: 'date',
      label: '납부일',
      q: () => '언제 냈나요?',
      auto: (_s, c) => c.today,
    },
    {
      key: 'method',
      label: '수단',
      q: () => '어떻게 냈나요?',
      auto: (_s, c) => c.lastMethod,
    },
  ],
  refund: [
    { key: 'billId', label: '청구', q: () => '어느 청구의 환불인가요?' },
    { key: 'amount', label: '요청액', q: () => '얼마를 돌려받나요?' },
    { key: 'reason', label: '사유', q: () => '환불 사유는요?' },
    {
      key: 'date',
      label: '사유 발생일',
      q: () => '언제부터 안 다니게 됐나요? (사유 발생일)',
      auto: (_s, c) => c.today,
    },
  ],
  expense: [
    { key: 'amount', label: '금액', q: () => '얼마 썼나요?' },
    { key: 'category', label: '분류', q: () => '어떤 지출인가요?' },
    { key: 'child', label: '누구', q: () => '누구 지출인가요?' },
    {
      key: 'date',
      label: '날짜',
      q: () => '언제 썼나요?',
      auto: (_s, c) => c.today,
    },
  ],
};

function nextWeekday(w: Weekday, from = dayjs()) {
  let d = from;
  while (d.day() !== w) d = d.add(1, 'day');
  return d.format('YYYY-MM-DD');
}
const billOf = (s: ChatState, c: ChatCtx) => c.bills.find((b) => b.id === s.values.billId);

// ───────────── 표시 ─────────────

const names = (ids: string[]) => ids.map((i) => memberById(i)?.name ?? i).join(', ');
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}(${WEEKDAY_LABELS[dayjs(d).day()]})`;

export function show(key: Key, s: ChatState, c: ChatCtx): string {
  const v = s.values;
  switch (key) {
    case 'targets':
      return names(v.targets ?? []);
    case 'child':
      return v.child === 'common' ? '공통' : names(v.child ? [v.child] : []);
    case 'academyId':
      return v.newAcademy ? `${v.newAcademy} (새로 추가)` : (c.academies.find((a) => a.id === v.academyId)?.name ?? '');
    case 'date':
      return v.date ? md(v.date) : '';
    case 'weekdays':
      return (v.weekdays ?? []).map((w) => WEEKDAY_LABELS[w]).join(',');
    case 'amount':
      return v.amount != null ? won(v.amount) : '';
    case 'payDay':
      return v.payDay ? `매달 ${v.payDay}일` : '';
    case 'billId':
      return billOf(s, c)?.label ?? '';
    case 'method':
      return v.method ? PAY_METHOD_LABELS[v.method] : '';
    case 'reason':
      return v.reason ? REFUND_REASON_LABELS[v.reason] : '';
    default:
      return v[key] == null ? '' : String(v[key]);
  }
}

// ───────────── 선택지 ─────────────

export function choicesFor(key: Key, s: ChatState, c: ChatCtx): Choice[] {
  const v = s.values;
  switch (key) {
    case 'targets':
      return [
        { label: '아들', value: ['son'] },
        { label: '딸', value: ['daughter'] },
        { label: '아들·딸', value: ['son', 'daughter'] },
        { label: '엄마', value: ['mom'] },
        { label: '아빠', value: ['dad'] },
        { label: '가족 모두', value: ['dad', 'mom', 'son', 'daughter'] },
      ];
    case 'child':
      return [
        { label: '아들', value: 'son' },
        { label: '딸', value: 'daughter' },
        ...(s.kind === 'expense' ? [{ label: '공통', value: 'common' }] : []),
      ];
    case 'academyId':
      return c.academies.map((a) => ({ label: a.name, value: a.id }));
    case 'date': {
      const t = c.today;
      const base = [
        { label: '오늘', value: t },
        { label: '내일', value: dayjs(t).add(1, 'day').format('YYYY-MM-DD') },
      ];
      if (s.kind === 'payment' || s.kind === 'expense' || s.kind === 'refund')
        base[1] = {
          label: '어제',
          value: dayjs(t).subtract(1, 'day').format('YYYY-MM-DD'),
        };
      if (s.kind === 'event')
        base.push(
          { label: '이번 토요일', value: parseDateWord('토요일', t)! },
          { label: '이번 일요일', value: parseDateWord('일요일', t)! },
        );
      return base;
    }
    case 'start':
      return s.kind === 'enrollment'
        ? ['16:00', '17:00', '18:00', '19:00', '20:00'].map((x) => ({
            label: x,
            value: x,
          }))
        : [];
    case 'end': {
      if (!v.start) return [];
      const at = (m: number) => dayjs(`2000-01-01T${v.start}`).add(m, 'minute').format('HH:mm');
      return [60, 90, 120, 180].map((m) => ({
        label: `${at(m)} (${m / 60}시간)`,
        value: at(m),
      }));
    }
    case 'weekdays':
      return [
        { label: '월수금', value: [1, 3, 5] },
        { label: '화목', value: [2, 4] },
        { label: '토', value: [6] },
        { label: '월~금', value: [1, 2, 3, 4, 5] },
      ];
    case 'payDay':
      return [1, 5, 10, 15, 20, 25].map((d) => ({ label: `${d}일`, value: d }));
    case 'billId': {
      const pool = c.bills.filter((b) => (s.kind === 'payment' ? b.remaining > 0 : b.paid > 0 || b.remaining > 0));
      return billMatches(pool, s)
        .slice(0, 8)
        .map((b) => ({ label: b.label, value: b.id }));
    }
    case 'method':
      return (Object.entries(PAY_METHOD_LABELS) as [PayMethod, string][]).map(([k, l]) => ({ label: l, value: k }));
    case 'reason':
      return (Object.entries(REFUND_REASON_LABELS) as [RefundReason, string][]).map(([k, l]) => ({ label: l, value: k }));
    case 'category':
      return [...new Set([...DEFAULT_EXPENSE_CATEGORIES, ...c.categories])].map((x) => ({ label: x, value: x }));
    case 'amount':
      if (s.kind === 'refund' && billOf(s, c))
        return [
          {
            label: `낸 금액 전부 (${won(billOf(s, c)!.paid)})`,
            value: billOf(s, c)!.paid,
          },
        ];
      return [];
    case 'place':
      return c.places.map((p) => ({ label: p, value: p }));
    default:
      return [];
  }
}

/** 청구 찾기 (I-24): 알고 있는 자녀·학원·대상 월로 좁힘 */
function billMatches(pool: BillCand[], s: ChatState): BillCand[] {
  const v = s.values;
  const score = (b: BillCand) =>
    (v.child && b.childId === v.child ? 4 : 0) +
    (v.academyId && b.academyId === v.academyId ? 4 : 0) +
    (v.period && b.period === v.period ? 4 : 0) +
    (v.amount && (b.remaining === v.amount || b.due === v.amount) ? 2 : 0);
  const filtered = pool.filter(
    (b) => (!v.child || b.childId === v.child) && (!v.academyId || b.academyId === v.academyId) && (!v.period || b.period === v.period),
  );
  return (filtered.length ? filtered : pool).sort((a, b) => score(b) - score(a) || (a.period < b.period ? 1 : -1));
}

// ───────────── 진행 ─────────────

export type Step =
  | { type: 'kind' }
  | {
      type: 'ask';
      key: Key;
      question: string;
      choices: Choice[];
      optional: boolean;
      allowNew?: boolean;
    }
  | {
      type: 'confirm';
      lines: { key: Key; label: string; value: string }[];
      title: string;
    };

/** 빠진 항목 채우기(자동값) 후 다음 질문 또는 확인 카드 */
export function nextStep(s: ChatState, c: ChatCtx): { state: ChatState; step: Step } {
  if (!s.kind) return { state: s, step: { type: 'kind' } };
  const st: ChatState = { ...s, values: { ...s.values } };
  // 청구 후보가 하나뿐이면 바로 고름 (확인 카드에서 바꿀 수 있음)
  if ((st.kind === 'payment' || st.kind === 'refund') && !st.values.billId) {
    const pool = choicesFor('billId', st, c);
    const v = st.values;
    if (pool.length === 1 && (v.child || v.academyId || v.period)) st.values.billId = pool[0].value as string;
  }
  for (const slot of SLOTS[st.kind!]) {
    if (st.values[slot.key] != null) continue;
    if (slot.auto) {
      const a = slot.auto(st, c);
      if (a === null) continue; // 필요 없음
      if (a !== undefined) {
        (st.values as Record<string, unknown>)[slot.key] = a;
        continue;
      }
    }
    if (slot.optional && st.asked.includes(slot.key)) continue;
    return {
      state: st,
      step: {
        type: 'ask',
        key: slot.key,
        question: slot.q(st, c),
        choices: choicesFor(slot.key, st, c),
        optional: !!slot.optional,
        allowNew: slot.key === 'academyId' && st.kind === 'enrollment',
      },
    };
  }
  const lines = SLOTS[st.kind!]
    .filter((sl) => st.values[sl.key] != null && show(sl.key, st, c) !== '')
    .map((sl) => ({
      key: sl.key,
      label: sl.label,
      value: show(sl.key, st, c),
    }));
  if (st.kind === 'event' && st.values.repeat && st.values.weekdays?.length)
    lines.push({
      key: 'weekdays',
      label: '반복',
      value: `매주 ${show('weekdays', st, c)}`,
    });
  if (st.values.memo) lines.push({ key: 'memo', label: '메모', value: st.values.memo });
  return {
    state: st,
    step: {
      type: 'confirm',
      lines,
      title: `${KIND_LABELS[st.kind!]} 저장할까요?`,
    },
  };
}

/** 문장에서 찾은 값 → 상태 (이미 있는 값은 덮지 않음) */
export function absorb(s: ChatState, text: string, c: ChatCtx, opts: { firstMessage?: boolean } = {}): ChatState {
  const e = extractKnown(text, c);
  const guess = (): ChatKind => {
    if (e.kindHint) return e.kindHint;
    if (e.weekdays && (e.academyId || e.academyText) && e.start) return 'enrollment';
    if (e.amount && e.category && !e.start) return 'expense';
    return 'event';
  };
  const kind = s.kind ?? (opts.firstMessage ? guess() : null);
  const v: Values = { ...s.values };
  const set = <K extends Key>(k: K, x: Values[K] | undefined) => {
    if (x !== undefined && v[k] == null) v[k] = x;
  };
  if (e.children?.length) {
    if (kind === 'event') set('targets', e.children);
    else if (e.children[0] === 'son' || e.children[0] === 'daughter') set('child', e.children[0]);
  }
  set('academyId', e.academyId);
  if (!v.academyId && e.academyText && kind === 'enrollment') set('newAcademy', e.academyText);
  set('start', e.start);
  set('end', e.end);
  set('amount', e.amount);
  set('period', e.period);
  set('method', e.method);
  set('reason', e.reason);
  set('category', e.category);
  set('place', e.place);
  if (e.weekdays) {
    if (kind === 'event' && !e.repeat && e.weekdays.length === 1 && !e.date) set('date', nextWeekday(e.weekdays[0], dayjs(c.today)));
    else {
      set('weekdays', e.weekdays);
      if (kind === 'event') set('repeat', true);
    }
  }
  set('date', e.date);
  if (e.leftover) {
    if (kind === 'event' && !v.title) v.title = e.leftover;
    else if (kind === 'enrollment' && !v.course && !/^\s*$/.test(e.leftover) && e.leftover.length <= 12) v.course = e.leftover;
    else if (opts.firstMessage || kind !== 'event') v.memo = [v.memo, e.leftover].filter(Boolean).join(' / ');
  }
  if (v.newAcademy) v.academyId = NEW_ACADEMY;
  return { ...s, kind, values: v };
}

/**
 * 현재 질문에 대한 답. 선택지(value) 또는 짧은 글.
 * 글이면 그 항목으로 먼저 해석하고, 함께 들어 있는 다른 알려진 단어도 채운다.
 */
export function answer(
  s: ChatState,
  key: Key,
  input: { value?: unknown; text?: string },
  c: ChatCtx,
): { state: ChatState; error?: string } {
  const v: Values = { ...s.values };
  const asked = s.asked.includes(key) ? s.asked : [...s.asked, key];
  if (input.value === SKIP) return { state: { ...s, asked } };
  if (input.value !== undefined) {
    if (key === 'academyId' && input.value === NEW_ACADEMY) return { state: s };
    (v as Record<string, unknown>)[key] = input.value;
    if (key === 'academyId') delete v.newAcademy;
    return { state: { ...s, values: v, asked } };
  }
  const t = (input.text ?? '').trim();
  if (!t) return { state: s, error: '답을 입력하거나 아래 버튼을 눌러 주세요.' };
  let ok = false;
  switch (key) {
    case 'title':
    case 'course':
    case 'place':
    case 'memo':
      v[key] = t;
      ok = true;
      break;
    case 'category':
      v.category = t;
      ok = true;
      break;
    case 'date': {
      const d = parseDateWord(t, c.today) ?? extractKnown(t, c).date;
      if (d) {
        v.date = d;
        ok = true;
      }
      break;
    }
    case 'start':
    case 'end': {
      const e = extractKnown(t, c);
      if (key === 'start' && e.start) {
        v.start = e.start;
        if (e.end && !v.end) v.end = e.end;
        ok = true;
      } else if (key === 'end') {
        const tm = parseTimeWord(t) ?? e.start ?? null;
        const hours = /(\d(?:\.\d)?)\s*시간/.exec(t);
        if (hours && v.start)
          v.end = dayjs(`2000-01-01T${v.start}`)
            .add(Number(hours[1]) * 60, 'minute')
            .format('HH:mm');
        else if (tm)
          v.end =
            tm < (v.start ?? '') && Number(tm.slice(0, 2)) < 12
              ? `${String(Number(tm.slice(0, 2)) + 12).padStart(2, '0')}${tm.slice(2)}`
              : tm;
        ok = !!v.end;
        if (ok && v.start && v.end! <= v.start) return { state: s, error: '끝나는 시각이 시작보다 늦어야 해요.' };
      }
      break;
    }
    case 'weekdays': {
      const w = parseWeekdayWord(t);
      if (w) {
        v.weekdays = w;
        ok = true;
      }
      break;
    }
    case 'amount': {
      const a = parseWon(t) ?? extractKnown(t, c).amount;
      if (a) {
        v.amount = a;
        ok = true;
      }
      break;
    }
    case 'payDay': {
      const m = /(\d{1,2})/.exec(t);
      if (m && Number(m[1]) >= 1 && Number(m[1]) <= 31) {
        v.payDay = Number(m[1]);
        ok = true;
      }
      break;
    }
    case 'targets':
    case 'child': {
      const e = extractKnown(t, c);
      if (e.children?.length) {
        if (key === 'targets') v.targets = e.children;
        else v.child = e.children[0];
        ok = true;
      } else if (key === 'child' && /공통|같이|가족/.test(t) && s.kind === 'expense') {
        v.child = 'common';
        ok = true;
      }
      break;
    }
    case 'academyId': {
      const e = extractKnown(t, c);
      if (e.academyId) {
        v.academyId = e.academyId;
        delete v.newAcademy;
        ok = true;
      } else if (s.kind === 'enrollment') {
        v.newAcademy = t.replace(/\s+/g, ' ');
        v.academyId = NEW_ACADEMY;
        ok = true;
      }
      break;
    }
    case 'billId': {
      const st2 = absorb({ ...s, values: { ...v, billId: undefined } }, t, c);
      const list = choicesFor('billId', st2, c);
      const direct = list.filter((x) => x.label.replace(/\s/g, '').includes(t.replace(/\s/g, '')));
      const pick = direct.length === 1 ? direct[0] : list.length === 1 ? list[0] : undefined;
      if (pick)
        return {
          state: {
            ...st2,
            values: { ...st2.values, billId: pick.value as string },
            asked,
          },
        };
      return {
        state: st2,
        error: list.length ? '아래에서 골라 주세요.' : '맞는 청구를 찾지 못했어요. 비용 탭에서 청구를 먼저 만들어 주세요.',
      };
    }
    case 'method': {
      const e = extractKnown(t, c);
      if (e.method) {
        v.method = e.method;
        ok = true;
      }
      break;
    }
    case 'reason': {
      const e = extractKnown(t, c);
      v.reason = e.reason ?? 'etc';
      if (!e.reason) v.memo = [v.memo, t].filter(Boolean).join(' / ');
      ok = true;
      break;
    }
    default:
      break;
  }
  if (!ok)
    return {
      state: s,
      error: `'${t}' 을(를) 알아듣지 못했어요. 예시처럼 다시 써 주거나 버튼을 눌러 주세요.`,
    };
  return { state: { ...s, values: v, asked } };
}

/** 확인 카드에서 한 항목 다시 묻기 */
export function reopen(s: ChatState, key: Key): ChatState {
  const v: Values = { ...s.values };
  delete v[key];
  if (key === 'academyId') delete v.newAcademy;
  if (key === 'weekdays') delete v.repeat;
  return { ...s, values: v, asked: s.asked.filter((k) => k !== key) };
}

export const SKIP_VALUE = SKIP;
export const NEW_ACADEMY_VALUE = NEW_ACADEMY;

// ───────────── 저장 ─────────────

export function buildOps(s: ChatState, c: ChatCtx, newId: () => string, nowIso: string): { ops: Op[]; label: string } {
  const v = s.values;
  const R = (o: object) => o as unknown as Record<string, unknown>;
  switch (s.kind) {
    case 'event': {
      const targets = v.targets ?? [];
      const data: ScheduleEvent = {
        kind: 'appointment',
        title: v.title ?? '',
        targets,
        date: v.date!,
        start: v.start!,
        end: v.end!,
        repeatWeekdays: v.repeat ? (v.weekdays ?? []) : [],
        repeatUntil: '',
        place: v.place ?? '',
        memo: v.memo ?? '',
        checklist: [],
        scope: 'family',
        createdBy: c.me,
      };
      return {
        ops: [{ type: 'create', col: 'events', id: newId(), data: R(data) }],
        label: `일정 추가(채팅): ${data.title} ${data.date}`,
      };
    }
    case 'enrollment': {
      const ops: Op[] = [];
      let academyId = v.academyId!;
      let academyName = c.academies.find((a) => a.id === academyId)?.name ?? '';
      if (academyId === NEW_ACADEMY) {
        academyId = newId();
        academyName = v.newAcademy!;
        const a: Academy = { name: academyName, subject: '', status: 'active' };
        ops.push({
          type: 'create',
          col: 'academies',
          id: academyId,
          data: R(a),
        });
      }
      const enrollmentId = newId();
      const data: Enrollment = {
        childId: v.child as MemberId,
        academyId,
        course: v.course ?? '',
        slots: (v.weekdays ?? []).map((weekday) => ({
          weekday,
          start: v.start!,
          end: v.end!,
        })),
        startDate: v.date!,
        endDate: '',
        status: 'active',
      };
      ops.push({
        type: 'create',
        col: 'enrollments',
        id: enrollmentId,
        data: R(data),
      });
      if (v.amount && v.amount > 0) {
        const cost: EnrollmentCost = {
          enrollmentId,
          effectiveFrom: v.date!,
          amount: v.amount,
          payDay: v.payDay ?? 1,
          timing: 'prepaid',
          cycle: 'monthly',
        };
        ops.push({
          type: 'create',
          col: 'enrollmentCosts',
          id: `${enrollmentId}:${v.date}`,
          data: R(cost),
        });
      }
      return { ops, label: `수강 등록(채팅): ${academyName}` };
    }
    case 'payment': {
      const b = billOf(s, c)!;
      const data: Payment = {
        billId: b.id,
        paidOn: v.date!,
        amount: v.amount!,
        method: v.method!,
        card: '',
        by: c.me,
        at: nowIso,
        ...(v.memo ? { memo: v.memo } : {}),
      };
      return {
        ops: [{ type: 'create', col: 'payments', id: newId(), data: R(data) }],
        label: `납부 기록(채팅): ${b.label} ${won(v.amount!)}`,
      };
    }
    case 'refund': {
      const b = billOf(s, c)!;
      const data: Refund = {
        billId: b.id,
        causeDate: v.date!,
        requestedOn: c.today,
        reason: v.reason ?? 'etc',
        requested: v.amount!,
        memo: v.memo ?? '',
      };
      return {
        ops: [{ type: 'create', col: 'refunds', id: newId(), data: R(data) }],
        label: `환불 요청(채팅): ${b.label} ${won(v.amount!)}`,
      };
    }
    case 'expense': {
      const data: Expense = {
        date: v.date!,
        amount: v.amount!,
        category: v.category || '기타',
        childId: v.child ?? 'common',
        memo: v.memo ?? '',
        ...(v.academyId && v.academyId !== NEW_ACADEMY ? { academyId: v.academyId } : {}),
      };
      return {
        ops: [{ type: 'create', col: 'expenses', id: newId(), data: R(data) }],
        label: `지출 추가(채팅): ${data.category} ${won(data.amount)}`,
      };
    }
    default:
      return { ops: [], label: '' };
  }
}
