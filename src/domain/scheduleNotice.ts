import dayjs from 'dayjs';

import { addDays, endAfterStart, weekdayOf } from './dates';
import { WEEKDAY_LABELS } from './types';

/**
 * 학원 카톡·문자 "수업 일정 공지" → 날짜별 수업 (S-01 입력 편의).
 * 예) -수업시간: 금 pm 7:15-  /  -수업일정: 10/23, 10/30, ★11/18(수), 12/4 (7회)
 *     -시간: 일요일 오후4-7시  /  -일정: 10/25, 11/1, 15, 22 (총 7회)  /  -강의실: 본관 2층(역삼로 444 …)
 *     ※ 내일 10/23(금)은 첫수업이라 … ★ 8:15-11:15 수업진행합니다.
 * 끝 시각이 없으면 다른 줄의 시간대에서 끝을 빌려 오고 "추정"으로 표시한다.
 */

export interface NoticeSession {
  date: string;
  start: string;
  end: string;
  /** 정규 시간과 다른 날 (공지에 따로 적힌 시간) */
  special?: boolean;
}

export interface ScheduleNotice {
  title: string;
  /** 정규 수업 시간 */
  start: string;
  end: string;
  /** 끝 시각을 공지에서 직접 찾지 못해 추정함 */
  endGuessed: boolean;
  sessions: NoticeSession[];
  place?: string;
  academy?: string;
  /** 공지 원문 (상세 화면에 그대로 보여 줌) */
  memo: string;
  warnings: string[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const DATE_RE = /(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\(\s*([월화수목금토일])\s*\))?/g;
// 날짜 목록 줄: "10/25" 또는 앞 날짜의 월을 잇는 "15" (요일 표시 선택)
const LIST_DATE_RE = /(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\(\s*([월화수목금토일])\s*\))?|(?<![\d/])(\d{1,2})(?![\d/:])(?:\s*\(\s*([월화수목금토일])\s*\))?/g;
const COUNT_RE = /\(\s*(?:총\s*)?(\d{1,2})\s*회\s*\)/;
const MARK = '(am|pm|오전|오후|저녁|밤|아침)';
// 오전/오후 표시 + 시각 (7:15, 7시, 7시 15분)
const TIME_RE = new RegExp(`${MARK}?\\s*(\\d{1,2})\\s*(?::\\s*(\\d{2})|시(?:\\s*(\\d{1,2})\\s*분)?)`, 'gi');
// "오후4-7시", "8:15-11:15" — 숫자-숫자는 ':' · '시' · 오전오후 표시가 있을 때만 시간대 ("1-2 기말", 전화번호 제외)
const RANGE_RE = new RegExp(`${MARK}?\\s*(\\d{1,2})(?::(\\d{2}))?\\s*[-~–]\\s*${MARK}?\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(시)?`, 'gi');
const SUBJECT_RE = /(지구과학|생명과학|통합과학|통합사회|한국사|화학|물리|생명|생물|지구|국어|영어|수학|과학|사회|역사|정보|코딩|논술)(?:[1-9](?![\d/])|Ⅰ|Ⅱ)?/;

/** 오전·오후 표시가 없으면 1~8시는 오후로 본다 (학원 수업은 대부분 방과 후) */
function toTime(marker: string | undefined, h: number, m: number): string | null {
  const mk = (marker ?? '').toLowerCase();
  if (['pm', '오후', '저녁', '밤'].includes(mk) && h < 12) h += 12;
  else if (['am', '오전', '아침'].includes(mk) && h === 12) h = 0;
  else if (!mk && h >= 1 && h <= 8) h += 12;
  if (h > 24 || m > 59 || (h === 24 && m > 0)) return null;
  return `${pad(h)}:${pad(m)}`;
}

/** 한 줄에서 시간대 찾기: "pm 7:15-", "8:15-11:15", "오후 7시~10시", "오후4-7시" */
function rangeIn(line: string): { start: string; end?: string } | null {
  for (const m of line.matchAll(RANGE_RE)) {
    if (!(m[1] || m[3] || m[6] || m[7])) continue;
    const before = line[m.index! - 1] ?? '';
    const after = line[m.index! + m[0].length] ?? '';
    if (/[\d/]/.test(before) || /\d/.test(after)) continue;
    const start = toTime(m[1], Number(m[2]), Number(m[3] ?? 0));
    const end0 = toTime(m[4] ?? m[1], Number(m[5]), Number(m[6] ?? 0));
    if (!start || !end0) continue;
    const end = endAfterStart(end0, start);
    if (end > start) return { start, end };
  }
  const ts = [...line.matchAll(TIME_RE)]
    .map((m) => ({ t: toTime(m[1], Number(m[2]), Number(m[3] ?? m[4] ?? 0)), at: m.index! + m[0].length, idx: m.index! }))
    .filter((x): x is { t: string; at: number; idx: number } => !!x.t);
  if (ts.length === 0) return null;
  const start = ts[0].t;
  // 두 번째 시각은 "-" "~" 로 이어질 때만 끝으로 본다
  const between = ts[1] ? line.slice(ts[0].at, ts[1].idx) : '';
  const end = ts[1] && /^\s*[-~–]/.test(between) ? endAfterStart(ts[1].t, start) : undefined;
  return { start, end: end && end > start ? end : undefined };
}

/** list: 날짜 목록 줄 — "11/1, 15, 22" 처럼 월이 빠진 날은 앞 날짜의 월로 */
function datesIn(line: string, today: string, list = false): { date: string; label?: string }[] {
  const out: { date: string; label?: string }[] = [];
  let y = Number(today.slice(0, 4));
  let month = 0;
  let lastDay = 0;
  // 목록 줄은 "-일정:" 머리말과 "(총 7회)" 를 빼고 읽는다
  const text = list ? line.replace(/^[^:：]*[:：]/, '').replace(new RegExp(COUNT_RE.source, 'g'), '') : line;
  for (const m of text.matchAll(list ? LIST_DATE_RE : DATE_RE)) {
    let mo: number;
    let d: number;
    if (m[1]) {
      mo = Number(m[1]);
      d = Number(m[2]);
    } else {
      if (!month) continue;
      d = Number(m[4]);
      // "11/27, 3" → 다음 달
      mo = d < lastDay ? (month % 12) + 1 : month;
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    month = mo;
    lastDay = d;
    let date = `${y}-${pad(mo)}-${pad(d)}`;
    // 석 달 넘게 지난 날짜는 내년, 목록 안에서 12월 → 1월로 넘어가면 다음 해
    if (out.length === 0 && date < addDays(today, -90)) date = `${++y}-${pad(mo)}-${pad(d)}`;
    if (out.length > 0 && date < out[out.length - 1].date) date = `${++y}-${pad(mo)}-${pad(d)}`;
    if (!dayjs(date).isValid() || dayjs(date).format('YYYY-MM-DD') !== date) continue;
    if (out.some((x) => x.date === date)) continue;
    out.push({ date, label: m[3] ?? m[5] });
  }
  return out;
}

const clean = (s: string) => s.replace(/^[\s\-–·•★☆◆◇■□※▶▷>]+/, '').trim();
const valueAfter = (line: string) => clean(line.replace(/^.*?[:：]/, ''));

export function parseScheduleNotice(raw: string, today: string): ScheduleNotice | null {
  const lines = raw
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^\[?web\s*발신\]?$/i.test(l));
  if (lines.length === 0) return null;

  // 날짜 목록: "수업일정"·"일정:" 줄, 없으면 날짜가 가장 많은 줄 (2개 이상)
  const dateLines = lines.map((l, i) => ({ i, ds: datesIn(l, today) }));
  const found =
    dateLines.find((x) => /수업\s*일정|일정\s*[:：]|수업\s*날짜/.test(lines[x.i]) && x.ds.length > 0) ??
    [...dateLines].sort((a, b) => b.ds.length - a.ds.length).find((x) => x.ds.length >= 2);
  if (!found) return null;
  const listLine = { i: found.i, ds: datesIn(lines[found.i], today, true) };

  // 정규 시간: "수업시간"·"시간:" 줄
  const timeIdx = lines.findIndex((l) => /수업\s*시간|시간\s*[:：]/.test(l) && rangeIn(l));
  const regular = timeIdx >= 0 ? rangeIn(lines[timeIdx]) : null;

  // 날짜별 다른 시간: 시간대가 적힌 다른 줄 + 같은 줄 또는 바로 위 두 줄의 날짜
  const special = new Map<string, { start: string; end?: string }>();
  lines.forEach((l, i) => {
    if (i === timeIdx || i === listLine.i) return;
    const r = rangeIn(l);
    if (!r?.end) return;
    for (const j of [i, i - 1, i - 2]) {
      const ds = j >= 0 ? datesIn(lines[j], today) : [];
      const hit = ds.find((d) => listLine.ds.some((x) => x.date === d.date));
      if (hit) {
        // 정규 시간과 같으면 따로 표시하지 않음
        if (!(regular?.end && r.start === regular.start && r.end === regular.end)) special.set(hit.date, r);
        break;
      }
    }
  });
  const firstSpecial = [...special.values()][0];
  const start = regular?.start ?? firstSpecial?.start;
  if (!start) return null;
  let end = regular?.end;
  let endGuessed = false;
  if (!end) {
    end = firstSpecial?.end && firstSpecial.end > start ? firstSpecial.end : endAfterStart(`${pad(Math.min(24, Number(start.slice(0, 2)) + 2))}${start.slice(2)}`, start);
    endGuessed = true;
  }

  const warnings: string[] = [];
  const sessions: NoticeSession[] = listLine.ds.map(({ date, label }) => {
    if (label && WEEKDAY_LABELS[weekdayOf(date)] !== label) warnings.push(`${date.slice(5).replace('-', '/')}(${label}) — 실제 요일은 ${WEEKDAY_LABELS[weekdayOf(date)]}요일입니다`);
    const sp = special.get(date);
    return sp ? { date, start: sp.start, end: sp.end ?? end!, special: true } : { date, start, end: end! };
  });
  const count = COUNT_RE.exec(lines[listLine.i]) ?? COUNT_RE.exec(raw);
  if (count && Number(count[1]) !== sessions.length) warnings.push(`공지에는 ${count[1]}회인데 날짜는 ${sessions.length}개를 찾았습니다`);
  if (endGuessed) warnings.push(`끝 시각이 공지에 없어 ${end}로 추정했습니다. 맞는지 확인해 주세요`);

  // 제목: 과목 + 선생님 ("화학 김요섭T", "생명2 윤양수T"), 없으면 "★화학-김요섭T", ◆…◆ / […] 머리글, 첫 줄
  const subject = SUBJECT_RE.exec(raw)?.[0].replace(/\s+/g, '');
  const teacher = /([가-힣]{2,4})\s*(?:T(?![A-Za-z])|쌤|선생님)/.exec(raw)?.[1];
  const subj = raw.match(/([가-힣A-Za-z]{1,10})\s*[-–]\s*([가-힣]{2,4}\s*(?:T|쌤|선생님))/);
  const header = lines.find((l) => /^[◆◇■□【\[]/.test(l) && !/web/i.test(l));
  const title =
    subject && teacher
      ? `${subject} ${teacher}T`
      : subj
        ? `${subj[1]} ${subj[2].replace(/\s+/g, '')}`
        : header
          ? clean(header.replace(/[◆◇■□【】\[\]]/g, '')).replace(/\s*(개강\s*)?안내$/, '')
          : clean(lines[0]).slice(0, 30);

  const placeLine = lines.find((l) => /수업\s*장소|장소\s*[:：]|주소\s*[:：]|강의실\s*[:：]/.test(l));
  const placeText = placeLine ? valueAfter(placeLine).replace(/https?:\/\/\S+/g, '').trim() : '';
  // "본관 2층 1강의실(역삼로 444 진경빌딩 2층)" → 지도 검색이 되는 주소 부분
  const addr = /\(([^()]*(?:로|길)\s*\d+[^()]*)\)/.exec(placeText)?.[1].trim();
  const place = addr ?? (placeText || undefined);
  // 학원명: "안녕하세요 OO입니다", 없으면 문의 줄 뒤 전화·링크가 아닌 마지막 줄
  const hello = /안녕하세요[,!.\s]*(.+?)\s*입니다/.exec(raw)?.[1];
  const askIdx = lines.findIndex((l) => /문의|상담/.test(l));
  const tail = askIdx >= 0 ? lines.slice(askIdx + 1).filter((l) => !/\d{2,4}-\d{3,4}-\d{4}|https?:\/\//.test(l)) : [];
  const academy = hello ?? (tail.length ? clean(tail[tail.length - 1]).replace(/^\(주\)\s*|^주식회사\s*/, '') : undefined);

  return {
    title,
    start,
    end,
    endGuessed,
    sessions,
    ...(place ? { place } : {}),
    ...(academy ? { academy } : {}),
    memo: lines.join('\n'),
    warnings,
  };
}
