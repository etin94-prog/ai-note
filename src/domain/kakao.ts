/**
 * 학원 카톡·문자 해석기 (Requirement 5.4, X-20~X-29, I-04).
 * 카톡 "대화 내보내기" 텍스트와 붙여넣은 메시지를 같은 규칙으로 해석한다.
 *
 * 지원 형식 (실제 샘플 구조 분석, 5.4.1)
 *  A. 결제선생 — 청구서 / 자동결제 안내 / 자동결제 납부완료 / 결제 취소 (한 채널에 여러 학원)
 *  B. 학원 결제 안내 — 《학원명》, ◆ 학생명, ▷ 수강료·교재비·기타, ▶/◆ 청구 총액, ☎ 문의전화
 *  B'. 구버전 — 《학원명》 [이름]학생 수강료 결제 안내, ◆ 일시, ▷ 청구 총액
 *
 * 원문은 저장하지 않고 추출 결과만 쓴다 (X-29).
 */

export interface KakaoMessage {
  channel: string;
  sender: string;
  date: string;
  time: string;
  text: string;
}

export type ParsedKind = 'bill' | 'autopay' | 'paid' | 'cancel';

export interface ParsedItem {
  /** 같은 메시지를 다시 가져와도 같은 값 (X-28) */
  fingerprint: string;
  kind: ParsedKind;
  format: 'A' | 'B' | 'B2' | 'paste';
  channel: string;
  date: string;
  time: string;
  academyName: string;
  studentName: string;
  /** 청구사유·품목 (결제선생) */
  item?: string;
  amount: number;
  breakdown?: { tuition?: number; books?: number; etc?: number };
  dueDate?: string;
  card?: string;
  /** 자동결제 예정 일시 / 실제 거래 일시 'YYYY-MM-DDTHH:mm' */
  at?: string;
  reason?: string;
  phone?: string;
  url?: string;
}

// ───────────────────────── 대화 파일 → 메시지 ─────────────────────────

const DATE_LINE = /^-{5,}\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*\S+요일\s*-{5,}$/;
const MSG_START = /^\[([^\]]+)\]\s*\[(오전|오후)\s*(\d{1,2}):(\d{2})\]\s?(.*)$/;
const pad = (n: number | string) => String(n).padStart(2, '0');

/** "오후 7:58" → "19:58" */
export function to24h(ampm: string, h: number, m: number) {
  let hh = h % 12;
  if (ampm === '오후') hh += 12;
  return `${pad(hh)}:${pad(m)}`;
}

/** 카톡 PC/모바일 "대화 내보내기" txt → 메시지 목록 */
export function parseKakaoExport(raw: string): KakaoMessage[] {
  const lines = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const head = /^(.+?) 님과 카카오톡 대화$/.exec(lines[0]?.trim() ?? '');
  const channel = head?.[1] ?? '';
  const out: KakaoMessage[] = [];
  let date = '';
  let cur: KakaoMessage | null = null;
  const flush = () => {
    if (cur) out.push({ ...cur, text: cur.text.trim() });
    cur = null;
  };
  for (const line of lines) {
    const d = DATE_LINE.exec(line.trim());
    if (d) {
      flush();
      date = `${d[1]}-${pad(d[2])}-${pad(d[3])}`;
      continue;
    }
    const m = MSG_START.exec(line);
    if (m && date) {
      flush();
      cur = { channel: channel || m[1], sender: m[1], date, time: to24h(m[2], +m[3], +m[4]), text: m[5] };
      continue;
    }
    if (cur) cur.text += `\n${line}`;
  }
  flush();
  return out;
}

// ───────────────────────── 메시지 → 결제 정보 ─────────────────────────

