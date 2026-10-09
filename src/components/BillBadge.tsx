import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import type { BillStatus } from '@/domain/money';
import { STATUS_COLORS } from '@/lib/theme';

const ICON: Record<BillStatus, string> = {
  예정: '○',
  미납: '!',
  부분납부: '◐',
  납부완료: '✓',
  환불진행: '↺',
  환불완료: '↩',
  취소: '–',
};

/** 청구 상태 표시 — 색 + 기호 + 글자 (X-10) */
export function BillBadge({ status, extra }: { status: BillStatus; extra?: string }) {
  const color = STATUS_COLORS[status];
  return (
    <View style={[styles.badge, { borderColor: color, backgroundColor: `${color}14` }]}>
      <Text style={[styles.text, { color }]}>
        {ICON[status]} {status}
        {extra ? ` ${extra}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1, alignSelf: 'flex-start' },
  text: { fontSize: 12, fontWeight: '700' },
});
