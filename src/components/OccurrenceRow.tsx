import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { List, Text } from 'react-native-paper';

import { formatDate } from '@/domain/dates';
import type { Occurrence } from '@/domain/schedule';
import { EVENT_KIND_LABELS, exceptionLabel, memberById } from '@/domain/types';

import { MemberDots } from './MemberChips';

interface Props {
  occ: Occurrence;
  conflict?: boolean;
  showDate?: boolean;
  /** PC: 화면 이동 대신 옆 패널에 열기 (X-19) */
  onSelect?: (key: string) => void;
  selected?: boolean;
}

/** 일정 한 줄. 누르면 회차 상세(휴강·결석·준비물·지도). 상태는 색+글자 (X-10) */
export function OccurrenceRow({ occ, conflict, onSelect, selected, showDate }: Props) {
  const off = occ.status !== 'normal';
  const who = occ.targets.map((t) => memberById(t)?.name).join('·');
  const done = occ.checklist.length ? ` · 준비물 ${occ.checked.length}/${occ.checklist.length}` : '';
  return (
    <List.Item
      accessibilityRole="button"
      onPress={() => (onSelect ? onSelect(occ.key) : router.push({ pathname: '/occurrence', params: { key: occ.key } }))}
      style={[styles.item, selected && styles.selected]}
      title={
        <Text style={[styles.title, off && styles.off]}>
          {occ.title}
          {occ.subtitle ? <Text style={styles.sub}> {occ.subtitle}</Text> : null}
        </Text>
      }
      description={`${showDate ? `${formatDate(occ.date)} · ` : ''}${who} · ${EVENT_KIND_LABELS[occ.kind]}${done}`}
      left={() => (
        <View style={styles.left}>
          <Text style={[styles.time, off && styles.off]}>{occ.start}</Text>
          <Text style={styles.end}>{occ.end}</Text>
        </View>
      )}
      right={() => (
        <View style={styles.right}>
          <MemberDots ids={occ.targets} />
          {off && <Text style={styles.badgeOff}>{exceptionLabel(occ.kind, occ.status as 'cancelled')}</Text>}
          {conflict && !off && <Text style={styles.badgeWarn}>겹침</Text>}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  item: { paddingVertical: 2 },
  selected: { backgroundColor: '#EFF6FF' },
  left: { width: 48, alignItems: 'center', justifyContent: 'center' },
  time: { fontWeight: '700', fontSize: 15 },
  end: { fontSize: 12, opacity: 0.6 },
  title: { fontSize: 16, fontWeight: '600' },
  sub: { fontSize: 13, fontWeight: '400', opacity: 0.7 },
  off: { textDecorationLine: 'line-through', opacity: 0.5 },
  right: { alignItems: 'flex-end', justifyContent: 'center', gap: 4 },
  badgeOff: { fontSize: 12, color: '#6B7280', fontWeight: '700' },
  badgeWarn: { fontSize: 12, color: '#DC2626', fontWeight: '700' },
});
