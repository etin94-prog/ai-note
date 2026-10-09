import dayjs from 'dayjs';

import type { Op } from '@/data/repository';
import { type Cell, parseDate, str } from '@/io/excel/cells';

import { hash, normalizeName } from './kakao';
import type { Alias } from './kakaoImport';
import { type Payment, parseWon } from './money';

/**
 * 카드 이용내역 (C-01~C-03). 카드사 API 는 쓸 수 없어(C-04) 내려받은 파일·승인 문자로 받는다.
 * 학원 가맹점 거래만 청구와 짝지어 납부 기록을 만든다. 학원이 아닌 거래는 저장하지 않는다.
 */

/** 컬렉션 cardTxns (부모 전용) — 짝지어 기록한 거래만, 문서 id = fingerprint */
export interface CardTxn {
  fingerprint: string;
  card: string;
  /** 'YYYY-MM-DD' */
  date: string;
  time?: string;
  amount: number;
  merchant: string;
  cancelled: boolean;
  paymentId?: string;
}

// ───────────── 파일 (엑셀·CSV) ─────────────

const COLS: Record<'date' | 'time' | 'merchant' | 'amount' | 'card' | 'status' | 'approval', RegExp[]> = {
  date: [/^(이용|승인|거래|매출|사용)\s*(일자|일시|일)$/, /^(이용|승인|거래)\s*날짜$/, /일자|일시|날짜/],
  time: [/^(이용|승인|거래)\s*시간$/, /^시간$/],
  merchant: [/^(이용\s*)?가맹점(명)?$/, /가맹점|이용처|사용처|상호/],
  amount: [/^(이용|승인|거래|매출|결제)\s*금액(\(원\))?$/, /^금액(\(원\))?$/, /금액/],
  card: [/^(이용\s*)?카드(명)?$/, /카드\s*(번호|구분)?$/],
  status: [/취소|승인\s*구분|상태|구분/],
  approval: [/승인\s*번호/],
};

/** 머리글 줄 찾기 (카드사 파일은 위에 제목·조회 기간 줄이 있는 경우가 많음) */
export function detectColumns(rows: Cell[][]): { headerRow: number; col: Partial<Record<keyof typeof COLS, number>> } | null {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const hs = rows[r].map((c) => str(c).replace(/\s+/g, ' ').trim());
    const col: Partial<Record<keyof typeof COLS, number>> = {};
    for (const key of Object.keys(COLS) as (keyof typeof COLS)[]) {
      for (const re of COLS[key]) {
        const i = hs.findIndex((h, j) => h && re.test(h) && !Object.values(col).includes(j) && !(key === 'status' && /금액/.test(h)));
        if (i >= 0) {
          col[key] = i;
          break;
        }
      }
    }
    if (col.date !== undefined && col.merchant !== undefined && col.amount !== undefined) return { headerRow: r, col };
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');

function splitDateTime(c: Cell, today: string): { date?: string; time?: string } {
  if (c instanceof Date) {
    const t = `${pad(c.getUTCHours())}:${pad(c.getUTCMinutes())}`;
    return { date: `${c.getUTCFullYear()}-${pad(c.getUTCMonth() + 1)}-${pad(c.getUTCDate())}`, time: t === '00:00' ? undefined : t };
  }
  const s = str(c);
  const tm = /(\d{1,2}):(\d{2})/.exec(s);
  const time = tm ? `${pad(Number(tm[1]))}:${tm[2]}` : undefined;
  const d = s.replace(/\s*\d{1,2}:\d{2}(:\d{2})?.*$/, '').trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(d);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time };
  const p = parseDate(d);
  if (p.ok) return { date: p.value, time };
  m = /^(\d{1,2})[./-](\d{1,2})$/.exec(d);
  if (m) {
    let y = Number(today.slice(0, 4));
    if (`${y}-${pad(Number(m[1]))}` > today.slice(0, 7)) y--;
    return { date: `${y}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`, time };
  }
  return {};
}

function amountOf(c: Cell): number | null {
  if (typeof c === 'number') return Math.round(c);
  const t = str(c).replace(/\s/g, '');
  const neg = t.startsWith('-') || /^\(.*\)$/.test(t);
  const v = parseWon(t.replace(/^[-(]|\)$/g, ''));
  return v == null ? null : neg ? -v : v;
}

export interface ParsedTable {
  txns: CardTxn[];
  /** 읽지 못한 줄 수 */
  skipped: number;
  columns: string[];
}

