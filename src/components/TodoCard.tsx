import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { Card, List } from 'react-native-paper';

import { today } from '@/domain/dates';
import { todoItems, won } from '@/domain/money';
import { memberById, type MemberId } from '@/domain/types';
import { useEnsureBills, useMoney } from '@/state/useMoney';

/** 홈 상단 "처리 필요" (F-32, 4.3) — 부모 전용. 연체·임박·환불 잔액 */
export function TodoCard() {
  useEnsureBills();
  const money = useMoney();
  const items = useMemo(() => todoItems(money.rows, today()), [money.rows]);
  if (items.length === 0) return null;
  return (
    <Card mode="outlined" style={styles.card}>
      <Card.Title title={`⚠ 처리 필요 (${items.length})`} titleVariant="titleMedium" />
      {items.slice(0, 5).map((t) => (
        <List.Item
          key={`${t.kind}-${t.billId}`}
          style={styles.item}
          title={`${t.childId === 'common' ? '공통' : memberById(t.childId as MemberId)?.name} ${t.title} ${won(t.amount)}`}
          titleStyle={t.kind === 'overdue' ? styles.red : t.kind === 'refund' ? styles.purple : undefined}
          description={`${t.text} · 담당 ${memberById(t.payer)?.name}`}
          onPress={() => router.push({ pathname: '/bill', params: { id: t.billId } })}
          right={(p) => <List.Icon {...p} icon="chevron-right" />}
        />
      ))}
      {items.length > 5 && <Card.Actions><List.Item title={`외 ${items.length - 5}건 — 비용 탭에서 보기`} onPress={() => router.push('/cost')} /></Card.Actions>}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12, borderColor: '#F59E0B' },
  item: { paddingVertical: 0 },
  red: { color: '#DC2626', fontWeight: '700' },
  purple: { color: '#7C3AED', fontWeight: '700' },
});
