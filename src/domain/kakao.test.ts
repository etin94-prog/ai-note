/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { groupBills, guessPeriod, parseKakaoExport, parseMessage, parsePasted, to24h } from './kakao';

// 실제 샘플 구조만 본뜬 가상 데이터 (이름·학원·전화번호 모두 지어냄)
const fixture = (name: string) => readFileSync(join(__dirname, '../../fixtures/kakao', name), 'utf8');
const parseFile = (name: string) =>
  parseKakaoExport(fixture(name))
    .map((m) => parseMessage(m))
    .filter((x) => x !== null);

describe('parseKakaoExport', () => {
  it('날짜 구분선·발신자·오전/오후 시각으로 메시지를 나눈다', () => {
    const msgs = parseKakaoExport(fixture('결제선생_가상.txt'));
    expect(msgs[0]).toMatchObject({ channel: '결제선생', sender: '결제선생', date: '2025-10-27', time: '18:27' });
    expect(msgs[0].text).toContain('청구금액 : 400,000원');
    expect(msgs.length).toBe(7);
    expect(to24h('오전', 12, 5)).toBe('00:05');
    expect(to24h('오후', 12, 5)).toBe('12:05');
  });
});

describe('형식 A — 결제선생', () => {
  const items = parseFile('결제선생_가상.txt');

  it('청구·자동결제·납부완료·취소를 구분하고 광고·채널 안내는 버린다', () => {
    expect(items.map((i) => i.kind)).toEqual(['bill', 'autopay', 'paid', 'cancel', 'bill']);
  });

  it('청구: 발급처·학생·품목·금액', () => {
    expect(items[0]).toMatchObject({ academyName: '가나다코딩-본점', studentName: '홍길동(가상고)', item: '11월 가나다코딩 정규반', amount: 400000 });
  });

  it('자동결제 안내: 카드명·결제 예정 일시', () => {
    expect(items[1]).toMatchObject({ amount: 700000, card: '가상카드 1', at: '2025-12-05T10:00' });
  });

  it('납부완료: 품목·거래 일시, 취소: 품목·취소금액(양수)', () => {
    expect(items[2]).toMatchObject({ item: '12월 가나다코딩 정규반', amount: 700000, at: '2025-12-05T10:23', academyName: '가나다코딩-본점' });
    expect(items[3]).toMatchObject({ item: '12월 가나다코딩 정규반', amount: 700000, studentName: '홍길동(가상고)', reason: '고객 요청에 의한 취소' });
  });

  it('신버전: "OO에서 청구서를" 학원명, 여러 줄 품목, 만료일', () => {
    expect(items[4]).toMatchObject({
      academyName: '라마바수학-라마바수학',
      studentName: '홍길동아빠',
      item: '<라마바수학> 여름방학 수학 8월 수강료 안내',
      amount: 630000,
      dueDate: '2026-08-28',
    });
  });

  it('같은 파일을 두 번 해석해도 지문이 같다 (X-28)', () => {
    expect(parseFile('결제선생_가상.txt').map((i) => i.fingerprint)).toEqual(items.map((i) => i.fingerprint));
    expect(new Set(items.map((i) => i.fingerprint)).size).toBe(items.length);
  });
});

describe('형식 B / B\' — 학원 결제 안내', () => {
  const items = parseFile('학원안내_가상.txt');

  it('구버전: 《학원명》 [이름]학생, ◆ 일시를 날짜로', () => {
    expect(items[0]).toMatchObject({ format: 'B2', academyName: '가상어학원', studentName: '홍길순', amount: 325000, date: '2023-03-30' });
  });

  it('신버전: 학생명·금액 구성·문의전화', () => {
    expect(items[1]).toMatchObject({
      format: 'B',
      academyName: '가상에듀학원',
      studentName: '홍길동A',
      amount: 300000,
      breakdown: { tuition: 270000, books: 30000, etc: 0 },
      phone: '0200000001',
    });
  });
});

