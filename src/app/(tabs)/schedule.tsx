import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, FAB, IconButton, SegmentedButtons, Snackbar, Text } from 'react-native-paper';

import { MemberFilter } from '@/components/MemberChips';
import { OccurrenceDetail } from '@/components/OccurrenceDetail';
import { OccurrenceRow } from '@/components/OccurrenceRow';
import { Screen, SplitView } from '@/components/Screen';
import { TimeGrid } from '@/components/TimeGrid';
import { addDays, formatDate, mondayOf, today } from '@/domain/dates';
import { findConflicts, visibleFor } from '@/domain/schedule';
import { memberById, type MemberId, MEMBERS } from '@/domain/types';
import { buildIcs } from '@/io/ics';
import { downloadFile } from '@/lib/files';
import { renderTimetable, shareOrSave } from '@/lib/timetableImage';
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
  const [prevWide, setPrevWide] = useState(wide);
  if (wide !== prevWide) {
    setPrevWide(wide);
    if (wide && view === 'day') setView('grid');
  }

  const monday = mondayOf(day);
  const from = view === 'day' ? day : monday;
  const to = view === 'day' ? day : addDays(monday, 6);
  const { occurrences, loaded } = useOccurrences(from, to);
  const week = useOccurrences(monday, addDays(monday, 6));
  const ahead = useOccurrences(today(), addDays(today(), 55));
  const [imgBusy, setImgBusy] = useState(false);
  const [snack, setSnack] = useState('');
  const who: MemberId | 'all' = isChild ? (settings.memberId as MemberId) : member;
  const shown = useMemo(() => visibleFor(occurrences, who), [occurrences, who]);
  const conflicts = useMemo(() => findConflicts(occurrences), [occurrences]);

  const step = view === 'day' ? 1 : 7;
  const days = view === 'day' ? [day] : Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const onSelect = wide ? setSelected : undefined;
  // PC 오른쪽 패널 기본 내용: 이번 주 지금 이후 일정
  const nowAt = `${today()}T${new Date().toTimeString().slice(0, 5)}`;
  const upcoming = useMemo(
    () => visibleFor(week.occurrences, who).filter((o) => o.status === 'normal' && o.endAt > nowAt).sort((a, b) => (a.startAt < b.startAt ? -1 : 1)),
    [week.occurrences, who, nowAt],
  );

  /** .ics 스냅샷 — 앞으로 8주, 지금 고른 사람 기준 */
  const saveIcs = () => {
    const name = who === 'all' ? '가족' : (memberById(who)?.name ?? '');
    const list = visibleFor(ahead.occurrences, who);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    downloadFile(buildIcs(list, { calName: `${name} 일정 (학원노트)`, stamp }), `일정_${name}_${today()}.ics`, 'text/calendar');
    setSnack(`앞으로 8주 일정 ${list.filter((o) => o.status === 'normal').length}건을 캘린더 파일로 저장했습니다`);
  };

  /** 주간 시간표 이미지 (S-V5) — 지금 고른 사람 기준 */
  const saveImage = async () => {
    setImgBusy(true);
    try {
      const name = who === 'all' ? '가족' : (memberById(who)?.name ?? '');
      const weekDays = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
      const blob = await renderTimetable({
        title: `${name} 주간 시간표`,
        subtitle: `${formatDate(monday)} ~ ${formatDate(addDays(monday, 6))}`,
        days: weekDays,
        occurrences: visibleFor(week.occurrences, who),
      });
      const r = await shareOrSave(blob, `시간표_${name}_${monday}.png`, `${name} 주간 시간표`);
      setSnack(r === 'shared' ? '공유했습니다' : '이미지를 저장했습니다');
    } catch (e) {
      setSnack(e instanceof Error ? e.message : String(e));
    } finally {
      setImgBusy(false);
    }
  };

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
          <IconButton icon="chevron-left" accessibilityLabel="이전" onPress={() => setDay(addDays(day, -step))} />
          <Button compact onPress={() => setDay(today())}>
            {view === 'day' ? formatDate(day) : `${formatDate(monday)} ~ ${formatDate(addDays(monday, 6))}`}
          </Button>
          <IconButton icon="chevron-right" accessibilityLabel="다음" onPress={() => setDay(addDays(day, step))} />
        </View>
        {!isChild && <MemberFilter value={member} onChange={setMember} members={MEMBERS} />}
        {repo && (
          <View style={styles.exportRow}>
            <Button compact icon="image-outline" loading={imgBusy} disabled={imgBusy} onPress={() => void saveImage()}>
              시간표 이미지
            </Button>
            <Button compact icon="calendar-export" onPress={saveIcs}>
              캘린더 파일
            </Button>
          </View>
        )}
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
                <Text variant="titleSmall" style={[styles.dayHead, d === today() && styles.todayTitle]}>
                  {formatDate(d) + (d === today() ? ' · 오늘' : '')}
                </Text>
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
              <View>
                <Text variant="titleSmall" style={styles.panelHead}>
                  이번 주 남은 일정 {upcoming.length}건
                </Text>
                {upcoming.slice(0, 12).map((o) => (
                  <OccurrenceRow key={o.key} occ={o} conflict={conflicts.has(o.key)} onSelect={onSelect} showDate />
                ))}
                <Text style={[styles.empty, styles.panelHint]}>
                  일정을 누르면 여기에서 휴강·결석·시간 변경·준비물을 처리할 수 있습니다.
                </Text>
              </View>
            )
          }
        />
        {fab}
        <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={3000}>
          {snack}
        </Snackbar>
      </View>
    );
  }
  return (
    <View style={styles.fill}>
      <Screen>{body}</Screen>
      {fab}
      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={3000}>
        {snack}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  toolbarWide: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 8 },
  segWide: { width: 360 },
  exportRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  card: { marginBottom: 10 },
  weekWide: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  weekCard: { width: '32%', minWidth: 260 },
  gridPad: { paddingHorizontal: 4 },
  todayTitle: { color: '#2563EB', fontWeight: '700' },
  panelHead: { marginBottom: 6, fontWeight: '700' },
  panelHint: { marginTop: 12 },
  dayHead: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, fontWeight: '600' },
  empty: { opacity: 0.5 },
  fab: { position: 'absolute', right: 16, bottom: 16 },
  // PC: 오른쪽 패널(460px) 왼쪽에
  fabWide: { right: 476 },
});
