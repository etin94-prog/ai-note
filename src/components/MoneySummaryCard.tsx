import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';

import { today } from '@/domain/dates';
import { monthSummary, won } from '@/domain/money';
import { useMoney } from '@/state/useMoney';

/** 홈 이달 학원비 요약 (4.3, X-17) — 부모 전용 */
export function MoneySummaryCard() {
  const money = useMoney();
  const period = today().slice(0, 7);
  const s = useMemo(
    () => monthSummary(period, money.rows, money.payments, money.receipts, money.expenses),
    [period, money.rows, money.payments, money.receipts, money.expenses],
  );
  const items: [string, number, string?][] = [
    ['청구', s.billed],
    ['납부', s.paid, '#16A34A'],
    ['남은 금액', s.remaining, s.overdue ? '#DC2626' : undefined],
    ['연체', s.overdue, s.overdue ? '#DC2626' : undefined],
    ['환불 미수령', s.refundOpen, s.refundOpen ? '#7C3AED' : undefined],
    ['이달 실제 지출', s.cashOut],
  ];
  return (
    <Card mode="outlined" style={styles.card}>
      <Card.Title title={`${Number(period.slice(5))}월분 학원비`} titleVariant="titleMedium" />
      <Card.Content style={styles.grid}>
        {items.map(([label, v, color]) => (
          <View key={label} style={styles.cell}>
            <Text variant="labelSmall" style={styles.dim}>
              {label}
            </Text>
            <Text variant="titleMedium" style={{ fontWeight: '700', color }}>
              {won(v)}
            </Text>
          </View>
        ))}
      </Card.Content>
      <Card.Actions>
        <Button onPress={() => router.push('/expense')}>기타 지출</Button>
        <Button mode="contained-tonal" onPress={() => router.push('/cost')}>
          비용 보기
        </Button>
      </Card.Actions>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 },
  cell: { width: '50%' },
  dim: { opacity: 0.65 },
});
