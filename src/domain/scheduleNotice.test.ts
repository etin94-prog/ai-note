import { describe, expect, it } from 'vitest';

import { parseScheduleNotice } from './scheduleNotice';

// 실제 공지 형식 (학원·선생님 이름, 전화번호는 가상)
const NOTICE = `화학 10/23 수업공지
[Web발신]
◆가나영재 1-2 기말 화학 가나다T 개강안내◆

※ 내일 10/23(금)은 첫수업이라 테스트를 진행하지 않습니다.
★ 8:15-11:15 수업진행합니다. 일정 꼭 확인 부탁드립니다.

★화학-가나다T

-수업시간: 금 pm 7:15-
-수업일정: 10/23, 10/30, 11/6, 11/13, ★11/18(수), 11/27, 12/4 (7회)
-수업장소 : 서울 가상구 가상로 123 2층
https://example.com/map
(가상고 바로 맞은편입니다)

☎상담 및 문의
010-0000-0000 / 02-000-0000
Gana solution`;

describe('수업 일정 공지 해석', () => {
  const n = parseScheduleNotice(NOTICE, '2026-10-22')!;

  it('제목·장소·학원', () => {
    expect(n.title).toBe('화학 가나다T');
    expect(n.place).toBe('서울 가상구 가상로 123 2층');
    expect(n.academy).toBe('Gana solution');
    expect(n.memo).not.toContain('Web발신');
    expect(n.memo).toContain('https://example.com/map');
  });

  it('날짜 7회, 요일이 다른 날(11/18 수)도 그대로', () => {
    expect(n.sessions.map((s) => s.date)).toEqual(['2026-10-23', '2026-10-30', '2026-11-06', '2026-11-13', '2026-11-18', '2026-11-27', '2026-12-04']);
  });

  it('정규 pm 7:15 시작, 끝은 다른 줄의 11:15 에서 빌려 와 추정 · 첫날은 8:15-11:15', () => {
    expect([n.start, n.end, n.endGuessed]).toEqual(['19:15', '23:15', true]);
    expect(n.sessions[0]).toEqual({ date: '2026-10-23', start: '20:15', end: '23:15', special: true });
    expect(n.sessions[1]).toEqual({ date: '2026-10-30', start: '19:15', end: '23:15' });
    expect(n.warnings.some((w) => w.includes('추정'))).toBe(true);
    expect(n.warnings.some((w) => w.includes('회인데'))).toBe(false);
  });

  it('끝 시각이 있으면 그대로, 회차 수가 다르면 경고, 연말 → 다음 해', () => {
    const m = parseScheduleNotice('수학 특강 안내\n수업시간: 오후 7시~10시\n수업일정: 12/26, 1/2 (3회)', '2026-12-20')!;
    expect([m.start, m.end, m.endGuessed]).toEqual(['19:00', '22:00', false]);
    expect(m.sessions.map((s) => s.date)).toEqual(['2026-12-26', '2027-01-02']);
    expect(m.warnings[0]).toContain('3회인데');
  });

  it('"오후4-7시", 월이 빠진 날짜 목록, (총 7회), 강의실 주소, "안녕하세요 OO입니다"', () => {
    const SUN = `[가나다T가나영1 생명2(일) 개강 안내]
[Web발신]
[가나다T○가나영1 생명2(일) 개강 안내]

안녕하세요 가상에듀입니다.
가나영 1학년 가나다T 생명2 2학기 기말 개강 안내입니다.

-시간: 일요일 오후4-7시

-개강: 10월 25일 일요일 오후4-7시 (※11/8, 11/19 무료 클리닉 2회 진행 + 3대1 무료 클리닉 4회 ==> 총 6회 클리닉)

-일정: 10/25, 11/1, 15, 22, 29, 12/6 (총 7회)

-강의실: 가상에듀 본관 2층 1강의실(가상로 444 가상빌딩 2층) https://example.com/a
(※강의실은 학원 상황에 따라 변경 가능합니다.)

▶수업 취소는 수업일 하루 전까지 가능합니다.

☎ 상담: 010-0000-0000(카톡& 문자 가능)
☎ 학원 문의: 02-000-0000 / 010-0000-0001(업무폰)
(주)가상에듀`;
    const n = parseScheduleNotice(SUN, '2026-10-22')!;
    expect(n.title).toBe('생명2 가나다T');
    expect([n.start, n.end, n.endGuessed]).toEqual(['16:00', '19:00', false]);
    // 월이 빠진 15, 22, 29 는 11월 — 클리닉 날짜(11/8, 11/19)는 넣지 않음
    expect(n.sessions.map((s) => s.date.slice(5))).toEqual(['10-25', '11-01', '11-15', '11-22', '11-29', '12-06']);
    expect(n.sessions.every((s) => !s.special)).toBe(true);
    expect(n.warnings).toEqual(['공지에는 7회인데 날짜는 6개를 찾았습니다']);
    expect(n.place).toBe('가상로 444 가상빌딩 2층');
    expect(n.academy).toBe('가상에듀');

    const SAT = SUN.replace(/생명2\(일\)/g, '물리2(토)')
      .replace(/생명2 2학기/, '물리2 2학기')
      .replace('-시간: 일요일 오후4-7시', '-시간: 토요일 오후1-4시(클리닉 학원 문의)')
      .replace('-일정: 10/25, 11/1, 15, 22, 29, 12/6 (총 7회)', '-일정: 10/24, 31, 11/7, 14, 21, 28, 12/5 (총 7회)');
    const s = parseScheduleNotice(SAT, '2026-10-22')!;
    expect(s.title).toBe('물리2 가나다T');
    expect([s.start, s.end]).toEqual(['13:00', '16:00']);
    expect(s.sessions.map((x) => x.date.slice(5))).toEqual(['10-24', '10-31', '11-07', '11-14', '11-21', '11-28', '12-05']);
    expect(s.warnings).toEqual([]);
  });

  it('목록 괄호 속 "+1.5H 2회 줌 수업, 총 4회" 는 날짜가 아님, 과목 "정보2B"', () => {
    const INFO = `[가나다T가나영1 정보2B(일) 개강 안내]
[Web발신]
안녕하세요 가상에듀입니다.
-시간: 일요일 오후1-4시
-개강: 11월 1일 일요일 오후1-4시
-일정: 11/1, 8, 22 (+1.5H 2회 개인 맞춤 줌 수업, 총 4회)
-강의실: 가상 별관(가상로462 가상빌딩 5층) 1강의실 https://example.com/b
(주)가상에듀`;
    const n = parseScheduleNotice(INFO, '2026-10-31')!;
    expect(n.title).toBe('정보2B 가나다T');
    expect([n.start, n.end]).toEqual(['13:00', '16:00']);
    expect(n.sessions.map((s) => s.date)).toEqual(['2026-11-01', '2026-11-08', '2026-11-22']);
    expect(n.warnings).toEqual(['공지에는 4회인데 날짜는 3개를 찾았습니다']);
    expect(n.place).toBe('가상로462 가상빌딩 5층');
  });

  it('요일 표시가 실제와 다르면 알려 줌, 일정 공지가 아니면 null', () => {
    const w = parseScheduleNotice('수업시간: 6:00-8:00\n수업일정: 10/24(금), 10/31', '2026-10-22')!;
    expect(w.warnings[0]).toContain('토요일');
    expect(parseScheduleNotice('《가나학원》 결제 안내\n청구 총액 : 360,000 원', '2026-10-22')).toBeNull();
  });
});
