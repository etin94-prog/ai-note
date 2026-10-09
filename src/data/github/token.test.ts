import { describe, expect, it } from 'vitest';

import { cleanToken, looksLikeToken } from './token';

const T = 'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz';

describe('cleanToken', () => {
  it.each([
    [T, T],
    [`  ${T}\n`, T],
    [`"${T}"`, T],
    [`"${T}",`, T],
    [`"token": "${T}",`, T],
    [`{"token":"${T}","repo":"ai-note"}`, T],
  ])('%s', (input, expected) => {
    expect(cleanToken(input)).toBe(expected);
  });

  it('토큰 형식 판별', () => {
    expect(looksLikeToken(T)).toBe(true);
    expect(looksLikeToken('abc')).toBe(false);
  });
});
