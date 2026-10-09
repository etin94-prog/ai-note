import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, FAB, IconButton, SegmentedButtons, Text } from 'react-native-paper';

import { MemberFilter } from '@/components/MemberChips';
import { OccurrenceDetail } from '@/components/OccurrenceDetail';
import { OccurrenceRow } from '@/components/OccurrenceRow';
import { Screen, SplitView } from '@/components/Screen';
import { TimeGrid } from '@/components/TimeGrid';
import { addDays, formatDate, mondayOf, today } from '@/domain/dates';
import { findConflicts, visibleFor } from '@/domain/schedule';
import { type MemberId, MEMBERS } from '@/domain/types';
import { useLayout } from '@/lib/useLayout';
import { useRepository } from '@/state/RepositoryContext';
import { useOccurrences } from '@/state/useCollection';

type View3 = 'day' | 'week' | 'grid';

/**
 * 일정: 하루 / 주간 목록 / 주간 시간표 격자, 사람 필터 (S-V1, S-V2, S-V4).
 * PC: 넓은 시간표 기본 + 누르면 오른쪽 상세 패널 (X-19).
 */
export default function ScheduleScreen() {
  const { repo, readOnly, isChild, settings } = useRepository();
  const { wide } = useLayout();
  const [view, setView] = useState<View3>(wide ? 'grid' : 'day');
  const [day, setDay] = useState(today());
  const [member, setMember] = useState<MemberId | 'all'>('all');
  const [selected, setSelected] = useState<string | null>(null);

  // 폰 → PC 로 넓어지면 시간표로 (X-21)
  useEffect(() => {
    if (wide && view === 'day') setView('grid');
  }, [wide]); // eslint-disable-line react-hooks/exhaustive-deps

  const monday = mondayOf(day);
  const from = view === 'day' ? day : monday;
  const to = view === 'day' ? day : addDays(monday, 6);
  const { occurrences, loaded } = useOccurrences(from, to);
  const who: MemberId | 'all' = isChild ? (settings.memberId as MemberId) : member;
  const shown = useMemo(() => visibleFor(occurrences, who), [occurrences, who]);
  const conflicts = useMemo(() => findConflicts(occurrences), [occurrences]);

  const step = view === 'day' ? 1 : 7;
  const days = view === 'day' ? [day] : Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const onSelect = wide ? setSelected : undefined;

  const body = (
    <>
      <View style={wide ? styles.toolbarWide : undefined}>
        <SegmentedButtons
          style={wide ? styles.segWide : undefined}
          value={view}
          onValueChange={(v) => setView(v as View3)}
          buttons={[
            { value: 'day', label: '하루', icon: 'calendar-today' },
            { value: 'week', label: '주간', icon: 'format-list-bulleted' },
            { value: 'grid', label: '시간표', icon: 'calendar-week' },
          ]}
        />
        <View style={styles.nav}>
          <IconButton icon="chevron-left" onPress={() => setDay(addDays(day, -step))} />
          <Button compact onPress={() => setDay(today())}>
            {view === 'day' ? formatDate(day) : `${formatDate(monday)} ~ ${formatDate(addDays(monday, 6))}`}
          </Button>
          <IconButton icon="chevron-right" onPress={() => setDay(addDays(day, step))} />
        </View>
        {!isChild && <MemberFilter value={member} onChange={setMember} members={MEMBERS} />}
      </View>

      {!repo && (
        <Card mode="outlined" style={styles.card}>
          <Card.Content>
            <Text>더보기 → 저장 모드 연결 후 사용할 수 있습니다.</Text>
          </Card.Content>
        </Card>
      )}

      {view === 'grid' ? (
        <Card mode="outlined" style={styles.card}>
          <Card.Content style={styles.gridPad}>
            <TimeGrid days={days} occurrences={shown} onSelect={onSelect} selectedKey={selected ?? undefined} hourHeight={wide ? 52 : 44} />
          </Card.Content>
        </Card>
      ) : (
        <View style={wide && view === 'week' ? styles.weekWide : undefined}>
          {days.map((d) => {
            const list = shown.filter((o) => o.date === d);
            return (
              <Card key={d} mode="outlined" style={[styles.card, wide && view === 'week' && styles.weekCard]}>
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
                  list.map((o) => (
                    <OccurrenceRow key={o.key} occ={o} conflict={conflicts.has(o.key)} onSelect={onSelect} selected={o.key === selected} />
                  ))
                )}
              </Card>
            );
          })}
        </View>
      )}
      <View style={{ height: 80 }} />
    </>
  );

  const fab = repo && !readOnly && (
    <FAB
      icon="plus"
      label="일정"
      style={[styles.fab, wide && styles.fabWide]}
      onPress={() => router.push({ pathname: '/event', params: { date: day } })}
    />
  );

  if (wide) {
    return (
      <View style={styles.fill}>
        <SplitView
          main={body}
          panel={
            selected ? (
              <OccurrenceDetail key={selected} occKey={selected} embedded onClose={() => setSelected(null)} />
            ) : (
              <Text style={styles.empty}>시간표나 목록에서 일정을 누르면 여기에서 휴강·결석·시간 변경·준비물을 처리할 수 있습니다.</Text>
            )
          }
        />
        {fab}
      </View>
    );
  }
  return (
    <View style={styles.fill}>
      <Screen>{body}</Screen>
      {fab}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  toolbarWide: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 8 },
  segWide: { width: 360 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  card: { marginBottom: 10 },
  weekWide: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  weekCard: { width: '32%', minWidth: 260 },
  gridPad: { paddingHorizontal: 4 },
  todayTitle: { color: '#2563EB', fontWeight: '700' },
  empty: { opacity: 0.5 },
  fab: { position: 'absolute', right: 16, bottom: 16 },
  // PC: 오른쪽 패널(460px) 왼쪽에
  fabWide: { right: 476 },
});
