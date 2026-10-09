import { parseWon } from '@/domain/money';
import { MEMBERS, WEEKDAY_LABELS, type Weekday, type TimeSlot } from '@/domain/types';

/**
 * 엑셀 셀 값 ↔ 앱 값 변환 (I-13). 해석 가능한 변형은 고쳐 받고 경고로 원래 값을 남긴다.
 * 셀 값은 ExcelJS 가 주는 string | number | boolean | Date | null 로 받는다.
 */
export type Cell = string | number | boolean | Date | null | undefined;

export type Parsed<T> = { ok: true; value: T; warn?: string } | { ok: false; error: string };

const ok = <T>(value: T, warn?: string): Parsed<T> => (warn ? { ok: true, value, warn } : { ok: true, value });
const fail = <T>(error: string): Parsed<T> => ({ ok: false, error });

export const str = (c: Cell): string => {
  if (c == null) return '';
  if (c instanceof Date) return c.toISOString();
  return String(c).trim();
};

const pad = (n: number) => String(n).padStart(2, '0');

/** 날짜: '2026-03-05', '2026.3.5', '2026/3/5', '26.3.5', 엑셀 날짜(Date, UTC 기준) */
export function parseDate(c: Cell): Parsed<string> {
  if (c instanceof Date) return ok(`${c.getUTCFullYear()}-${pad(c.getUTCMonth() + 1)}-${pad(c.getUTCDate())}`);
  const s = str(c);
  const m = /^(\d{2}|\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?$/.exec(s);
  if (!m) return fail(`날짜 '${s}' 인식 불가 (예: 2026-03-05)`);
  const y = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return fail(`날짜 '${s}' 인식 불가`);
  const v = `${y}-${pad(mo)}-${pad(d)}`;
  return ok(v, v === s ? undefined : `'${s}' → ${v}`);
}

/** 대상 월: '2026-03', '2026.3', '2026년 3월', 날짜(→ 그 달) */
export function parseMonth(c: Cell): Parsed<string> {
  if (c instanceof Date) return ok(`${c.getUTCFullYear()}-${pad(c.getUTCMonth() + 1)}`);
  const s = str(c);
  const m = /^(\d{4})\s*[-./년]\s*(\d{1,2})\s*월?(?:\s*[-./]\s*\d{1,2}\s*일?)?$/.exec(s);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return fail(`대상 월 '${s}' 인식 불가 (예: 2026-03)`);
  const v = `${m[1]}-${pad(Number(m[2]))}`;
  return ok(v, v === s ? undefined : `'${s}' → ${v}`);
}

/** 시각: '19:00', '7:30', '19시', '오후 7시 30분', 엑셀 시각(Date 또는 하루 비율 숫자) */
export function parseTime(c: Cell): Parsed<string> {
  if (c instanceof Date) return ok(`${pad(c.getUTCHours())}:${pad(c.getUTCMinutes())}`);
  if (typeof c === 'number' && c >= 0 && c < 1) {
    const mins = Math.round(c * 24 * 60);
    return ok(`${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`);
  }
  const s = str(c);
  const m = /^(오전|오후)?\s*(\d{1,2})\s*(?:[:시]\s*(\d{1,2})?\s*분?)?$/.exec(s);
  if (!m) return fail(`시각 '${s}' 인식 불가 (예: 19:00)`);
  let h = Number(m[2]);
  if (m[1] === '오후' && h < 12) h += 12;
  if (m[1] === '오전' && h === 12) h = 0;
  const mi = Number(m[3] ?? 0);
  if (h > 23 || mi > 59) return fail(`시각 '${s}' 인식 불가`);
  const v = `${pad(h)}:${pad(mi)}`;
  return ok(v, v === s ? undefined : `'${s}' → ${v}`);
}

/** 금액: 숫자, '32만', '320,000원' */
export function parseMoney(c: Cell): Parsed<number> {
  if (typeof c === 'number' && Number.isFinite(c)) return ok(Math.round(c));
  const s = str(c);
  const v = parseWon(s);
  if (v == null) return fail(`금액 '${s}' 인식 불가 (예: 320000 또는 32만)`);
  return ok(v, String(v) === s ? undefined : `'${s}' → ${v.toLocaleString('ko-KR')}`);
}

export function parseInt0(c: Cell): Parsed<number> {
  const n = typeof c === 'number' ? c : Number(str(c).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n) || str(c) === '') return fail(`숫자 '${str(c)}' 인식 불가`);
  return ok(Math.round(n));
}

