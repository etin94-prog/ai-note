import { MD3LightTheme } from 'react-native-paper';

import { THEME_COLOR } from './config';

/**
 * 화면 색 (디자인 점검 10-10): 연한 회청색 바탕 + 흰 카드 + 옅은 테두리.
 * 진한 회색 테두리 박스가 겹쳐 투박해 보이던 것을 정리.
 */
export const PALETTE = {
  bg: '#F4F6FA',
  card: '#FFFFFF',
  line: '#E3E7EF',
  lineStrong: '#CDD4E0',
  text: '#1F2937',
  sub: '#6B7280',
  tint: '#EEF3FF',
} as const;

export const theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: THEME_COLOR,
    primaryContainer: '#DCE7FF',
    secondaryContainer: '#E3EBFF',
    background: PALETTE.bg,
    surface: PALETTE.card,
    surfaceVariant: '#EEF1F6',
    outline: PALETTE.lineStrong,
    outlineVariant: PALETTE.line,
    onSurface: PALETTE.text,
    onSurfaceVariant: '#4B5563',
    elevation: { ...MD3LightTheme.colors.elevation, level0: 'transparent', level1: '#FFFFFF', level2: '#FFFFFF', level3: '#FFFFFF' },
  },
};

/** 가족 구성원 색상 (S-V2 사람별 색상) */
export const MEMBER_COLORS = {
  dad: '#2563EB',
  mom: '#DB2777',
  son: '#059669',
  daughter: '#D97706',
} as const;

/** 청구 상태 색상 (Requirement 4.2) — 항상 아이콘·글자와 함께 표시 (X-10) */
export const STATUS_COLORS = {
  예정: '#6B7280',
  미납: '#DC2626',
  부분납부: '#EA580C',
  납부완료: '#16A34A',
  환불진행: '#7C3AED',
  환불완료: '#2563EB',
  취소: '#9CA3AF',
} as const;
