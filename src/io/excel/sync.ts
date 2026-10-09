import type { Collection, Op, StoredDoc } from '@/data/repository';

import {
  type Cell,
  fmtBool,
  fmtSlots,
  fmtWeekdays,
  MEMBER_LABELS,
  type Parsed,
  parseBool,
  parseDate,
  parseEnum,
  parseInt0,
  parseList,
  parseMembers,
  parseMonth,
  parseMoney,
  parseSlots,
  parseTime,
  parseWeekdays,
  str,
} from './cells';
import { EXAMPLE_ID, type Field, META_HEADERS, refIdHeader, type SheetDef, SHEETS } from './sheets';

/**
 * 엑셀 동기화 (I-12~I-19, 구현계획서 3.8). ExcelJS 와 무관한 표(Table) 단위 로직.
 * 내보내기: 데이터 → 표 / 가져오기: 표 → 비교 계획(신규·수정·충돌·중복 후보·오류·파일에 없음) → 저장 작업.
 */

export interface Table {
  name: string;
  headers: string[];
  /** 머리글 제외. 엑셀 행 번호 = index + 2 */
  rows: Cell[][];
}

export type Data = Partial<Record<Collection, StoredDoc[]>>;

// ───────────── 경로 · 표시 ─────────────

const getPath = (o: Record<string, unknown>, path: string): unknown =>
  path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), o);

function setPath(o: Record<string, unknown>, path: string, value: unknown) {
  const ks = path.split('.');
  let cur = o;
  for (const k of ks.slice(0, -1)) {
    if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[ks[ks.length - 1]] = value;
}

/** undefined·빈 객체 제거 */
function clean(v: unknown): unknown {
  if (Array.isArray(v) || v === null || typeof v !== 'object') return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    const c = clean(x);
    if (c === undefined) continue;
    if (c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length === 0) continue;
    out[k] = c;
  }
  return out;
}

const META_KEYS = ['id', 'version', 'createdAt', 'updatedAt', 'updatedBy', 'schemaVersion'];
const stripMeta = (d: Record<string, unknown>) => Object.fromEntries(Object.entries(d).filter(([k]) => !META_KEYS.includes(k)));

type LabelOf = (col: Collection, id: unknown) => string;

/** 셀에 쓰는 값 */
function fmt(f: Field, v: unknown, L: LabelOf): Cell {
  if (f.kind === 'bool') return fmtBool(v as boolean);
  if (v == null || v === '') return '';
  switch (f.kind) {
    case 'money':
    case 'int':
      return Number(v);
    case 'enum':
      return f.labels?.[String(v)] ?? String(v);
    case 'members':
      return (v as string[]).map((id) => MEMBER_LABELS[id] ?? id).join(', ');
    case 'weekdays':
      return fmtWeekdays(v as never);
    case 'slots':
      return fmtSlots(v as never);
    case 'list':
      return (v as string[]).join(', ');
    case 'ref':
      return L(f.ref!, v);
    default:
      return String(v);
  }
}

/** 비교용 값 (참조는 이름이 아니라 id 로) */
const cmp = (f: Field, v: unknown, L: LabelOf) => (f.kind === 'ref' ? (v == null ? '' : String(v)) : String(fmt(f, v, L)));
/** 사람에게 보이는 값 */
const show = (f: Field, v: unknown, L: LabelOf) => String(fmt(f, v, L)) || '(빈칸)';

function parseCell(f: Field, c: Cell): Parsed<unknown> {
  switch (f.kind) {
    case 'text':
      return { ok: true, value: str(c) };
    case 'date':
      return parseDate(c);
    case 'month':
      return parseMonth(c);
    case 'time':
      return parseTime(c);
    case 'money':
      return parseMoney(c);
    case 'int':
      return parseInt0(c);
    case 'bool':
      return parseBool(c);
    case 'enum':
      return parseEnum(c, f.labels!, f.header);
    case 'members':
      return parseMembers(c, f.allowed!);
    case 'weekdays':
      return parseWeekdays(c);
    case 'slots':
      return parseSlots(c);
    case 'list':
      return { ok: true, value: parseList(c) };
    default:
      return { ok: false, error: '내부 오류' };
  }
}

// ───────────── 이름 등록부 (참조 열) ─────────────

class Registry {
  private labels = new Map<Collection, Map<string, string>>();
  L: LabelOf = (col, id) => this.labels.get(col)?.get(String(id ?? '')) ?? '';
  set(col: Collection, id: string, label: string) {
    if (!this.labels.has(col)) this.labels.set(col, new Map());
    this.labels.get(col)!.set(id, label);
  }
  has = (col: Collection, id: string) => !!this.labels.get(col)?.has(id);
  /** 이름으로 찾기 — 먼저 등록된 것(앱의 기존 항목) 우선 */
  find(col: Collection, label: string): string | undefined {
    const norm = (x: string) => x.replace(/\s+/g, '');
    for (const [id, l] of this.labels.get(col) ?? []) if (norm(l) === norm(label)) return id;
    return undefined;
  }
  static of(data: Data) {
    const r = new Registry();
    for (const sh of SHEETS) for (const d of data[sh.col] ?? []) r.set(sh.col, d.id, sh.label(d, r.L));
    return r;
  }
}

