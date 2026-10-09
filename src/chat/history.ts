/** 채팅 입력 기록 — 이 기기에만 저장, 30일 지나면 자동 삭제 (I-27) */

export interface LogLine {
  at: string;
  role: 'bot' | 'me';
  text: string;
}

const KEY = 'ai-note.chat-log.v1';
const KEEP_DAYS = 30;
const MAX = 300;

export function pruneLog(lines: LogLine[], now: Date): LogLine[] {
  const cutoff = now.getTime() - KEEP_DAYS * 86_400_000;
  return lines.filter((l) => new Date(l.at).getTime() >= cutoff).slice(-MAX);
}

export function loadLog(now = new Date()): LogLine[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const lines = raw ? (JSON.parse(raw) as LogLine[]) : [];
    const kept = pruneLog(lines, now);
    if (kept.length !== lines.length) globalThis.localStorage?.setItem(KEY, JSON.stringify(kept));
    return kept;
  } catch {
    return [];
  }
}

export function appendLog(line: LogLine, now = new Date()) {
  try {
    const next = pruneLog([...loadLog(now), line], now);
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    // 저장 공간이 없거나 막힌 브라우저 — 기록 없이 계속
  }
}

export function clearLog() {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    // 무시
  }
}
