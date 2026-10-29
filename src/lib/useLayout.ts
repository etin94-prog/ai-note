import { useState } from 'react';
import { type LayoutChangeEvent, useWindowDimensions } from 'react-native';

import { DESKTOP_MIN, SIDEBAR_WIDTH, workspaceLayout } from './responsive';

/** PC 배치 기준 폭 (X-11, D-16) */
export const WIDE_MIN = DESKTOP_MIN;

/** 화면 폭에 따라 PC / 폰 배치. 창 크기를 바꾸면 즉시 다시 계산된다 (X-21). */
export function useLayout() {
  const { width, fontScale } = useWindowDimensions();
  const wide = width >= WIDE_MIN * Math.max(1, fontScale);
  return { wide, width, fontScale, tablet: width >= 768, gutter: width >= 768 ? 24 : 16 };
}

/** Measure the actual route area after navigation chrome, rather than guessing from the viewport. */
export function useWorkspaceLayout() {
  const { wide, width, fontScale } = useLayout();
  const [measured, setMeasured] = useState<{ viewport: number; width: number } | null>(null);
  const available = measured?.viewport === width ? measured.width : width - (wide ? SIDEBAR_WIDTH : 0);
  return {
    ...workspaceLayout(available, fontScale),
    onLayout: (event: LayoutChangeEvent) => {
      const next = event.nativeEvent.layout.width;
      setMeasured((old) => old?.width === next && old.viewport === width ? old : { viewport: width, width: next });
    },
  };
}
