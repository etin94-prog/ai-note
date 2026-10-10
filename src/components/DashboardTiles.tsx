import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { nowLocal, today } from '@/domain/dates';
import { monthSummary, todoItems, won } from '@/domain/money';
import type { Occurrence } from '@/domain/schedule';
import { NUM, PALETTE } from '@/lib/theme';
import { useLayout } from '@/lib/useLayout';
import { useNow } from '@/state/useCollection';
import { useMoney } from '@/state/useMoney';
import { useReminders } from '@/state/useReminders';

/** 강조색은 하나만 (Taste 점검): 경고만 빨강 */
const ACCENT = '#2563EB';

interface Tile {
  key: string;
  icon: string;
  label: string;
  value: string;
  sub?: string;
  color: string;
  to: string;
  alert?: boolean;
}

function TileView({ t, width }: { t: Tile; width: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t.label} ${t.value}${t.sub ? `, ${t.sub}` : ''}`}
      onPress={() => router.push(t.to as never)}
      style={(st) => [
        styles.tile,
        { width: width as `${number}%` },
        t.alert && styles.alert,
        (st as { hovered?: boolean }).hovered && styles.hovered,
        st.pressed && styles.pressed,
      ]}>
      <View style={[styles.iconWrap, { backgroundColor: `${t.color}1A` }]}>
        <Icon source={t.icon} size={20} color={t.color} />
      </View>
      <Text variant="labelMedium" style={styles.label} numberOfLines={1}>
        {t.label}
      </Text>
      <Text variant="headlineSmall" style={[styles.value, NUM, t.alert && { color: t.color }]} numberOfLines={1}>
        {t.value}
      </Text>
      {t.sub ? (
        <Text variant="bodySmall" style={styles.sub} numberOfLines={1}>
          {t.sub}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** 부모용 학원비 타일 (자녀 기기에서는 비용 데이터를 아예 부르지 않도록 분리) */
function useMoneyTiles(enabled: boolean): Tile[] {
  const money = useMoney();
  const t = today();
  return useMemo(() => {
    if (!enabled) return [];
    const period = t.slice(0, 7);
    const s = monthSummary(period, money.rows, money.payments, money.receipts, money.expenses);
    const todo = todoItems(money.rows, t);
    const overdue = todo.filter((x) => x.kind === 'overdue').length;
    return [
      {
        key: 'money',
        icon: 'cash-multiple',
        label: `${Number(period.slice(5))}월 남은 학원비`,
        value: won(s.remaining),
        sub: s.billed ? `청구 ${won(s.billed)} 중 ${Math.round((s.paid / Math.max(1, s.billed)) * 100)}% 냄` : '이번 달 청구 없음',
        color: ACCENT,
        to: '/cost',
      },
      {
        key: 'todo',
        icon: todo.length ? 'alert-circle-outline' : 'check-circle-outline',
        label: '처리 필요',
        value: `${todo.length}건`,
        sub: overdue ? `연체 ${overdue}건` : todo.length ? '기한 임박·환불 확인' : '모두 처리됨',
        color: overdue ? '#DC2626' : ACCENT,
        to: '/cost',
        alert: overdue > 0,
      },
    ];
  }, [enabled, money.rows, money.payments, money.receipts, money.expenses, t]);
}

/**
 * 홈 요약 타일 (디자인 점검 10-10): 한눈에 오늘 일정·다음 일정·남은 학원비·처리 필요·알림.
 * 폰 2열, PC 4열. 누르면 해당 화면으로.
 */
export function DashboardTiles({ occurrences, isChild }: { occurrences: Occurrence[]; isChild: boolean }) {
  const { wide } = useLayout();
  const now = nowLocal(useNow());
  const { unread } = useReminders();
  const moneyTiles = useMoneyTiles(!isChild);

  const live = occurrences.filter((o) => o.status === 'normal');
  const next = live.filter((o) => o.startAt > now).sort((a, b) => (a.startAt < b.startAt ? -1 : 1))[0];
  const left = live.filter((o) => o.endAt > now).length;

  const tiles: Tile[] = [
    {
      key: 'today',
      icon: 'calendar-today',
      label: '오늘 일정',
      value: `${live.length}건`,
      sub: live.length ? (left ? `남은 일정 ${left}건` : '오늘 일정 끝') : '일정 없음',
      color: ACCENT,
      to: '/schedule',
    },
    {
      key: 'next',
      icon: 'clock-outline',
      label: '다음 일정',
      value: next ? next.start : '—',
      sub: next ? next.title : '오늘 남은 일정 없음',
      color: ACCENT,
      to: '/schedule',
    },
    ...moneyTiles,
    ...(isChild || wide
      ? [
          {
            key: 'inbox',
            icon: unread.length ? 'bell-badge-outline' : 'bell-outline',
            label: '새 알림',
            value: `${unread.length}건`,
            sub: unread.length ? '눌러서 확인' : '새 알림 없음',
            color: ACCENT,
            to: '/inbox',
            alert: unread.length > 0,
          },
        ]
      : []),
  ];
  const cols = wide ? Math.min(tiles.length, 5) : 2;
  const width = `${100 / cols - 2}%`;
  return (
    <View style={styles.grid}>
      {tiles.map((t) => (
        <TileView key={t.key} t={t} width={width} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginBottom: 14 },
  tile: {
    backgroundColor: PALETTE.card,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: PALETTE.line,
    gap: 2,
    minHeight: 112,
    transitionProperty: 'transform, border-color, box-shadow',
    transitionDuration: '180ms',
  } as object,
  hovered: { borderColor: '#B9C7E6', transform: [{ translateY: -1 }], boxShadow: '0 6px 16px rgba(37, 99, 235, 0.10)' } as object,
  alert: { borderColor: '#FCA5A5', backgroundColor: '#FFF7F7' },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
  iconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  label: { color: PALETTE.sub, fontWeight: '500' },
  value: { fontWeight: '700', color: PALETTE.text, letterSpacing: -0.5 },
  sub: { color: PALETTE.sub },
});