const won = (s: string | undefined) => (s ? Number(s.replace(/[^\d]/g, '')) : NaN);
const field = (text: string, label: string) => {
  // "- 청구금액 : 100,000원" / "◆ 학생명 : 홍길동" / "▷ 수강료 총액 : 270,000 원"
  const re = new RegExp(`[-◆▷▶☎]\\s*${label}\\s*:\\s*(.+)`);
  return re.exec(text)?.[1]?.trim();
};
/** "2025년 12월 05일 오전 10시" / "2025년 12월 05일 10시 23분" → 'YYYY-MM-DDTHH:mm' */
function koreanDateTime(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(오전|오후)?\s*(\d{1,2})시\s*(?:(\d{1,2})분)?/.exec(s);
  if (!m) return undefined;
  const h = m[4] ? Number(to24h(m[4], +m[5], 0).slice(0, 2)) : +m[5];
  return `${m[1]}-${pad(m[2])}-${pad(m[3])}T${pad(h)}:${pad(m[6] ?? 0)}`;
}
function koreanDate(s: string | undefined): string | undefined {
  const m = s && /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/.exec(s);
  return m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : undefined;
}
/** 여러 줄 값 ("- 품목 : <진성수학>\n여름방학 …") — 다음 "- " 줄이나 빈 줄 전까지 */
function multiline(text: string, label: string): string | undefined {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => new RegExp(`^-\\s*${label}\\s*:`).test(l.trim()));
  if (i < 0) return undefined;
  const parts = [lines[i].replace(new RegExp(`^.*?${label}\\s*:\\s*`), '')];
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j].trim();
    if (!l || /^[-◆▷▶☆☎[]/.test(l) || /버튼|방문 없이/.test(l)) break;
    parts.push(l);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
/** '"홍길동(가상고)"님' / '안녕하세요, 홍길동님.' / '홍길동님. 납부하셨던' */
function studentFromA(text: string): string {
  const q = /"([^"]+?)"\s*님/.exec(text);
  if (q) return q[1].trim();
  const a = /안녕하세요,\s*([^\s.,]+?)님/.exec(text);
  if (a) return a[1].trim();
  // "홍길동님. 납부하셨던" / "홍길동 (가상고)님. 납부하셨던"
  const b = /^(.+?)\s*님\.\s/m.exec(text);
  return b?.[1]?.trim() ?? '';
}

function hash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619);
    h2 = (Math.imul(h2, 31) + s.charCodeAt(i)) | 0;
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

