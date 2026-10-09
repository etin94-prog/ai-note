import type { Collection } from '@/data/repository';

import type { Cell } from './cells';
import { type Field, META_HEADERS, NOT_IN_EXCEL, refIdHeader, SCHEMA, SHEETS } from './sheets';
import type { Table } from './sync';

/**
 * ExcelJS 로 .xlsx 만들기·읽기 (I-11, I-17). 무거운 라이브러리라 필요할 때만 불러온다.
 * 파일은 이 기기에서만 만들고 읽는다 — 서버·저장소로 보내지 않음.
 */

type ExcelJSModule = any;
async function loadExcelJS(): Promise<ExcelJSModule> {
  const mod = await import('exceljs');
  return (mod as { default?: unknown }).default ?? mod;
}

export const FILE_KIND = '우리집 학원 노트 동기화 파일';
const INFO = '정보';
const LISTS = '목록';

export interface FileInfo {
  kind?: string;
  exportedAt?: string;
  mode?: string;
  by?: string;
  schema?: number;
  /** '동기화' | '빈 양식' */
  purpose?: string;
}

const colName = (n: number) => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

export async function buildWorkbook(
  tables: Table[],
  info: { exportedAt: string; mode: string; by: string; template?: boolean },
  refOptions: Partial<Record<Collection, string[]>>,
): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = '우리집 학원 노트';

  // [정보] 시트
  const ws0 = wb.addWorksheet(INFO);
  ws0.columns = [{ width: 18 }, { width: 80 }];
  const infoRows: [string, string | number][] = [
    ['파일 종류', FILE_KIND],
    ['내보낸 시각', info.exportedAt],
    ['저장 모드', info.mode],
    ['내보낸 사람', info.by],
    ['형식 버전', SCHEMA],
    ['파일 용도', info.template ? '빈 양식' : '동기화'],
    ['', ''],
    ['사용법', info.template ? '각 시트의 예시 행을 참고해 아래에 입력한 뒤, 앱 [더보기 → 엑셀 동기화 → 가져오기]로 올리세요. 예시 행은 가져오지 않습니다.' : '고친 뒤 앱 [더보기 → 엑셀 동기화 → 가져오기]로 올리면 바뀐 행만 반영됩니다 (반영 전 미리보기).'],
    ['', '새 항목은 맨 아래 빈 줄에 쓰세요. 회색 숨김 열(ID·version·수정시각)은 지우거나 고치지 마세요.'],
    ['', '행을 지워도 앱에서 자동 삭제되지 않습니다 (가져올 때 "파일에 없음"에서 고를 수 있음).'],
    ['', '납부·수령·조정 기록을 고치면 원래 기록은 "정정"으로 남고 새 기록이 만들어집니다.'],
    ['엑셀에 없는 항목', NOT_IN_EXCEL.join(', ') + ' — 전체 백업(JSON)에만 들어갑니다.'],
  ];
  infoRows.forEach((r) => ws0.addRow(r));
  ws0.getColumn(1).font = { bold: true };
  ws0.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

  // [목록] 시트 (드롭다운 원본, 숨김)
  const wl = wb.addWorksheet(LISTS, { state: 'hidden' });
  let listCol = 0;
  const listRange = new Map<string, string>();
  const addList = (key: string, values: string[]) => {
    if (listRange.has(key) || values.length === 0) return;
    listCol++;
    const c = colName(listCol);
    wl.getCell(`${c}1`).value = key;
    values.forEach((v, i) => (wl.getCell(`${c}${i + 2}`).value = v));
    listRange.set(key, `'${LISTS}'!$${c}$2:$${c}$${values.length + 1}`);
  };
  const listFor = (f: Field): string | undefined => {
    if (f.kind === 'enum') {
      const key = `${f.header}:${Object.values(f.labels!).join('|')}`;
      addList(key, Object.values(f.labels!));
      return listRange.get(key);
    }
    if (f.kind === 'bool') {
      addList('예/아니오', ['예', '아니오']);
      return listRange.get('예/아니오');
    }
    if (f.kind === 'ref') {
      addList(`ref:${f.ref}`, refOptions[f.ref!] ?? []);
      return listRange.get(`ref:${f.ref}`);
    }
    return undefined;
  };

  for (const t of tables) {
    const sh = SHEETS.find((s) => s.name === t.name)!;
    const ws = wb.addWorksheet(t.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(t.headers);
    t.rows.forEach((r) => ws.addRow(r.map((c) => (c === undefined ? null : c))));
    const header = ws.getRow(1);
    header.font = { bold: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF9' } };
    const lastRow = Math.max(t.rows.length + 300, 300);
    t.headers.forEach((h, i) => {
      const column = ws.getColumn(i + 1);
      const f = sh.fields.find((x) => x.header === h);
      const hidden = !f && (Object.values(META_HEADERS) as string[]).concat(sh.fields.filter((x) => x.kind === 'ref').map(refIdHeader)).includes(h);
      column.width = f?.width ?? 14;
      if (hidden) {
        column.hidden = true;
        return;
      }
      if (!f) return;
      if (f.required) header.getCell(i + 1).font = { bold: true, color: { argb: 'FFB91C1C' } };
      if (f.note) header.getCell(i + 1).note = f.note;
      if (f.kind === 'money') column.numFmt = '#,##0';
      if (f.readonly) column.font = { color: { argb: 'FF888888' } };
      const range = listFor(f);
      if (range) {
        const c = colName(i + 1);
        ws.dataValidations.add(`${c}2:${c}${lastRow}`, {
          type: 'list',
          allowBlank: true,
          formulae: [range],
          // 새 학원 이름 등 목록에 없는 값도 쓸 수 있게 경고 없이
          showErrorMessage: false,
        });
      }
    });
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** ExcelJS 셀 값 → 단순 값 */
function plain(v: unknown): Cell {
  if (v == null) return null;
  if (v instanceof Date || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((x) => x.text).join('');
    if ('result' in o) return plain(o.result);
    if ('text' in o) return plain(o.text);
    if ('error' in o) return null;
  }
  return String(v);
}

export async function readWorkbook(buf: ArrayBuffer): Promise<{ tables: Table[]; info: FileInfo }> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const tables: Table[] = [];
  const info: FileInfo = {};
  wb.eachSheet((ws: any) => {
    if (ws.name === INFO) {
      ws.eachRow((row: any) => {
        const k = String(plain(row.getCell(1).value) ?? '');
        const v = plain(row.getCell(2).value);
        if (k === '파일 종류') info.kind = String(v);
        if (k === '내보낸 시각') info.exportedAt = String(v);
        if (k === '저장 모드') info.mode = String(v);
        if (k === '내보낸 사람') info.by = String(v);
        if (k === '형식 버전') info.schema = Number(v);
        if (k === '파일 용도') info.purpose = String(v);
      });
      return;
    }
    const headerRow = ws.getRow(1);
    const width = headerRow.cellCount;
    const headers: string[] = [];
    for (let c = 1; c <= width; c++) headers.push(String(plain(headerRow.getCell(c).value) ?? '').trim());
    const rows: Cell[][] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const vals: Cell[] = [];
      for (let c = 1; c <= width; c++) vals.push(plain(row.getCell(c).value));
      rows.push(vals);
    }
    tables.push({ name: ws.name, headers, rows });
  });
  return { tables, info };
}
