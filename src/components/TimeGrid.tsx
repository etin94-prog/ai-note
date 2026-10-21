import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { today, weekdayOf } from '@/domain/dates';
import { layoutLanes } from '@/domain/layout';
import type { Occurrence } from '@/domain/schedule';
import { memberById, WEEKDAY_LABELS } from '@/domain/types';

const HOUR_H = 44;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

const pad = (n: number) => String(n).padStart(2, '0');

/** 주간 시간표 격자 (S-V2): 요일 × 시간, 사람별 색. onEmptyPress 가 있으면 빈 칸(30분 단위)을 눌러 추가 */
export function TimeGrid({
  days,
  occurrences,
  onSelect,
  onEmptyPress,
  selectedKey,
  hourHeight = HOUR_H,
}: {
  days: string[];
  occurrences: Occurrence[];
  onSelect?: (key: string) => void;
  /** 빈 칸을 누름: 날짜 'YYYY-MM-DD', 시각 'HH:mm' */
  onEmptyPress?: (date: string, time: string) => void;
  selectedKey?: string;
  hourHeight?: number;
}) {
  const starts = occurrences.map((o) => toMin(o.start));
  const ends = occurrences.map((o) => toMin(o.end));
  const fromH = Math.min(8, ...starts.map((m) => Math.floor(m / 60)));
  const toH = Math.max(24, ...ends.map((m) => Math.ceil(m / 60)));
  const hours = Array.from({ length: toH - fromH }, (_, i) => fromH + i);
  const t = today();

  return (
    <View>
      <View style={styles.headerRow}>
        <View style={styles.hourCol} />
        {days.map((d) => (
          <View key={d} style={styles.dayCol}>
            <Text style={[styles.dayLabel, d === t && styles.today]}>
              {WEEKDAY_LABELS[weekdayOf(d)]}
              {'\n'}
              {Number(d.slice(8))}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.body}>
        <View style={styles.hourCol}>
          {hours.map((h) => (
            <Text key={h} style={[styles.hourText, { height: hourHeight }]}>
              {h}
            </Text>
          ))}
        </View>
        {days.map((d) => (
          <View key={d} style={[styles.dayCol, styles.dayBody, { height: hours.length * hourHeight }, d === t && styles.todayBg]}>
            {hours.map((h, i) => (
              <View key={h} style={[styles.line, { top: i * hourHeight }]} />
            ))}
            {onEmptyPress &&
              hours.flatMap((h, i) =>
                [0, 30].map((m) => {
                  const time = `${pad(h)}:${pad(m)}`;
                  return (
                    <Pressable
                      key={time}
                      accessibilityRole="button"
                      accessibilityLabel={`${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일 ${time} 추가`}
                      onPress={() => onEmptyPress(d, time)}
                      style={(st) => [
                        styles.slot,
                        { top: i * hourHeight + (m ? hourHeight / 2 : 0), height: hourHeight / 2 },
                        (st as { hovered?: boolean }).hovered && styles.slotHover,
                      ]}
                    />
                  );
                }),
              )}
            {(() => {
              const dayOcc = occurrences.filter((o) => o.date === d);
              const lanes = layoutLanes(dayOcc);
              return dayOcc.map((o) => {
                const color = memberById(o.targets[0])?.color ?? '#6B7280';
                const top = ((toMin(o.start) - fromH * 60) / 60) * hourHeight;
                const height = Math.max(18, ((toMin(o.end) - toMin(o.start)) / 60) * hourHeight - 2);
                const { lane, lanes: n } = lanes.get(o.key) ?? { lane: 0, lanes: 1 };
                return (
                  <Pressable
                    key={o.key}
                    accessibilityRole="button"
                    accessibilityLabel={`${o.title} ${o.start}~${o.end}`}
                    onPress={() => (onSelect ? onSelect(o.key) : router.push({ pathname: '/occurrence', params: { key: o.key } }))}
                    style={[
                      styles.block,
                      {
                        top,
                        height,
                        left: `${(lane * 100) / n}%`,
                        width: `${100 / n}%`,
                        backgroundColor: `${color}26`,
                        borderLeftColor: color,
                      },
                      o.status !== 'normal' && styles.off,
                      o.key === selectedKey && styles.sel,
                    ]}>
                    <Text numberOfLines={height >= 50 ? 2 : 3} style={[styles.blockText, styles.blockTitle, o.status !== 'normal' && styles.strike]}>
                      {o.title}
                    </Text>
                    {height >= 50 && n === 1 && (
                      <Text numberOfLines={1} style={styles.blockTime}>
                        {o.start}~{o.end}
                      </Text>
                    )}
                  </Pressable>
                );
              });
            })()}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  blockTitle: { fontWeight: '600' },
  blockTime: { fontSize: 10, opacity: 0.7 },
  headerRow: { flexDirection: 'row', marginBottom: 4 },
  hourCol: { width: 22 },
  hourText: { height: HOUR_H, fontSize: 10, opacity: 0.6, textAlign: 'right', paddingRight: 3 },
  dayCol: { flex: 1, minWidth: 0 },
  dayLabel: { textAlign: 'center', fontSize: 12, lineHeight: 15 },
  today: { color: '#2563EB', fontWeight: '700' },
  body: { flexDirection: 'row' },
  dayBody: { position: 'relative', borderLeftWidth: StyleSheet.hairlineWidth, borderColor: '#D1D5DB' },
  todayBg: { backgroundColor: '#EFF6FF' },
  line: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: '#E5E7EB' },
  slot: { position: 'absolute', left: 0, right: 0 },
  slotHover: { backgroundColor: '#2563EB14' },
  block: { position: 'absolute', borderLeftWidth: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: '#FFFFFF', borderRadius: 3, paddingHorizontal: 2, overflow: 'hidden' },
  blockText: { fontSize: 10, lineHeight: 12 },
  off: { opacity: 0.45 },
  sel: { borderColor: '#2563EB', borderWidth: 2 },
  strike: { textDecorationLine: 'line-through' },
});