describe('대상 월 추정 (X-24)', () => {
  const base = { fingerprint: 'x', kind: 'bill' as const, format: 'B' as const, channel: '', time: '00:00', academyName: '', studentName: '', amount: 1 };
  it('품목의 "N월"이 우선, 연말·연초 넘김 처리', () => {
    expect(guessPeriod({ ...base, date: '2025-12-22', item: '1월 정규반' })).toEqual({ period: '2026-01', source: 'item' });
    expect(guessPeriod({ ...base, date: '2026-01-03', item: '12월 정규반' })).toEqual({ period: '2025-12', source: 'item' });
  });
  it('품목이 없으면 20일 이후는 다음 달분', () => {
    expect(guessPeriod({ ...base, date: '2025-12-28' }).period).toBe('2026-01');
    expect(guessPeriod({ ...base, date: '2025-12-18' }).period).toBe('2025-12');
  });
});

describe('groupBills (X-21 재발송 합치기, X-26 결제선생 연결)', () => {
  it('결제선생: 자동결제 안내·납부완료·취소가 같은 청구에 연결', () => {
    const { groups, orphans } = groupBills(parseFile('결제선생_가상.txt'));
    expect(orphans).toHaveLength(0);
    const dec = groups.find((g) => g.period === '2025-12')!;
    expect(dec.first.kind).toBe('autopay');
    expect(dec.paid).toHaveLength(1);
    expect(dec.cancels).toHaveLength(1);
    expect(groups.map((g) => g.period)).toEqual(['2025-11', '2025-12', '2026-08']);
  });

  it('같은 금액 재안내는 합치되, 다음 달분으로 추정되면 따로 둔다', () => {
    const { groups } = groupBills(parseFile('학원안내_가상.txt'));
    const same = groups.filter((g) => g.first.amount === 360000);
    // 12/18(12월분) / 12/28·1/1(1월분, 재안내 1회)
    expect(same.map((g) => [g.period, g.resends.length])).toEqual([
      ['2025-12', 0],
      ['2026-01', 1],
    ]);
  });
});

describe('보완 케이스 (실제 파일 점검에서 발견)', () => {
  it('이름 뒤 공백·괄호가 있는 취소 메시지의 학생명', () => {
    const r = parseMessage({
      channel: '결제선생',
      sender: '결제선생',
      date: '2026-07-24',
      time: '15:56',
      text: '홍길동 (가상고)님. 납부하셨던 결제건이 정상적으로 취소되었습니다.\n\n[청구내역]\n- 품목 : 가상 특강\n- 금액 : 90,000원\n\n[결제취소내역]\n- 취소금액 : -90,000원',
    });
    expect(r).toMatchObject({ kind: 'cancel', studentName: '홍길동 (가상고)', amount: 90000 });
  });

  it('납부완료 메시지 없이 온 취소도 같은 품목·금액 청구에 연결', () => {
    const bill = parsePasted('[청구내역]\n- 품목 : 가상 특강\n- 금액 : 90,000원\n홍길동님. 가상학원에서 청구서를 보내셨습니다.', '2026-07-18')[0];
    const cancel = parseMessage({
      channel: 'x',
      sender: 'x',
      date: '2026-07-24',
      time: '10:00',
      text: '홍길동님. 납부하셨던 결제건이 정상적으로 취소되었습니다.\n- 품목 : 가상 특강\n- 취소금액 : -90,000원',
    })!;
    const { groups, orphans } = groupBills([bill, cancel]);
    expect(orphans).toHaveLength(0);
    expect(groups[0].cancels).toHaveLength(1);
    expect(groups[0].paid).toHaveLength(0);
  });
});

describe('parsePasted (I-04)', () => {
  it('메시지 본문만 붙여넣어도 해석, 날짜는 오늘', () => {
    const txt = `《가상에듀학원》 결제 안내\n◆ 학생명 : 홍길동A\n◆ 청구 총액 : 360,000 원\n결제하기 https://pay.example.com/abc123`;
    const r = parsePasted(txt, '2026-10-10');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ academyName: '가상에듀학원', amount: 360000, date: '2026-10-10', url: 'https://pay.example.com/abc123' });
  });
  it('카톡 대화 줄 형식으로 여러 개 붙여넣기', () => {
    const txt = fixture('결제선생_가상.txt').split('\n').slice(3, 15).join('\n');
    expect(parsePasted(txt, '2026-10-10').map((i) => i.kind)).toEqual(['bill']);
  });
  it('결제와 무관한 글은 빈 결과', () => {
    expect(parsePasted('오늘 저녁 늦어요', '2026-10-10')).toEqual([]);
  });
});
