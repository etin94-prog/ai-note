import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { today } from '@/domain/dates';
import { monthGrid } from '@/domain/insights';
import type { Occurrence } from '@/domain/schedule';
import { memberById } from '@/domain/types';
import { PALETTE } from '@/lib/theme';

const HEAD = ['월', '화', '수', '목', '금', '토', '일'];

/** 월간 달력 (S-V3): 날짜마다 일정 점(사람 색) 표시, 날짜를 누르면 아래에 그날 목록 */
export function MonthCalendar({
  period,
  occurrences,
  selected,
  onSelect,
}: {
  period: string;
  occurrences: Occurrence[];
  selected: string;
  onSelect: (date: string) => void;
}) {
  const weeks = monthGrid(period);
  const t = today();
  const byDate = new Map<string, Occurrence[]>();
  for (const o of occurrences) {
    if (o.status !== 'normal') continue;
    byDate.set(o.date, [...(byDate.get(o.date) ?? []), o]);
  }
  return (
    <View>
      <View style={styles.row}>
        {HEAD.map((h, i) => (
          <Text key={h} variant="labelSmall" style={[styles.head, i >= 5 && styles.weekend]}>
            {h}
          </Text>
        ))}
      </View>
      {weeks.map((w) => (
        <View key={w[0].date} style={styles.row}>
          {w.map((d, i) => {
            const list = byDate.get(d.date) ?? [];
            const colors = [...new Set(list.flatMap((o) => o.targets.map((m) => memberById(m)?.color ?? '#9CA3AF')))].slice(0, 4);
            const on = d.date === selected;
            return (
              <Pressable
                key={d.date}
                onPress={() => onSelect(d.date)}
                accessibilityRole="button"
                accessibilityLabel={`${Number(d.date.slice(5, 7))}월 ${Number(d.date.slice(8))}일 일정 ${list.length}건`}
                style={[styles.cell, on && styles.cellOn, !d.inMonth && styles.out]}>
                <View style={[styles.num, d.date === t && styles.todayNum]}>
                  <Text style={[styles.numText, i >= 5 && styles.weekend, d.date === t && styles.todayText]}>{Number(d.date.slice(8))}</Text>
                </View>
                <View style={styles.dots}>
                  {colors.map((c) => (
                    <View key={c} style={[styles.dot, { backgroundColor: c }]} />
                  ))}
                </View>
                {list.length > 0 && <Text style={styles.count}>{list.length}</Text>}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  head: { flex: 1, textAlign: 'center', color: PALETTE.sub, paddingVertical: 6, fontWeight: '600' },
  weekend: { color: '#DC2626' },
  cell: { flex: 1, minHeight: 58, alignItems: 'center', paddingVertical: 4, borderRadius: 10, gap: 2 },
  cellOn: { backgroundColor: PALETTE.tint },
  out: { opacity: 0.35 },
  num: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  todayNum: { backgroundColor: '#2563EB' },
  numText: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  todayText: { color: '#FFFFFF' },
  dots: { flexDirection: 'row', gap: 3, height: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  count: { fontSize: 10, color: PALETTE.sub },
});
