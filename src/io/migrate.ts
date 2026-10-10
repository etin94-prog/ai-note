import type { Collection, Repository, StoredDoc } from '@/data/repository';

import { ALL_COLLECTIONS, type AllData, applyInChunks, countDocs, loadAll, restoreOps } from './backup';

/**
 * 저장 모드 이동 (D-M2, D-M3, 구현계획서 3.4): GitHub ↔ Firebase ↔ 체험 전체 복사.
 * 대상이 비어 있으면 그대로 복사, 데이터가 있으면 (백업 후) 확인을 받아 덮어쓴다 — 병합하지 않음.
 * 끝나면 건수·금액 합계·참조를 양쪽에서 대조한다.
 */

export interface CheckRow {
  label: string;
  source: string;
  target: string;
  ok: boolean;
}

const sum = (docs: StoredDoc[] | undefined, key: string, skipVoided = true) =>
  (docs ?? []).filter((d) => !(skipVoided && d.voided)).reduce((s, d) => s + (Number(d[key]) || 0), 0);

/** 참조가 끊긴 문서 수 (청구 없는 납부 등) */
function brokenRefs(d: AllData): number {
  const ids = (c: Collection) => new Set((d[c] ?? []).map((x) => x.id));
  const bills = ids('bills');
  const academies = ids('academies');
  const enrollments = ids('enrollments');
  const refunds = ids('refunds');
  let n = 0;
  for (const p of d.payments ?? []) if (!bills.has(String(p.billId))) n++;
  for (const a of d.adjustments ?? []) if (!bills.has(String(a.billId))) n++;
  for (const r of d.refunds ?? []) if (!bills.has(String(r.billId))) n++;
  for (const r of d.receipts ?? []) if (!refunds.has(String(r.refundId))) n++;
  for (const e of d.enrollments ?? []) if (!academies.has(String(e.academyId))) n++;
  for (const c of d.enrollmentCosts ?? []) if (!enrollments.has(String(c.enrollmentId))) n++;
  return n;
}

/** 대조표 (D-M2) */
export function reconcile(source: AllData, target: AllData): CheckRow[] {
  const rows: CheckRow[] = [];
  for (const col of ALL_COLLECTIONS) {
    const a = source[col]?.length ?? 0;
    const b = target[col]?.length ?? 0;
    if (a === 0 && b === 0) continue;
    rows.push({ label: `${col} 건수`, source: String(a), target: String(b), ok: a === b });
  }
  const money: [string, Collection, string][] = [
    ['청구 금액 합계', 'bills', 'amount'],
    ['납부 금액 합계', 'payments', 'amount'],
    ['환불 수령 합계', 'receipts', 'amount'],
    ['기타 지출 합계', 'expenses', 'amount'],
  ];
  for (const [label, col, key] of money) {
    const a = sum(source[col], key);
    const b = sum(target[col], key);
    if (a === 0 && b === 0) continue;
    rows.push({ label, source: a.toLocaleString('ko-KR'), target: b.toLocaleString('ko-KR'), ok: a === b });
  }
  const ra = brokenRefs(source);
  const rb = brokenRefs(target);
  rows.push({ label: '끊긴 참조', source: String(ra), target: String(rb), ok: rb <= ra });
  // 같은 id 문서 내용이 같은지 (메타 제외)
  const strip = (d: StoredDoc) => JSON.stringify(Object.entries(d).filter(([k]) => !['version', 'createdAt', 'updatedAt', 'updatedBy', 'schemaVersion'].includes(k)).sort());
  let diff = 0;
  for (const col of ALL_COLLECTIONS) {
    const t = new Map((target[col] ?? []).map((d) => [d.id, strip(d)]));
    for (const d of source[col] ?? []) if (t.get(d.id) !== strip(d)) diff++;
  }
  rows.push({ label: '내용이 다른 문서', source: '-', target: String(diff), ok: diff === 0 });
  return rows;
}

export interface MigrateResult {
  copied: number;
  rows: CheckRow[];
  ok: boolean;
}

/** 대상이 비어 있지 않으면 overwrite 가 true 일 때만 진행 (호출 전에 대상 백업을 받아 둘 것) */
export async function migrate(
  source: Repository,
  target: Repository,
  opts: { overwrite: boolean; ctxOf: (label: string) => { by: string; label: string; device?: string } },
): Promise<MigrateResult> {
  const src = await loadAll(source);
  const before = await loadAll(target);
  if (countDocs(before) > 0 && !opts.overwrite) throw new Error(`대상에 이미 데이터 ${countDocs(before)}건이 있습니다. 덮어쓰기를 확인해 주세요.`);
  const ops = restoreOps(before, src);
  if (ops.length) await applyInChunks(target, ops, `저장 모드 이동: ${countDocs(src)}건 복사`, opts.ctxOf);
  const after = await loadAll(target);
  const rows = reconcile(src, after);
  return { copied: countDocs(src), rows, ok: rows.every((r) => r.ok) };
}