/** 메시지 1개 해석. 결제와 무관한 메시지(채널 추가, 광고 등)는 null */
export function parseMessage(msg: KakaoMessage, format: ParsedItem['format'] | 'auto' = 'auto'): ParsedItem | null {
  const t = msg.text;
  const base = { channel: msg.channel, date: msg.date, time: msg.time };
  const fp = (kind: string, amount: number, extra = '') =>
    hash(`${msg.channel}|${msg.date}|${msg.time}|${kind}|${amount}|${extra}|${t.slice(0, 120)}`);
  const url = /https?:\/\/\S+/.exec(t)?.[0];

  // ── A. 결제선생 ──
  if (/결제건이 정상적으로 취소/.test(t)) {
    const amount = Math.abs(won(field(t, '취소금액')));
    const item = multiline(t, '품목') ?? '';
    if (!amount) return null;
    return { ...base, kind: 'cancel', format: fmt(format, 'A'), fingerprint: fp('cancel', amount, item), academyName: '', studentName: studentFromA(t), item, amount, reason: field(t, '취소사유') };
  }
  if (/납부완료|정상적으로 납부되었습니다/.test(t)) {
    const amount = won(field(t, '결제금액'));
    const item = /"([^"]+)"에 대한 청구서/.exec(t)?.[1] ?? '';
    const academy = /^\[([^\]]+)\]/.exec(t.trim())?.[1] ?? '';
    if (!amount) return null;
    return {
      ...base,
      kind: 'paid',
      format: fmt(format, 'A'),
      fingerprint: fp('paid', amount, item),
      academyName: academy,
      studentName: studentFromA(t),
      item,
      amount,
      at: koreanDateTime(field(t, '거래일시')),
    };
  }
  if (/\[청구내역\]/.test(t) && /청구서/.test(t)) {
    const amount = won(field(t, '청구금액') ?? field(t, '금액'));
    if (!amount) return null;
    const academy =
      field(t, '발급처') ?? /^\[([^\]]+)\]/.exec(t.trim())?.[1] ?? /님\.\s*(\S+?)에서 청구서를/.exec(t)?.[1] ?? '';
    const item = multiline(t, '청구사유') ?? multiline(t, '품목') ?? '';
    const autopay = /자동결제/.test(t) && /결제수단/.test(t);
    return {
      ...base,
      kind: autopay ? 'autopay' : 'bill',
      format: fmt(format, 'A'),
      fingerprint: fp(autopay ? 'autopay' : 'bill', amount, item),
      academyName: academy.replace(/^"|"$/g, ''),
      studentName: studentFromA(t),
      item,
      amount,
      dueDate: koreanDate(field(t, '만료일')),
      card: autopay ? field(t, '결제수단')?.replace(/\s*\(.*$/, '').trim() : undefined,
      at: autopay ? koreanDateTime(field(t, '결제일시')) : undefined,
      url,
    };
  }

  // ── B / B'. 학원 결제 안내 ──
  if (/《[^》]+》/.test(t) && /청구 총액/.test(t)) {
    const academy = /《([^》]+)》/.exec(t)![1].trim();
    const amount = won(field(t, '청구 총액'));
    if (!amount) return null;
    const tuition = won(field(t, '수강료 총액'));
    const books = won(field(t, '교재비 총액'));
    const etc = won(field(t, '기타 항목 총액'));
    const student = field(t, '학생명') ?? /\[([^\]]+)\]학생/.exec(t)?.[1] ?? '';
    const legacy = /학생 수강료 결제 안내/.test(t);
    const day = field(t, '일시');
    return {
      ...base,
      ...(day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? { date: day } : {}),
      kind: 'bill',
      format: fmt(format, legacy ? 'B2' : 'B'),
      fingerprint: fp('bill', amount),
      academyName: academy,
      studentName: student.trim(),
      amount,
      ...(Number.isFinite(tuition) ? { breakdown: { tuition, books: Number.isFinite(books) ? books : 0, etc: Number.isFinite(etc) ? etc : 0 } } : {}),
      phone: field(t, '문의전화')?.replace(/[^\d]/g, ''),
      url,
    };
  }
  return null;
}
const fmt = (forced: ParsedItem['format'] | 'auto', detected: ParsedItem['format']) => (forced === 'auto' ? detected : forced);

/**
 * 붙여넣은 텍스트 (I-04): 카톡 대화 줄 형식이면 그대로, 아니면 메시지 1개로 본다.
 * 날짜를 알 수 없으면 today.
 */
export function parsePasted(raw: string, today: string): ParsedItem[] {
  const text = raw.replace(/\r\n?/g, '\n').trim();
  if (!text) return [];
  const hasLines = text.split('\n').some((l) => MSG_START.test(l));
  if (hasLines) {
    const withDate = DATE_LINE.test(text.split('\n')[0].trim()) ? text : `--------------- ${today.slice(0, 4)}년 ${+today.slice(5, 7)}월 ${+today.slice(8, 10)}일 오늘요일 ---------------\n${text}`;
    return parseKakaoExport(`붙여넣기 님과 카카오톡 대화\n${withDate}`)
      .map((m) => parseMessage(m))
      .filter((x): x is ParsedItem => !!x);
  }
  const one = parseMessage({ channel: '붙여넣기', sender: '', date: today, time: '00:00', text });
  return one ? [{ ...one, format: one.format }] : [];
}

// ───────────────────────── 대상 월 추정 (X-24) ─────────────────────────

