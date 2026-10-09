import { Platform } from 'react-native';

import type { StorageMode } from '@/state/settings';

/** 브라우저에서 파일 고르기 (파일은 이 기기 안에서만 읽음, X-29·I-17) */
export function pickFiles(opts: { accept: string; multiple?: boolean }): Promise<File[]> {
  return new Promise((resolve) => {
    if (Platform.OS !== 'web') return resolve([]);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = opts.accept;
    input.multiple = !!opts.multiple;
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.click();
  });
}

/** 파일 저장 (브라우저 다운로드) */
export function downloadFile(data: BlobPart, filename: string, mime: string) {
  if (Platform.OS !== 'web') return;
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 파일 이름용 현지 시각 '2026-10-10_2130' */
export function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
export const localTime = (d = new Date()) => `${stamp(d).replace('_', ' ').slice(0, 13)}:${stamp(d).slice(-2)}`;

export const MODE_LABEL: Record<StorageMode, string> = { github: 'GitHub', firebase: 'Firebase', demo: '체험' };
