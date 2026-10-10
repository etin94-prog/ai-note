import { describe, expect, it } from 'vitest';

import { authErrorMessage, makeFamilyCode, normalizeFamilyCode } from './family';

describe('가족 코드', () => {
  it('헷갈리는 글자 없이 ABCD-EFGH 꼴', () => {
    for (let i = 0; i < 50; i++) {
      const c = makeFamilyCode();
      expect(c).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
      expect(normalizeFamilyCode(c)).toBe(c);
    }
  });
  it('소문자·공백·하이픈 빠짐을 받아 정리, 잘못된 코드는 거절', () => {
    expect(normalizeFamilyCode(' abcd efgh ')).toBe('ABCD-EFGH');
    expect(normalizeFamilyCode('abcdefgh')).toBe('ABCD-EFGH');
    expect(normalizeFamilyCode('ABC')).toBeNull();
    expect(normalizeFamilyCode('ABCD-EFG0')).toBeNull(); // 0 은 쓰지 않는 글자
  });
});

describe('오류 안내 문장', () => {
  it('Firebase 오류 코드를 쉬운 말로', () => {
    expect(authErrorMessage({ code: 'auth/invalid-credential' })).toContain('맞지 않습니다');
    expect(authErrorMessage({ code: 'permission-denied' })).toContain('권한');
    expect(authErrorMessage(new Error('그 밖의 오류'))).toBe('그 밖의 오류');
  });
});
