import { StyleSheet, View } from 'react-native';
import { Chip } from 'react-native-paper';

import { MEMBERS, type MemberId, type MemberInfo } from '@/domain/types';

interface SingleProps {
  value: MemberId | 'all';
  onChange: (v: MemberId | 'all') => void;
  includeAll?: boolean;
  members?: MemberInfo[];
}

/** 사람 필터 칩 (S-V4) */
export function MemberFilter({ value, onChange, includeAll = true, members = MEMBERS }: SingleProps) {
  return (
    <View style={styles.row}>
      {includeAll && (
        <Chip compact selected={value === 'all'} showSelectedOverlay onPress={() => onChange('all')}>
          전체
        </Chip>
      )}
      {members.map((m) => (
        <Chip
          key={m.id}
          compact
          selected={value === m.id}
          showSelectedOverlay
          onPress={() => onChange(m.id)}
          style={value === m.id ? { backgroundColor: `${m.color}22` } : undefined}>
          {m.name}
        </Chip>
      ))}
    </View>
  );
}

interface MultiProps {
  value: MemberId[];
  onChange: (v: MemberId[]) => void;
  members?: MemberInfo[];
}

/** 여러 명 선택 칩 (일정 대상자 S-07) */
export function MemberMultiSelect({ value, onChange, members = MEMBERS }: MultiProps) {
  return (
    <View style={styles.row}>
      {members.map((m) => {
        const on = value.includes(m.id);
        return (
          <Chip
            key={m.id}
            selected={on}
            showSelectedOverlay
            onPress={() => onChange(on ? value.filter((v) => v !== m.id) : [...value, m.id])}
            style={on ? { backgroundColor: `${m.color}22` } : undefined}>
            {m.name}
          </Chip>
        );
      })}
    </View>
  );
}

/** 이름 앞 색 점 */
export function MemberDots({ ids }: { ids: MemberId[] }) {
  return (
    <View style={styles.dots}>
      {ids.map((id) => {
        const m = MEMBERS.find((x) => x.id === id);
        return m ? <View key={id} style={[styles.dot, { backgroundColor: m.color }]} /> : null;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 },
  dots: { flexDirection: 'row', gap: 3 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
