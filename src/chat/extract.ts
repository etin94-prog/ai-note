import dayjs from 'dayjs';

import { normalizeName } from '@/domain/kakao';
import type { Alias } from '@/domain/kakaoImport';
import { addMonths, DEFAULT_EXPENSE_CATEGORIES, parseWon, type PayMethod, type RefundReason } from '@/domain/money';
import { type MemberId, WEEKDAY_LABELS, type Weekday } from '@/domain/types';

/**
 * 한 문장에서 "알려진 단어"를 찾아 칸을 미리 채운다 (I-21 ③).
 * 자녀 이름, 등록된 학원명·별칭, 요일, 시간, 금액, 날짜 표현. 해석 못 한 부분은 leftover 로 남긴다 (버리지 않음).
 */

export interface KnownCtx {
  today: string;
  academies: { id: string; name: string; subject?: string }[];
  aliases: Alias[];
  places: string[];
  categories: string[];
}

export interface Extracted {
  children?: MemberId[];
  academyId?: string;
  /** 학원 후보가 여러 개 */
  academyCandidates?: string[];
  /** 등록되지 않은 학원 이름으로 보이는 말 ("○○학원") */
  academyText?: string;
  date?: string;
  start?: string;
  end?: string;
  weekdays?: Weekday[];
  /** '매주' 가 있거나 요일이 여러 개 → 반복 */
  repeat?: boolean;
  amount?: number;
  period?: string;
  method?: PayMethod;
  category?: string;
  reason?: RefundReason;
  place?: string;
  /** 종류 추정 */
  kindHint?: 'event' | 'enrollment' | 'payment' | 'refund' | 'expense';
  leftover: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const WD = '월화수목금토일';

/** 학원·약속 시각: 오전/오후가 없고 1~9시면 오후로 본다 */
function hm(mer: string | undefined, h: number, m: number, guessPm: boolean) {
  let hh = h;
  if (mer === '오후' && hh < 12) hh += 12;
  if (mer === '오전' && hh === 12) hh = 0;
  if (!mer && guessPm && hh >= 1 && hh <= 9) hh += 12;
  return `${pad(hh)}:${pad(m)}`;
}

const TIME = String.raw`(오전|오후|아침|저녁|밤)?\s*(\d{1,2})(?::(\d{2})|\s*시(?!간)\s*(?:(\d{1,2})\s*분|(반))?)`;
const mer = (s?: string) => (s === '아침' ? '오전' : s === '저녁' || s === '밤' ? '오후' : s);
const minOf = (mm?: string, min?: string, half?: string) => Number(mm ?? min ?? (half ? 30 : 0));

export function parseTimeWord(s: string, guessPm = true): string | null {
  const m = new RegExp(`^\\s*${TIME}\\s*$`).exec(s);
  if (!m) return null;
  const h = Number(m[2]);
  const mi = minOf(m[3], m[4], m[5]);
  if (h > 24 || mi > 59) return null;
  return hm(mer(m[1]), h, mi, guessPm);
}

/** 날짜 표현 → 'YYYY-MM-DD' */
export function parseDateWord(s: string, today: string): string | null {
  const t = s.trim();
  const base = dayjs(today);
  const rel: Record<string, number> = {
    그저께: -2,
    그제: -2,
    어제: -1,
    오늘: 0,
    내일: 1,
    모레: 2,
    글피: 3,
  };
  if (t in rel) return base.add(rel[t], 'day').format('YYYY-MM-DD');
  let m = /^(이번|다음|담|지난|저번)?\s*주?\s*([월화수목금토일])(?:요일)?$/.exec(t);
  if (m) {
    const wd = (WD.indexOf(m[2]) + 1) % 7; // 월=1 … 일=0
    const monday = base.subtract((base.day() + 6) % 7, 'day');
    const weekShift = m[1] === '다음' || m[1] === '담' ? 7 : m[1] === '지난' || m[1] === '저번' ? -7 : 0;
    let d = monday.add(((wd + 6) % 7) + weekShift, 'day');
    // '토요일'만 말하면 다가오는 토요일
    if (!m[1] && d.isBefore(base, 'day')) d = d.add(7, 'day');
    return d.format('YYYY-MM-DD');
  }
  m = /^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})$/.exec(t);
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  m = /^(\d{1,2})\s*(?:[/.]|월)\s*(\d{1,2})\s*일?$/.exec(t);
  if (m) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    let y = base.year();
    // 반년 넘게 지난 날짜면 내년으로
    if (dayjs(`${y}-${pad(mo)}-${pad(d)}`).isBefore(base.subtract(180, 'day'))) y++;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
  m = /^(\d{1,2})\s*일$/.exec(t);
  if (m && Number(m[1]) <= 31) {
    let d = base.date(Number(m[1]));
    if (d.isBefore(base.subtract(15, 'day'), 'day')) d = d.add(1, 'month');
    return d.format('YYYY-MM-DD');
  }
  return null;
}