export function parseCardTable(rows: Cell[][], today: string, cardName = ''): ParsedTable | null {
  const det = detectColumns(rows);
  if (!det) return null;
  const { headerRow, col } = det;
  const txns: CardTxn[] = [];
  let skipped = 0;
  for (const row of rows.slice(headerRow + 1)) {
    if (row.every((c) => str(c) === '')) continue;
    const { date, time: t1 } = splitDateTime(row[col.date!], today);
    const time = col.time !== undefined ? splitDateTime(row[col.time], today).time || str(row[col.time]).slice(0, 5) || t1 : t1;
    const merchant = str(row[col.merchant!]);
    const amt = amountOf(row[col.amount!]);
    if (!date || !merchant || amt == null || amt === 0) {
      skipped++;
      continue;
    }
    const status = col.status !== undefined ? str(row[col.status]) : '';
    const cancelled = amt < 0 || /취소/.test(status);
    const card = col.card !== undefined ? str(row[col.card]) : cardName;
    const approval = col.approval !== undefined ? str(row[col.approval]) : '';
    txns.push({
      fingerprint: `card:${hash([card, date, time ?? '', merchant, Math.abs(amt), approval, cancelled].join('|'))}`,
      card,
      date,
      ...(time ? { time } : {}),
      amount: Math.abs(amt),
      merchant,
      cancelled,
    });
  }
  const columns = Object.entries(col).map(([k, i]) => `${k}=${str(rows[headerRow][i as number])}`);
  return { txns, skipped, columns };
}

/** CSV 한 줄씩 (따옴표 안 쉼표 처리) */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === '\t') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      out.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  if (cur || row.length) {
    row.push(cur);
    out.push(row);
  }
  return out;
}

/** 카드사 CSV 는 EUC-KR 인 경우가 많음 */
export function decodeText(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '');
  if (!utf8.includes('�')) return utf8;
  try {
    return new TextDecoder('euc-kr').decode(buf);
  } catch {
    return utf8;
  }
}

// ───────────── 승인 문자·알림 (C-02) ─────────────

/**
 * 예) [Web발신] 가상카드(1234)승인 홍*동 700,000원(일시불)12/05 10:23 가나다코딩 누적...
 *     가상카드 승인 700,000원 일시불 12/05 10:23 가나다코딩
 *     [가상카드] 승인취소 700,000원 12/06 09:00 가나다코딩
 */
