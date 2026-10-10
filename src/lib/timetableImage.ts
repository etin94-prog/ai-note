import { Platform } from 'react-native';

import { layoutLanes } from '@/domain/layout';
import type { Occurrence } from '@/domain/schedule';
import { memberById, WEEKDAY_LABELS } from '@/domain/types';

/**
 * 주간 시간표 이미지 (S-V5): 캔버스에 그려 PNG 로. 폰은 공유 시트(카톡 등), PC 는 파일 저장.
 * 휴강·결석 회차는 빼고, 바뀐 시간은 바뀐 대로 그린다.
 */

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const FONT = '"Pretendard","Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif';

/** 일정 범위에 맞춘 시간대 (최소 3시간, 기본 14~22시 근처) */
export function hourRange(occ: { start: string; end: string }[]): [number, number] {
  if (occ.length === 0) return [14, 22];
  const from = Math.min(...occ.map((o) => Math.floor(toMin(o.start) / 60)));
  const to = Math.max(...occ.map((o) => Math.ceil(toMin(o.end) / 60)));
  return [Math.max(0, Math.min(from, to - 3)), Math.min(24, Math.max(to, from + 3))];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 칸 너비에 맞게 글자 줄이기 */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

export async function renderTimetable(opts: { title: string; subtitle: string; days: string[]; occurrences: Occurrence[] }): Promise<Blob> {
  const occ = opts.occurrences.filter((o) => o.status === 'normal');
  const [fromH, toH] = hourRange(occ);
  const W = 1080;
  const left = 64;
  const top = 168;
  const colW = (W - left - 24) / 7;
  const hourH = Math.max(56, Math.min(84, 1100 / (toH - fromH)));
  const H = top + (toH - fromH) * hourH + 56;
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  // 배경·제목
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#111827';
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText(opts.title, left, 62);
  ctx.fillStyle = '#6B7280';
  ctx.font = `400 24px ${FONT}`;
  ctx.fillText(opts.subtitle, left, 100);

  // 요일 머리글
  opts.days.forEach((d, i) => {
    const x = left + i * colW;
    const weekend = i >= 5;
    ctx.fillStyle = weekend ? '#FEF2F2' : '#F3F4F6';
    roundRect(ctx, x + 3, 118, colW - 6, 40, 10);
    ctx.fill();
    ctx.fillStyle = weekend ? '#DC2626' : '#374151';
    ctx.font = `700 22px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(`${WEEKDAY_LABELS[new Date(`${d}T00:00`).getDay()]} ${Number(d.slice(8))}`, x + colW / 2, 146);
    ctx.textAlign = 'left';
  });

  // 시간 줄
  for (let h = fromH; h <= toH; h++) {
    const y = top + (h - fromH) * hourH;
    ctx.strokeStyle = '#E5E7EB';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(W - 24, y);
    ctx.stroke();
    if (h < toH) {
      ctx.fillStyle = '#9CA3AF';
      ctx.font = `500 18px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText(`${h}시`, left - 10, y + 20);
      ctx.textAlign = 'left';
    }
  }

  // 일정 칸
  opts.days.forEach((d, i) => {
    const dayOcc = occ.filter((o) => o.date === d);
    const lanes = layoutLanes(dayOcc);
    for (const o of dayOcc) {
      const ln = lanes.get(o.key) ?? { lane: 0, lanes: 1 };
      const w = (colW - 8) / ln.lanes;
      const x = left + i * colW + 4 + ln.lane * w;
      const y = top + ((toMin(o.start) - fromH * 60) / 60) * hourH + 2;
      const h = Math.max(30, ((toMin(o.end) - toMin(o.start)) / 60) * hourH - 4);
      const color = memberById(o.targets[0])?.color ?? '#6B7280';
      ctx.fillStyle = `${color}22`;
      roundRect(ctx, x, y, w - 4, h, 10);
      ctx.fill();
      ctx.fillStyle = color;
      roundRect(ctx, x, y, 6, h, 3);
      ctx.fill();
      ctx.fillStyle = '#111827';
      ctx.font = `700 19px ${FONT}`;
      const tw = w - 18;
      ctx.fillText(fit(ctx, o.title, tw), x + 12, y + 26);
      if (h >= 56) {
        ctx.fillStyle = '#4B5563';
        ctx.font = `400 16px ${FONT}`;
        ctx.fillText(fit(ctx, `${o.start}~${o.end}`, tw), x + 12, y + 48);
      }
      if (h >= 80 && o.place) ctx.fillText(fit(ctx, o.place, tw), x + 12, y + 68);
    }
  });

  ctx.fillStyle = '#9CA3AF';
  ctx.font = `400 16px ${FONT}`;
  ctx.fillText('우리집 학원 노트', left, H - 20);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지를 만들 수 없습니다'))), 'image/png'));
}

/** 공유 시트가 되면 공유, 아니면 파일 저장. 돌려주는 값: 'shared' | 'saved' */
export async function shareOrSave(blob: Blob, filename: string, title: string): Promise<'shared' | 'saved'> {
  if (Platform.OS === 'web') {
    const file = new File([blob], filename, { type: blob.type });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
      try {
        await nav.share({ files: [file], title });
        return 'shared';
      } catch (e) {
        if ((e as Error).name === 'AbortError') return 'shared';
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return 'saved';
}
