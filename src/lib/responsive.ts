/** Widths are logical pixels. Font scaling reserves more room for readable content. */
export const DESKTOP_MIN = 1200;
export const SIDEBAR_WIDTH = 180;
export const DETAIL_WIDTH = 360;
export const TABLE_MIN = 940;

export function workspaceLayout(width: number, fontScale = 1) {
  const scale = Math.max(1, fontScale);
  return {
    canSplit: width >= (720 + DETAIL_WIDTH + 48) * scale,
    canTable: width >= (TABLE_MIN + 48) * scale,
  };
}