export function parseCardSms(raw: string, today: string): CardTxn[] {
  const out: CardTxn[] = [];
  const msgs = raw
    .split(/\n\s*\n|(?=\[Web발신\])/)
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  for (const m of msgs) {
    if (!/승인|결제|사용/.test(m) || !/원/.test(m)) continue;
    const card = /([가-힣A-Za-z]+카드|[가-힣A-Za-z]+(?:체크|BC|bc))\s*(?:\(\d{3,4}\))?/.exec(m)?.[0]?.trim() ?? '';
    if (!card) continue;
    const amt = /(\d{1,3}(?:,\d{3})+|\d+)\s*원/.exec(m);
    const dt = /(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/.exec(m);
    if (!amt || !dt) continue;
    const after = m.slice(dt.index + dt[0].length).trim();
    const merchant = after.replace(/\s*(누적|잔액|사용가능|한도|일시불|할부).*$/, '').trim();
    if (!merchant) continue;
    let y = Number(today.slice(0, 4));
    const mo = Number(dt[1]);
    if (`${y}-${pad(mo)}` > today.slice(0, 7)) y--;
    const date = `${y}-${pad(mo)}-${pad(Number(dt[2]))}`;
    const time = `${pad(Number(dt[3]))}:${dt[4]}`;
    const cancelled = /취소/.test(m);
    const amount = parseWon(amt[1])!;
    out.push({
      fingerprint: `card:${hash([card.replace(/\(.*/, ''), date, time, merchant, amount, '', cancelled].join('|'))}`,
      card,
      date,
      time,
      amount,
      merchant,
      cancelled,
    });
  }
  return out;
}

// ───────────── 짝짓기 (C-01, C-03) ─────────────

export interface OpenBill {
  id: string;
  label: string;
  academyId: string;
  dueDate: string;
  due: number;
  remaining: number;
}

/**
 * 가맹점 → 학원. 별칭 > 이름이 같음 > 한쪽이 다른 쪽을 포함(3글자 이상).
 * 카드 가맹점 이름은 짧은 낱말이 겹치기 쉬워('코딩' 등) 카톡보다 엄격하게 본다.
 */
export function resolveMerchant(merchant: string, aliases: Alias[], academies: { id: string; name: string }[]): string | 'ignore' | null {
  const n = normalizeName(merchant);
  const alias = aliases.find((a) => a.kind === 'academy' && normalizeName(a.text) === n);
  if (alias) return alias.targetId;
  const hit = academies.find((a) => {
    const m = normalizeName(a.name);
    if (!m || !n) return false;
    if (m === n) return true;
    const short = m.length <= n.length ? m : n;
    return short.length >= 3 && (n.includes(m) || m.includes(n));
  });
  return hit?.id ?? null;
}

export type MatchStatus = 'match' | 'choose' | 'already' | 'unknown' | 'other' | 'exists' | 'cancel';

export interface MatchRow {
  txn: CardTxn;
  status: MatchStatus;
  academyId?: string;
  /** 고를 수 있는 청구 (금액 같은 것 먼저) */
  candidates: (OpenBill & { exact: boolean })[];
  /** 기본 선택 */
  billId?: string;
}

const ACADEMY_LIKE =
  /학원|교육|에듀|edu|아카데미|academy|어학|수학|영어|국어|과학|논술|학습|과외|코딩|교습|러닝|스쿨|school|클래스|결제선생|피아노|미술|태권도|체육관/i;
const WINDOW_BEFORE = 35;
const WINDOW_AFTER = 30;

export function matchTxns(
  txns: CardTxn[],
  ctx: { bills: OpenBill[]; paidBills: OpenBill[]; aliases: Alias[]; academies: { id: string; name: string }[]; existing: Set<string> },
): MatchRow[] {
  return txns.map((txn): MatchRow => {
    if (ctx.existing.has(txn.fingerprint)) return { txn, status: 'exists', candidates: [] };
    const academy = resolveMerchant(txn.merchant, ctx.aliases, ctx.academies);
    if (academy === 'ignore') return { txn, status: 'other', candidates: [] };
    if (txn.cancelled) return { txn, status: academy ? 'cancel' : 'other', academyId: academy ?? undefined, candidates: [] };
    const inWindow = (b: OpenBill) => {
      const d = dayjs(txn.date);
      return !d.isBefore(dayjs(b.dueDate).subtract(WINDOW_BEFORE, 'day')) && !d.isAfter(dayjs(b.dueDate).add(WINDOW_AFTER, 'day'));
    };
    const exact = (b: OpenBill) => b.remaining === txn.amount || b.due === txn.amount;
    if (!academy) {
      // 학원 가맹점으로 보이거나, 금액이 열린 청구와 같으면 이름 연결을 묻는다
      const amountHit = ctx.bills.some((b) => exact(b) && inWindow(b));
      return { txn, status: ACADEMY_LIKE.test(txn.merchant) || amountHit ? 'unknown' : 'other', candidates: [] };
    }
    const mine = ctx.bills.filter((b) => b.academyId === academy && b.remaining > 0);
    const near = mine.filter(inWindow);
    const cands = (near.length ? near : mine)
      .map((b) => ({ ...b, exact: exact(b) }))
      .sort(
        (a, b) =>
          Number(b.exact) - Number(a.exact) || Math.abs(dayjs(a.dueDate).diff(txn.date)) - Math.abs(dayjs(b.dueDate).diff(txn.date)),
      );
    const gap = (b: OpenBill) => Math.abs(dayjs(b.dueDate).diff(dayjs(txn.date), 'day'));
    const exacts = cands.filter((c) => c.exact && inWindow(c)).sort((a, b) => gap(a) - gap(b));
    // 같은 금액 청구가 여럿이면 기한이 가장 가까운 것 (차이가 1주 미만이면 직접 고르게)
    if (exacts.length >= 1) {
      const clear = exacts.length === 1 || gap(exacts[1]) - gap(exacts[0]) >= 7;
      return { txn, status: clear ? 'match' : 'choose', academyId: academy, candidates: cands, billId: exacts[0].id };
    }
    // 같은 금액 청구가 이미 납부 완료 → 따로 기록된 납부일 가능성
    if (ctx.paidBills.some((b) => b.academyId === academy && b.due === txn.amount && inWindow(b)))
      return { txn, status: 'already', academyId: academy, candidates: cands };
    return { txn, status: 'choose', academyId: academy, candidates: cands };
  });
}

export function buildCardOps(rows: { row: MatchRow; billId: string }[], ctx: { by: string; now: string }): Op[] {
  const ops: Op[] = [];
  const R = (o: object) => o as unknown as Record<string, unknown>;
  for (const { row, billId } of rows) {
    const t = row.txn;
    const paymentId = `card:${t.fingerprint.replace(/^card:/, '')}`;
    const pay: Payment = {
      billId,
      paidOn: t.date,
      amount: t.amount,
      method: 'card',
      card: t.card,
      by: ctx.by,
      at: ctx.now,
      memo: `카드 이용내역으로 확인 (${t.merchant})`,
    };
    ops.push({ type: 'create', col: 'payments', id: paymentId, data: R(pay) });
    const txn: CardTxn = { ...t, paymentId };
    ops.push({ type: 'create', col: 'cardTxns', id: t.fingerprint, data: R(txn) });
  }
  return ops;
}

/** 납부 기록이 카드 내역으로 확인된 것인지 (C-03 배지) */
export const isCardConfirmed = (paymentId: string) => paymentId.startsWith('card:');

export const merchantKey = (m: string) => normalizeName(m) || m;