const YES = ['예', 'o', 'O', 'ㅇ', 'y', 'Y', 'yes', 'TRUE', 'true', '1', '✓', 'v', 'V'];
const NO = ['아니오', '아니요', 'x', 'X', 'n', 'N', 'no', 'FALSE', 'false', '0', ''];
export function parseBool(c: Cell): Parsed<boolean> {
  if (typeof c === 'boolean') return ok(c);
  const s = str(c);
  if (YES.includes(s)) return ok(true);
  if (NO.includes(s)) return ok(false);
  return fail(`'${s}' 은(는) 예/아니오로 적어 주세요`);
}
export const fmtBool = (b: boolean | undefined | null) => (b ? '예' : '아니오');

/** 라벨 ↔ 값 (드롭다운 항목) */
export function parseEnum<T extends string>(c: Cell, labels: Record<T, string>, what: string): Parsed<T> {
  const s = str(c);
  for (const [k, l] of Object.entries(labels) as [T, string][]) if (l === s || k === s) return ok(k);
  return fail(`${what} '${s}' 은(는) 목록에 없습니다 (${Object.values(labels).join('/')})`);
}

export const MEMBER_LABELS = Object.fromEntries(MEMBERS.map((m) => [m.id, m.name])) as Record<string, string>;

/** 여러 값: '아들, 딸' / '아들딸' */
export function parseList(c: Cell): string[] {
  return str(c)
    .split(/[,，、\n/]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function parseMembers(c: Cell, allowed: string[]): Parsed<string[]> {
  const s = str(c);
  const names = MEMBERS.filter((m) => allowed.includes(m.id));
  let parts = parseList(s);
  // '아들딸' 처럼 붙여 쓴 경우
  if (parts.length === 1 && !names.some((m) => m.name === parts[0])) {
    const found = names.filter((m) => parts[0].includes(m.name));
    if (found.length) parts = found.map((m) => m.name);
  }
  const ids: string[] = [];
  for (const p of parts) {
    const m = names.find((x) => x.name === p || x.id === p);
    if (!m) return fail(`'${p}' 은(는) ${names.map((x) => x.name).join('/')} 중 하나여야 합니다`);
    if (!ids.includes(m.id)) ids.push(m.id);
  }
  const v = ids.map((id) => MEMBER_LABELS[id]).join(', ');
  return ok(ids, v === s ? undefined : `'${s}' → ${v}`);
}

/** 요일: '월,수,금' / '월수금' / '월요일, 수요일' */
export function parseWeekdays(c: Cell): Parsed<Weekday[]> {
  const s = str(c).replace(/요일/g, '');
  const out: Weekday[] = [];
  for (const ch of s.replace(/[\s,，、/]/g, '')) {
    const i = WEEKDAY_LABELS.indexOf(ch as (typeof WEEKDAY_LABELS)[number]);
    if (i < 0) return fail(`요일 '${str(c)}' 인식 불가 (예: 월,수,금)`);
    if (!out.includes(i as Weekday)) out.push(i as Weekday);
  }
  const v = fmtWeekdays(out);
  return ok(out, v === str(c) ? undefined : `'${str(c)}' → ${v}`);
}
export const fmtWeekdays = (w: Weekday[] | undefined) => (w ?? []).map((d) => WEEKDAY_LABELS[d]).join(',');

/** 시간표: '월 19:00-21:00, 수 19:00-21:00' / '월수 19:00~21:00' / '월수금 7시~9시' */
export function parseSlots(c: Cell): Parsed<TimeSlot[]> {
  const s = str(c);
  if (!s) return ok([]);
  const out: TimeSlot[] = [];
  let guessed = false;
  for (const part of s.split(/[,，\n;]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^([일월화수목금토\s]+?)(?:요일)?\s+(.+?)\s*[-~]\s*(.+)$/.exec(part);
    if (!m) return fail(`시간표 '${part}' 인식 불가 (예: 월 19:00-21:00)`);
    const days = parseWeekdays(m[1]);
    const st = parseTime(m[2]);
    const en = parseTime(m[3]);
    if (!days.ok) return days;
    if (!st.ok) return st;
    if (!en.ok) return en;
    // 학원 시간 '7시~9시' → 저녁으로 추정
    let start = st.value;
    let end = en.value;
    if (Number(start.slice(0, 2)) < 10 && !/오전|:/.test(m[2])) {
      start = `${pad(Number(start.slice(0, 2)) + 12)}${start.slice(2)}`;
      if (Number(end.slice(0, 2)) < 12) end = `${pad(Number(end.slice(0, 2)) + 12)}${end.slice(2)}`;
      guessed = true;
    }
    for (const d of days.value) out.push({ weekday: d, start, end });
  }
  const v = fmtSlots(out);
  return ok(out, v === s ? undefined : `'${s}' → ${v}${guessed ? ' (오후로 추정)' : ''}`);
}
export const fmtSlots = (slots: TimeSlot[] | undefined) =>
  (slots ?? []).map((x) => `${WEEKDAY_LABELS[x.weekday]} ${x.start}-${x.end}`).join(', ');
