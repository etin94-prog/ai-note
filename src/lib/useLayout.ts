import { useWindowDimensions } from 'react-native';

/** PC 배치 기준 폭 (X-11, D-16) */
export const WIDE_MIN = 1024;

/** 화면 폭에 따라 PC / 폰 배치. 창 크기를 바꾸면 즉시 다시 계산된다 (X-21). */
export function useLayout() {
  const { width } = useWindowDimensions();
  return { wide: width >= WIDE_MIN, width };
}