/** 'N월분' → 가장 가까운 해의 그 달 */
export function periodOf(month: number, today: string): string {
  const cur = today.slice(0, 7);
  const cands = [-1, 0, 1].map((dy) => `${Number(today.slice(0, 4)) + dy}-${pad(month)}`);
  const dist = (p: string) => Math.abs(dayjs(`${p}-01`).diff(dayjs(`${cur}-01`), 'month'));
  return cands.sort((a, b) => dist(a) - dist(b))[0];
}

export function parseWeekdayWord(s: string): Weekday[] | null {
  const t = s.replace(/요일|매주|마다|[\s,·/]/g, '');
  if (!t || [...t].some((c) => !WD.includes(c))) return null;
  const out: Weekday[] = [];
  for (const c of t) {
    const w = WEEKDAY_LABELS.indexOf(c as (typeof WEEKDAY_LABELS)[number]) as Weekday;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

const CHILD_WORDS: [RegExp, MemberId[]][] = [
  [/(둘\s*다|애들|아이들|두\s*명)/, ['son', 'daughter']],
  [/아들/, ['son']],
  [/딸/, ['daughter']],
  [/엄마/, ['mom']],
  [/아빠/, ['dad']],
];

const METHOD_WORDS: [RegExp, PayMethod][] = [
  [/카드/, 'card'],
  [/(계좌\s*)?이체|송금/, 'transfer'],
  [/현금/, 'cash'],
  [/지역\s*화폐|지역화폐|상품권/, 'local'],
  [/학원\s*앱/, 'app'],
];

const REASON_WORDS: [RegExp, RefundReason][] = [
  [/퇴원|그만/, 'withdraw'],
  [/휴원|쉬/, 'pause'],
  [/학원\s*사정|휴강/, 'academy'],
];

export function extractKnown(text: string, ctx: KnownCtx): Extracted {
  const out: Extracted = { leftover: '' };
  let rest = ` ${text.replace(/https?:\/\/\S+/g, ' ')} `;
  const take = (re: RegExp, f: (m: RegExpExecArray) => boolean | void) => {
    const m = re.exec(rest);
    if (!m) return;
    if (f(m) === false) return;
    rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length);
  };

  // 종류 힌트 (단어는 남겨 둠 — 제목·메모에 쓰일 수 있음)
  if (/환불/.test(text)) out.kindHint = 'refund';
  else if (/납부|냈|결제\s*했|결제\s*완료|입금/.test(text)) out.kindHint = 'payment';
  else if (/지출|샀|구입|구매|사\s*줬/.test(text)) out.kindHint = 'expense';
  else if (/수강|등록|다니|다닌/.test(text)) out.kindHint = 'enrollment';

  // 금액
  take(/(\d[\d,]*(?:\.\d+)?)\s*(만\s*원?|원)/, (m) => {
    const v = parseWon(m[1] + m[2].replace(/\s/g, ''));
    if (v == null) return false;
    out.amount = v;
  });
  // 대상 월 'N월분' / 'N월 원비'
  take(/(\d{1,2})\s*월\s*(분|원비|수강료|학원비|교습비)/, (m) => {
    out.period = periodOf(Number(m[1]), ctx.today);
    if (m[2] !== '분') rest += ` ${m[2]}`;
  });
  // 시간 범위
  take(new RegExp(`${TIME}\\s*(?:부터)?\\s*[~\\-–]\\s*${TIME}\\s*(?:까지)?`), (m) => {
    const sm = mer(m[1]);
    const s = hm(sm, Number(m[2]), minOf(m[3], m[4], m[5]), true);
    let e = hm(mer(m[6]) ?? sm, Number(m[7]), minOf(m[8], m[9], m[10]), true);
    if (e <= s && Number(e.slice(0, 2)) < 12) e = `${pad(Number(e.slice(0, 2)) + 12)}${e.slice(2)}`;
    out.start = s;
    out.end = e;
  });
  if (!out.start) take(new RegExp(TIME), (m) => void (out.start = hm(mer(m[1]), Number(m[2]), minOf(m[3], m[4], m[5]), true)));
  // N시간
  if (out.start && !out.end)
    take(/(\d(?:\.\d)?)\s*시간(?:\s*동안)?/, (m) => {
      out.end = dayjs(`2000-01-01T${out.start}`)
        .add(Number(m[1]) * 60, 'minute')
        .format('HH:mm');
    });

  // 날짜
  take(/(\d{4}[-./]\s*\d{1,2}[-./]\s*\d{1,2})/, (m) => {
    const d = parseDateWord(m[1], ctx.today);
    if (!d) return false;
    out.date = d;
  });
  if (!out.date)
    take(/(?<![\d])(\d{1,2}\s*(?:[/.]|월)\s*\d{1,2}\s*일?)(?![\d])/, (m) => {
      const d = parseDateWord(m[1], ctx.today);
      if (!d) return false;
      out.date = d;
    });
  if (!out.date)
    take(/(그저께|그제|어제|오늘|내일|모레|글피)/, (m) => {
      out.date = parseDateWord(m[1], ctx.today)!;
    });
  if (!out.date)
    take(/(이번|다음|담|지난|저번)\s*주\s*([월화수목금토일])(?:요일)?/, (m) => {
      out.date = parseDateWord(`${m[1]}${m[2]}`, ctx.today)!;
    });

  // 요일: '월수금', '월,수', '화요일' — 앞이 문장 시작·공백·'매주' 일 때만 ('수학' 같은 낱말 제외)
  const repeatWord = /매주|마다/.test(rest);
  take(/(?<=\s|매주)((?:[월화수목금토일]\s*[,·/]?\s*)+)(요일)?(?=\s|$|\d|마다|에|,)/, (m) => {
    const w = parseWeekdayWord(m[1]);
    if (!w) return false;
    out.weekdays = w;
  });
  if (out.weekdays) {
    out.repeat = repeatWord || out.weekdays.length > 1;
    rest = rest.replace(/매주|마다/g, ' ');
  }

  // 자녀
  for (const [re, ids] of CHILD_WORDS) {
    const m = re.exec(rest);
    if (m) {
      out.children = [...new Set([...(out.children ?? []), ...ids])];
      rest = rest.replace(re, ' ');
    }
  }
  for (const a of ctx.aliases.filter((x) => x.kind === 'child' && x.targetId !== 'ignore')) {
    if (a.text && rest.includes(a.text)) {
      out.children = [...new Set([...(out.children ?? []), a.targetId as MemberId])];
      rest = rest.replace(a.text, ' ');
    }
  }

  // 학원: 별칭·등록 이름(띄어쓰기 무시) > "○○학원" 과목 일치
  const n = normalizeName(rest);
  const named = [
    ...ctx.aliases.filter((a) => a.kind === 'academy' && a.targetId !== 'ignore').map((a) => ({ id: a.targetId, name: a.text })),
    ...ctx.academies.map((a) => ({ id: a.id, name: a.name })),
  ]
    .filter((x) => normalizeName(x.name) && n.includes(normalizeName(x.name)))
    .sort((a, b) => b.name.length - a.name.length);
  if (named.length) {
    out.academyId = named[0].id;
    rest = rest.replace(
      new RegExp(
        named[0].name
          .split('')
          .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('\\s*'),
      ),
      ' ',
    );
  } else {
    take(/([가-힣A-Za-z0-9]+)\s*학원/, (m) => {
      const word = m[1];
      const subj = ctx.academies.filter(
        (a) => normalizeName(a.name).includes(normalizeName(word)) || (a.subject && a.subject.includes(word)),
      );
      if (subj.length === 1) out.academyId = subj[0].id;
      else if (subj.length > 1) out.academyCandidates = subj.map((a) => a.id);
      else out.academyText = `${word}학원`;
    });
  }

  // 결제 수단 · 환불 사유 · 지출 분류 · 장소
  for (const [re, v] of METHOD_WORDS)
    if (re.test(rest)) {
      out.method = v;
      rest = rest.replace(re, ' ');
      break;
    }
  for (const [re, v] of REASON_WORDS)
    if (re.test(rest)) {
      out.reason = v;
      break;
    }
  for (const c of [...new Set([...ctx.categories, ...DEFAULT_EXPENSE_CATEGORIES])].sort((a, b) => b.length - a.length)) {
    const key = c.split('·')[0];
    if (key && rest.includes(key)) {
      out.category = c;
      rest = rest.replace(c, ' ').replace(key, ' ');
      break;
    }
  }
  for (const p of ctx.places)
    if (p && rest.includes(p)) {
      out.place = p;
      rest = rest.replace(p, ' ');
      break;
    }

  out.leftover = rest
    .replace(
      /(^|\s)(에|에서|은|는|이|가|을|를|의|도|부터|까지|으로|로|하고|그리고|이랑|랑|요|해줘|해 줘|추가|입력|등록해줘|넣어줘|일정|냈어|냈음|냈다|냈어요|납부|납부했어|납부함|했어|했음|완료|환불|환불요청|지출|샀어|썼어|결제|결제했어)(?=\s|$)/g,
      ' ',
    )
    .replace(/[,.!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return out;
}

export const addPeriod = addMonths;
