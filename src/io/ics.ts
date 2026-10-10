import type { Occurrence } from '@/domain/schedule';
import { EVENT_KIND_LABELS, memberById } from '@/domain/types';

/**
 * .ics 스냅샷 내보내기 (Sprint 4 선택): 앞으로 몇 주 일정을 휴대폰·구글 캘린더에 한 번 넣는 용도.
 * 반복 규칙 대신 회차를 하나씩 넣는다 (휴강·시간 변경이 반영된 모습 그대로). 다시 가져오면 UID 가 같아 덮어써진다.
 */

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const dt = (date: string, time: string) => `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;

/** 75 바이트 줄 접기 (RFC 5545) — 한글이 섞여도 넘지 않게 글자 단위로 */
export function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    if (bytes + b > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function buildIcs(occurrences: Occurrence[], opts: { calName: string; stamp: string }): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ai-note//우리집 학원 노트//KO',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${esc(opts.calName)}`,
    'X-WR-TIMEZONE:Asia/Seoul',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Seoul',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0900',
    'TZOFFSETTO:+0900',
    'TZNAME:KST',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];
  for (const o of occurrences) {
    if (o.status !== 'normal') continue;
    const who = o.targets.map((t) => memberById(t)?.name ?? t).join(', ');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${esc(o.key)}@ai-note`,
      `DTSTAMP:${opts.stamp}`,
      `DTSTART;TZID=Asia/Seoul:${dt(o.date, o.start)}`,
      `DTEND;TZID=Asia/Seoul:${dt(o.date, o.end)}`,
      `SUMMARY:${esc(`${o.title} (${who})`)}`,
      `DESCRIPTION:${esc(`${EVENT_KIND_LABELS[o.kind]}${o.subtitle ? ` · ${o.subtitle}` : ''}${o.checklist.length ? `\n준비물: ${o.checklist.join(', ')}` : ''}`)}`,
      ...(o.place ? [`LOCATION:${esc(o.place)}`] : []),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
