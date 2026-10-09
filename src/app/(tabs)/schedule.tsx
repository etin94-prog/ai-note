import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, FAB, IconButton, SegmentedButtons, Text } from 'react-native-paper';

import { MemberFilter } from '@/components/MemberChips';
import { OccurrenceRow } from '@/components/OccurrenceRow';
import { Screen } from '@/components/Screen';
import { addDays, formatDate, mondayOf, today } from '@/domain/dates';
import { findConflicts, visibleFor } from '@/domain/schedule';
import type { MemberId } from '@/domain/types';
import { useRepository } from '@/state/RepositoryContext';
import { useOccurrences } from '@/state/useCollection';

/** 일정: 오늘(하루) / 주간, 사람 필터 (S-V1, S-V2, S-V4) */
export default function ScheduleScreen() {
  const { repo } = useRepository();
  const [view, setView] = useState<'day' | 'week'>('day');
  const [day, setDay] = useState(today());
  const [member, setMember] = useState<MemberId | 'all'>('all');

  const monday = mondayOf(day);
  const from = view === 'day' ? day : monday;
  const to = view === 'day' ? day : addDays(monday, 6);
  const { occurrences, loaded } = useOccurrences(from, to);
  const shown = useMemo(() => visibleFor(occurrences, member), [occurrences, member]);
  const conflicts = useMemo(() => findConflicts(occurrences), [occurrences]);

  const step = view === 'day' ? 1 : 7;
  const days = view === 'day' ? [day] : Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  return (
    <View style={styles.fill}>
      <Screen>
        <SegmentedButtons
          value={view}
          onValueChange={(v) => setView(v as 'day' | 'week')}
          buttons={[
            { value: 'day', label: '하루', icon: 'calendar-today' },
            { value: 'week', label: '주간', icon: 'calendar-week' },
          ]}
        />
        <View style={styles.nav}>
          <IconButton icon="chevron-left" onPress={() => setDay(addDays(day, -step))} />
          <Button compact onPress={() => setDay(today())}>
            {view === 'day' ? formatDate(day) : `${formatDate(monday)} ~ ${formatDate(addDays(monday, 6))}`}
          </Button>
          <IconButton icon="chevron-right" onPress={() => setDay(addDays(day, step))} />
        </View>
        <MemberFilter value={member} onChange={setMember} />

        {!repo && (
          <Card mode="outlined" style={styles.card}>
            <Card.Content>
              <Text>더보기 → 저장 모드 연결 후 사용할 수 있습니다.</Text>
            </Card.Content>
          </Card>
        )}

        {days.map((d) => {
          const list = shown.filter((o) => o.date === d);
          return (
            <Card key={d} mode="outlined" style={styles.card}>
              <Card.Title
                title={formatDate(d) + (d === today() ? ' · 오늘' : '')}
                titleVariant="titleSmall"
                titleStyle={d === today() ? styles.todayTitle : undefined}
              />
              {list.length === 0 ? (
                <Card.Content>
                  <Text style={styles.empty}>{loaded ? '일정 없음' : '불러오는 중…'}</Text>
                </Card.Content>
              ) : (
                list.map((o) => <OccurrenceRow key={o.key} occ={o} conflict={conflicts.has(o.key)} />)
              )}
            </Card>
          );
        })}
        <View style={{ height: 80 }} />
      </Screen>
      {repo && (
        <FAB
          icon="plus"
          label="일정"
          style={styles.fab}
          onPress={() => router.push({ pathname: '/event', params: { date: day } })}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  card: { marginBottom: 10 },
  todayTitle: { color: '#2563EB', fontWeight: '700' },
  empty: { opacity: 0.5 },
  fab: { position: 'absolute', right: 16, bottom: 16 },
});
