import dayjs from 'dayjs';

import { WEEKDAY_LABELS, type Weekday } from './types';

/** 한국 현지 시각 문자열 기반 날짜 도구. 기기 시간대가 한국이라고 가정한다 (Q-05). */

export const today = (now: Date = new Date()) => dayjs(now).format('YYYY-MM-DD');
export const addDays = (date: string, n: number) => dayjs(date).add(n, 'day').format('YYYY-MM-DD');
export const weekdayOf = (date: string) => dayjs(date).day() as Weekday;

/** 해당 날짜가 속한 주의 월요일 */
export function mondayOf(date: string): string {
  const d = dayjs(date);
  const diff = (d.day() + 6) % 7;
  return d.subtract(diff, 'day').format('YYYY-MM-DD');
}

export function* eachDay(from: string, to: string): Generator<string> {
  for (let d = from; d <= to; d = addDays(d, 1)) yield d;
}

/** '10/9(금)' (Q-05) */
export const formatDate = (date: string) => `${dayjs(date).format('M/D')}(${WEEKDAY_LABELS[weekdayOf(date)]})`;

/** 'YYYY-MM-DDTHH:mm' 로컬 시각 → 분 단위 비교용 */
export const toMinutes = (dateTime: string) => dayjs(dateTime).valueOf() / 60000;
export const nowLocal = (now: Date = new Date()) => dayjs(now).format('YYYY-MM-DDTHH:mm');

export function isValidDate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && dayjs(s).isValid() && dayjs(s).format('YYYY-MM-DD') === s;
}

/** "7시", "19:00", "1900", "7:30" → 'HH:mm'. 1~11시는 학원 일정 기준 오후로 추정하지 않음 — 호출 측에서 결정 */
export function normalizeTime(input: string): string | null {
  const s = input.trim().replace(/\s/g, '');
  let m = /^(\d{1,2}):?(\d{2})$/.exec(s);
  if (m) return pad(+m[1], +m[2]);
  m = /^(\d{1,2})시(?:(\d{1,2})분?)?$/.exec(s);
  if (m) return pad(+m[1], m[2] ? +m[2] : 0);
  m = /^(\d{1,2})$/.exec(s);
  if (m) return pad(+m[1], 0);
  return null;
}

function pad(h: number, min: number) {
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export const minutesBetween = (a: string, b: string) => Math.round(toMinutes(b) - toMinutes(a));

/** '1시간 5분', '25분' */
export function formatDuration(min: number) {
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}
