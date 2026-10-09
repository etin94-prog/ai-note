/**
 * 붙여넣은 토큰 정리. 파일에서 복사할 때 흔히 섞이는 따옴표·공백·줄바꿈,
 * JSON 한 줄("token": "…") 이나 JSON 전체를 붙여넣은 경우도 토큰만 꺼낸다.
 */
export function cleanToken(input: string): string {
  const s = input.trim();
  const m = /(github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+)/.exec(s);
  if (m) return m[1];
  return s.replace(/^["'`]+|["'`,]+$/g, '').trim();
}

export function looksLikeToken(t: string): boolean {
  return /^(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})$/.test(t);
}
