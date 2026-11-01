import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { addDays, formatDate, minutesBetween, today } from '@/domain/dates';
import { type Occurrence, visibleFor } from '@/domain/schedule';
import { EXAM_COLOR, isExamKind, memberById, type MemberId } from '@/domain/types';
import { useOccurrences } from '@/state/useCollection';

const DAYS_AHEAD = 30;

const dday = (date: string, from: string) => {
  const n = Math.round(minutesBetween(`${from}T00:00`, `${date}T00:00`) / 1440);
  return n === 0 ? 'D-DAY' : `D-${n}`;
};

/** 앞으로 30일 안의 시험 — D-day 와 함께 빨간 띠로. 없으면 아무것도 안 그림 */
export function UpcomingExams({ who = 'all', onSelect }: { who?: MemberId | 'all'; onSelect?: (key: string) => void }) {
  const d = today();
  const { occurrences } = useOccurrences(d, addDays(d, DAYS_AHEAD));
  const exams = useMemo(
    () => visibleFor(occurrences, who).filter((o: Occurrence) => isExamKind(o.kind) && o.status === 'normal'),
    [occurrences, who],
  );
  if (exams.length === 0) return null;
  return (
    <View style={styles.box} accessibilityRole="summary">
      <Text style={styles.head}>📝 다가오는 시험</Text>
      {exams.map((o) => (
        <Pressable
          key={o.key}
          accessibilityRole="button"
          onPress={() => (onSelect ? onSelect(o.key) : router.push({ pathname: '/occurrence', params: { key: o.key } }))}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
          <Text style={styles.dday}>{dday(o.date, d)}</Text>
          <Text style={styles.text}>
            {formatDate(o.date)} {o.targets.map((t) => memberById(t)?.name).join('·')} · <Text style={styles.title}>{o.title}</Text>
            {o.subtitle ? ` · ${o.subtitle}` : ''}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, borderLeftWidth: 4, borderLeftColor: EXAM_COLOR, borderRadius: 10, padding: 12, marginBottom: 12, gap: 6 },
  head: { fontSize: 15, fontWeight: '700', color: EXAM_COLOR },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 },
  dday: { minWidth: 56, textAlign: 'center', fontSize: 13, fontWeight: '800', color: '#FFFFFF', backgroundColor: EXAM_COLOR, borderRadius: 6, paddingVertical: 2, overflow: 'hidden', fontVariant: ['tabular-nums'] },
  text: { flex: 1, fontSize: 15, color: '#1F2937' },
  title: { fontWeight: '700', color: EXAM_COLOR },
});