// ───────────── 내보내기 ─────────────

export const sheetsFor = (parent: boolean) => SHEETS.filter((s) => parent || !s.parentOnly);

export function headersOf(sh: SheetDef): string[] {
  return [
    ...sh.fields.map((f) => f.header),
    ...sh.fields.filter((f) => f.kind === 'ref').map(refIdHeader),
    META_HEADERS.id,
    META_HEADERS.version,
    META_HEADERS.updatedAt,
  ];
}

export function exportTables(data: Data, opts: { parent: boolean; template?: boolean }): Table[] {
  const reg = Registry.of(data);
  return sheetsFor(opts.parent).map((sh) => {
    const headers = headersOf(sh);
    if (opts.template) {
      const ex = sh.example;
      const rows: Cell[][] = Object.keys(ex).length ? [headers.map((h) => (h === META_HEADERS.id ? EXAMPLE_ID : (ex[h] ?? '')))] : [];
      return { name: sh.name, headers, rows };
    }
    const docs = (data[sh.col] ?? [])
      .filter((d) => !sh.skipExport?.(d))
      .map((d) => ({ d, label: sh.label(d, reg.L) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ko'));
    const rows = docs.map(({ d }) => [
      ...sh.fields.map((f) => fmt(f, getPath(d, f.key), reg.L)),
      ...sh.fields.filter((f) => f.kind === 'ref').map((f) => String(getPath(d, f.key) ?? '')),
      d.id,
      d.version,
      d.updatedAt,
    ]);
    return { name: sh.name, headers, rows };
  });
}

/** 드롭다운 목록 (참조 시트별 이름) */
export function refOptions(data: Data): Partial<Record<Collection, string[]>> {
  const reg = Registry.of(data);
  const out: Partial<Record<Collection, string[]>> = {};
  for (const sh of SHEETS) {
    out[sh.col] = (data[sh.col] ?? [])
      .filter((d) => !sh.skipExport?.(d))
      .map((d) => reg.L(sh.col, d.id))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'ko'));
  }
  return out;
}

// ───────────── 가져오기 계획 ─────────────

export type ItemStatus = 'new' | 'update' | 'same' | 'conflict' | 'dup' | 'error';

export interface Change {
  field: string;
  from: string;
  to: string;
}

export interface PlanItem {
  /** 선택 상태 키 */
  key: string;
  sheet: string;
  col: Collection;
  rowNo: number;
  status: ItemStatus;
  id: string;
  label: string;
  /** 파일 값 (보이는 열만) */
  rec: Record<string, unknown>;
  current?: StoredDoc;
  changes: Change[];
  warnings: string[];
  errors: string[];
  refs: { col: Collection; id: string }[];
  /** 중복 후보의 기존 항목 */
  dupOf?: { id: string; label: string };
}

export interface MissingItem {
  key: string;
  sheet: string;
  col: Collection;
  id: string;
  label: string;
  current: StoredDoc;
}

export interface Plan {
  items: PlanItem[];
  missing: MissingItem[];
  /** 알 수 없는 시트·열 (무시함) */
  ignored: string[];
}

/** detectMissing: 앱에서 내보낸 동기화 파일일 때만 '파일에 없음' 을 찾는다 (빈 양식·다른 엑셀은 일부만 담기 때문) */
export function planImport(tables: Table[], data: Data, opts: { parent: boolean; newId: () => string; detectMissing?: boolean }): Plan {
  const reg = Registry.of(data);
  const items: PlanItem[] = [];
  const missing: MissingItem[] = [];
  const ignored: string[] = [];
  const errorIds = new Set<string>();
  const fileRec = new Map<string, Record<string, unknown>>();
  const sheets = sheetsFor(opts.parent);
  const known = new Set([...sheets.map((s) => s.name), '정보', '목록']);
  for (const t of tables) if (!known.has(t.name)) ignored.push(`시트 '${t.name}'`);

  for (const sh of sheets) {
    const t = tables.find((x) => x.name === sh.name);
    if (!t) continue;
    const col = (h: string) => t.headers.findIndex((x) => str(x) === h);
    const idCol = col(META_HEADERS.id);
    const verCol = col(META_HEADERS.version);
    const present = sh.fields.filter((f) => !f.readonly && col(f.header) >= 0);
    const allHeaders = new Set(headersOf(sh));
    for (const h of t.headers) if (str(h) && !allHeaders.has(str(h))) ignored.push(`${sh.name} 열 '${str(h)}'`);
    const missingRequired = sh.fields.filter((f) => f.required && col(f.header) < 0).map((f) => f.header);
    const current = new Map((data[sh.col] ?? []).map((d) => [d.id, d]));
    const byNatural = new Map<string, StoredDoc>();
    if (sh.naturalKey) for (const d of current.values()) if (!sh.skipExport?.(d)) byNatural.set(sh.naturalKey(d), d);
    const seen = new Set<string>();

    t.rows.forEach((row, i) => {
      const rowNo = i + 2;
      const cell = (c: number): Cell => (c >= 0 ? row[c] : undefined);
      if (row.every((c) => str(c) === '')) return;
      const idCell = str(cell(idCol));
      if (idCell === EXAMPLE_ID) return;
      const fileVersion = verCol >= 0 && str(cell(verCol)) ? Number(cell(verCol)) : undefined;
      const errors: string[] = missingRequired.map((h) => `'${h}' 열이 없습니다`);
      const warnings: string[] = [];
      const refs: { col: Collection; id: string }[] = [];
      const rec: Record<string, unknown> = {};
      const isNew = !idCell || !current.has(idCell);

      for (const f of present) {
        const c = cell(col(f.header));
        if (f.kind === 'ref') {
          const name = str(c);
          const hidden = str(cell(col(refIdHeader(f))));
          let id: string | undefined;
          if (!name) id = undefined;
          else if (hidden && reg.L(f.ref!, hidden).replace(/\s+/g, '') === name.replace(/\s+/g, '')) id = hidden;
          else id = reg.find(f.ref!, name) ?? (hidden && reg.has(f.ref!, hidden) ? hidden : undefined);
          if (name && !id) errors.push(`${f.header} '${name}' 을(를) 찾을 수 없습니다`);
          else if (!name && f.required) errors.push(`${f.header} 비어 있음`);
          else if (id) {
            if (errorIds.has(id)) errors.push(`${f.header} '${name}' 행에 오류가 있어 함께 제외`);
            refs.push({ col: f.ref!, id });
          }
          setPath(rec, f.key, id);
          continue;
        }
        if (str(c) === '' && f.kind !== 'bool') {
          if (f.default !== undefined && isNew) setPath(rec, f.key, f.default);
          else if (f.required) errors.push(`${f.header} 비어 있음`);
          else setPath(rec, f.key, undefined);
          continue;
        }
        if (f.kind === 'bool' && str(c) === '' && f.default !== undefined && isNew) {
          setPath(rec, f.key, f.default);
          continue;
        }
        const p = parseCell(f, c);
        if (!p.ok) errors.push(`${f.header}: ${p.error}`);
        else {
          setPath(rec, f.key, p.value);
          if (p.warn) warnings.push(`${f.header} ${p.warn}`);
        }
      }

      // 문서 id · 상태
      let id = idCell;
      let cur = idCell ? current.get(idCell) : undefined;
      let status: ItemStatus = 'new';
      let dupOf: PlanItem['dupOf'];
      if (sh.idFrom && errors.length === 0) {
        const want = sh.idFrom(rec);
        if (idCell && idCell !== want) warnings.push('대상이 바뀌어 새 항목으로 처리');
        id = want;
        cur = current.get(want);
        if (cur && !(idCell === want)) {
          status = 'dup';
          dupOf = { id: want, label: reg.L(sh.col, want) };
        }
      } else if (idCell && !cur) {
        warnings.push('앱에서 지워진 항목 — 다시 만듭니다');
      } else if (!idCell) {
        const dup = sh.naturalKey ? byNatural.get(sh.naturalKey({ ...rec })) : undefined;
        id = opts.newId();
        if (dup) {
          status = 'dup';
          dupOf = { id: dup.id, label: reg.L(sh.col, dup.id) };
        }
      }
      if (seen.has(id) && errors.length === 0) errors.push('같은 항목이 파일에 두 번 있습니다');
      seen.add(id);

      // 비교
      const base = cur && status !== 'dup' ? cur : undefined;
      const merged = { ...(cur ? stripMeta(cur) : {}) } as Record<string, unknown>;
      for (const f of present) setPath(merged, f.key, getPath(rec, f.key));
      const derived = sh.derive?.(merged, (c, x) => fileRec.get(`${c}:${x}`) ?? (data[c] ?? []).find((d) => d.id === x)) ?? {};
      Object.assign(merged, derived);
      const changes: Change[] = [];
      if (cur) {
        for (const f of present) {
          const a = getPath(cur, f.key);
          const b = getPath(merged, f.key);
          if (cmp(f, a, reg.L) !== cmp(f, b, reg.L)) changes.push({ field: f.header, from: show(f, a, reg.L), to: show(f, b, reg.L) });
        }
      }
      if (errors.length) status = 'error';
      else if (base) {
        if (changes.length === 0) status = 'same';
        else if (fileVersion === base.version) status = 'update';
        else status = 'conflict';
      }
      if (status === 'error') errorIds.add(id);
      else {
        fileRec.set(`${sh.col}:${id}`, merged);
        reg.set(sh.col, id, sh.label(merged, reg.L));
      }
      items.push({
        key: `${sh.col}:${id || `row${rowNo}`}`,
        sheet: sh.name,
        col: sh.col,
        rowNo,
        status,
        id,
        label: sh.label(merged, reg.L) || `${rowNo}행`,
        rec: { ...stripMeta(merged), ...derived },
        current: cur,
        changes,
        warnings,
        errors,
        refs,
        dupOf,
      });
    });

    if (opts.detectMissing === false) continue;
    for (const d of current.values()) {
      if (seen.has(d.id) || sh.skipExport?.(d)) continue;
      missing.push({ key: `missing:${sh.col}:${d.id}`, sheet: sh.name, col: sh.col, id: d.id, label: reg.L(sh.col, d.id), current: d });
    }
  }
  return { items, missing, ignored };
}

/** 기본 선택: 신규·수정은 반영, 충돌은 앱 값 유지, 중복 후보는 건너뜀, 파일에 없음은 지우지 않음 */
export function defaultChoices(plan: Plan): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const it of plan.items) out[it.key] = it.status === 'new' || it.status === 'update';
  for (const m of plan.missing) out[m.key] = false;
  return out;
}