/** 품목에 "11월" 이 있으면 그 달, 없으면 메시지 날짜 20일 이후 → 다음 달분, 그 전 → 이번 달분 🔸 */
export function guessPeriod(p: ParsedItem): { period: string; source: 'item' | 'date' } {
  const y = +p.date.slice(0, 4);
  const mo = +p.date.slice(5, 7);
  const m = /(\d{1,2})\s*월/.exec(p.item ?? '');
  if (m && +m[1] >= 1 && +m[1] <= 12) {
    const month = +m[1];
    let year = y;
    if (month < mo - 6) year += 1;
    if (month > mo + 6) year -= 1;
    return { period: `${year}-${pad(month)}`, source: 'item' };
  }
  const day = +p.date.slice(8, 10);
  const next = day >= 20 ? (mo === 12 ? `${y + 1}-01` : `${y}-${pad(mo + 1)}`) : `${y}-${pad(mo)}`;
  return { period: next, source: 'date' };
}

// ───────────────────────── 재발송 합치기·짝짓기 (X-21, X-26) ─────────────────────────

export interface BillGroup {
  key: string;
  /** 대표 메시지 (첫 안내) */
  first: ParsedItem;
  resends: ParsedItem[];
  autopay?: ParsedItem;
  paid: ParsedItem[];
  cancels: ParsedItem[];
  period: string;
  periodSource: 'item' | 'date';
}

const norm = (s: string) => s.replace(/\s|\(.*?\)|㈜|\(주\)|학원|-.*$/g, '').toLowerCase();
const daysBetween = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;

/**
 * 청구 안내를 묶는다.
 * - 같은 학원·학생·금액이 resendDays 이내 다시 오면 재안내로 합침
 * - 결제선생: 같은 품목의 자동결제 안내·납부완료·취소를 그 청구에 연결
 */
export function groupBills(items: ParsedItem[], resendDays = 14): { groups: BillGroup[]; orphans: ParsedItem[] } {
  const sorted = [...items].sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  const groups: BillGroup[] = [];
  const orphans: ParsedItem[] = [];
  const sameStudent = (a: string, b: string) => norm(a) === norm(b) || norm(a).startsWith(norm(b)) || norm(b).startsWith(norm(a));
  for (const it of sorted) {
    if (it.kind === 'bill' || it.kind === 'autopay') {
      const itPeriod = guessPeriod(it).period;
      // 재안내: 같은 학원·학생·금액(·품목) + 14일 이내 + 추정 대상 월도 같아야 함
      // (같은 금액의 다음 달 청구를 재안내로 잘못 합치지 않도록)
      const g = [...groups].reverse().find(
        (x) =>
          norm(x.first.academyName) === norm(it.academyName) &&
          sameStudent(x.first.studentName, it.studentName) &&
          x.first.amount === it.amount &&
          (it.item ? norm(x.first.item ?? '') === norm(it.item) : true) &&
          daysBetween(x.first.date, it.date) <= resendDays &&
          (it.item || x.period === itPeriod) &&
          x.paid.length === 0,
      );
      if (g) {
        if (it.kind === 'autopay') g.autopay = it;
        else g.resends.push(it);
        continue;
      }
      const { period, source } = guessPeriod(it);
      groups.push({ key: it.fingerprint, first: it, resends: [], autopay: it.kind === 'autopay' ? it : undefined, paid: [], cancels: [], period, periodSource: source });
      continue;
    }
    // 납부완료·취소는 품목(+학원)으로 가장 최근 청구에 연결
    const target = [...groups].reverse().find(
      (x) =>
        !!it.item &&
        norm(x.first.item ?? '') === norm(it.item) &&
        (!it.academyName || norm(x.first.academyName) === norm(it.academyName)) &&
        x.first.date <= it.date &&
        // 취소는 납부완료 메시지가 없어도 연결 (다른 경로로 납부 후 취소된 경우 — 가져올 때 "취소로 확인된 납부" 기록)
        (it.kind === 'paid' ? x.first.amount === it.amount && x.paid.length === 0 : x.cancels.length === 0 && (x.paid.length > 0 || x.first.amount === it.amount)),
    );
    if (!target) {
      orphans.push(it);
      continue;
    }
    if (it.kind === 'paid') target.paid.push(it);
    else target.cancels.push(it);
  }
  return { groups, orphans };
}

/** 이름 비교용 정규화 (별칭 매칭) */
export const normalizeName = norm;
