import { MD3LightTheme } from 'react-native-paper';

import { THEME_COLOR } from './config';

export const theme = {
  ...MD3LightTheme,
  colors: { ...MD3LightTheme.colors, primary: THEME_COLOR },
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