export interface BuildResult {
  ops: Op[];
  /** 선택했지만 참조 대상을 가져오지 않아 뺀 항목 */
  dropped: { item: PlanItem; reason: string }[];
  counts: { create: number; update: number; remove: number };
}

export function buildImportOps(plan: Plan, choices: Record<string, boolean>, data: Data, ctx: { by: string; now: string; newId: () => string }): BuildResult {
  const sheetOf = (col: Collection) => SHEETS.find((s) => s.col === col)!;
  let active = plan.items.filter((it) => choices[it.key] && it.status !== 'same' && it.status !== 'error');
  const existing = (c: Collection, id: string) => (data[c] ?? []).some((d) => d.id === id);
  const dropped: BuildResult['dropped'] = [];
  // 참조 대상이 앱에도 없고 이번에 만들지도 않으면 제외 (반복)
  for (;;) {
    const created = new Set(active.filter((it) => !it.current || it.status === 'dup').map((it) => `${it.col}:${it.id}`));
    const bad = active.filter((it) => it.refs.some((r) => !existing(r.col, r.id) && !created.has(`${r.col}:${r.id}`)));
    if (bad.length === 0) break;
    for (const it of bad) dropped.push({ item: it, reason: '참조한 항목을 가져오지 않아 제외' });
    active = active.filter((it) => !bad.includes(it));
  }

  const ops: Op[] = [];
  const counts = { create: 0, update: 0, remove: 0 };
  const voided = { by: ctx.by, at: ctx.now, reason: '엑셀에서 수정' };
  for (const it of active) {
    const sh = sheetOf(it.col);
    const fresh = () => clean({ ...(sh.onCreate?.(ctx) ?? {}), ...it.rec }) as Record<string, unknown>;
    const cur = it.current;
    if (!cur || (it.status === 'dup' && cur.id !== it.id)) {
      ops.push({ type: 'create', col: it.col, id: it.id, data: fresh() });
      counts.create++;
    } else if (sh.immutable) {
      ops.push({ type: 'update', col: it.col, id: cur.id, patch: { voided }, expectVersion: cur.version });
      ops.push({ type: 'create', col: it.col, id: ctx.newId(), data: fresh() });
      counts.update++;
    } else {
      const patch: Record<string, unknown> = {};
      for (const f of sh.fields) {
        if (f.readonly) continue;
        const top = f.key.split('.')[0];
        const v = clean(it.rec[top]);
        if (JSON.stringify(v ?? null) !== JSON.stringify(clean(cur[top]) ?? null)) patch[top] = v ?? null;
      }
      if (Object.keys(patch).length === 0) continue;
      ops.push({ type: 'update', col: it.col, id: cur.id, patch, expectVersion: cur.version });
      counts.update++;
    }
  }
  for (const m of plan.missing) {
    if (!choices[m.key]) continue;
    if (sheetOf(m.col).immutable) ops.push({ type: 'update', col: m.col, id: m.id, patch: { voided: { ...voided, reason: '엑셀에서 삭제' } }, expectVersion: m.current.version });
    else ops.push({ type: 'delete', col: m.col, id: m.id, expectVersion: m.current.version });
    counts.remove++;
  }
  return { ops, dropped, counts };
}
