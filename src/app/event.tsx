import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Chip, HelperText, Switch, Text, TextInput } from 'react-native-paper';
import { ulid } from 'ulid';

import { ChipSelect, DateField, Label, TimeField, WeekdayChips } from '@/components/FormFields';
import { MemberMultiSelect } from '@/components/MemberChips';
import { MinutesEditor } from '@/components/MinutesEditor';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Screen } from '@/components/Screen';
import { goBack } from '@/lib/nav';
import type { StoredDoc } from '@/data/repository';
import { today, weekdayOf } from '@/domain/dates';
import { moveEventExceptions } from '@/domain/editScope';
import { EVENT_KIND_LABELS, type EventKind, type MemberId, type OccurrenceException, type Place, type ScheduleEvent, type Weekday } from '@/domain/types';
import { useRepository } from '@/state/RepositoryContext';
import { useCollection } from '@/state/useCollection';
import { useTrash } from '@/state/useTrash';

const KINDS = (Object.keys(EVENT_KIND_LABELS) as EventKind[]).filter((k) => k !== 'class');
const SCOPES = [
  { value: 'family' as const, label: '가족 전체' },
  { value: 'parents' as const, label: '부모끼리' },
  { value: 'self' as const, label: '나만' },
];

/** 일정 추가·수정 (S-01, S-07~S-09, S-16). 학원 수업은 수강 등록에서 자동 생성되므로 여기서는 그 외 일정. */
export default function EventScreen() {
  const params = useLocalSearchParams<{ id?: string; date?: string; makeupFor?: string; title?: string; targets?: string; start?: string; end?: string }>();
  const { repo, settings, writeContext } = useRepository();
  const [existing, setExisting] = useState<StoredDoc<ScheduleEvent> | null>(null);
  const me = (settings.memberId || 'mom') as MemberId;
  const places = useCollection<Place>('places');
  const exceptions = useCollection<OccurrenceException>('exceptions');
  const moveToTrash = useTrash();

  // 휴강 회차에서 [보강 추가]로 들어오면 종류·제목·대상 미리 채움 (S-04)
  const [kind, setKind] = useState<EventKind>(params.makeupFor ? 'makeup' : 'appointment');
  const [title, setTitle] = useState(params.title ?? '');
  const [targets, setTargets] = useState<MemberId[]>(
    params.targets ? (params.targets.split(',') as MemberId[]) : [],
  );
  const [date, setDate] = useState(params.date || today());
  // 보강은 원래 수업 시각으로 시작
  const [start, setStart] = useState(params.start || '16:00');
  const [end, setEnd] = useState(params.end || '17:00');
  const [repeat, setRepeat] = useState(false);
  const [repeatWeekdays, setRepeatWeekdays] = useState<Weekday[]>([]);
  const [repeatUntil, setRepeatUntil] = useState('');
  const [place, setPlace] = useState('');
  const [memo, setMemo] = useState('');
  const [checklist, setChecklist] = useState('');
  const [scope, setScope] = useState<'family' | 'parents' | 'self'>('family');
  const [customRem, setCustomRem] = useState(false);
  const [rem, setRem] = useState<number[]>([60]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repo || !params.id) return;
    void repo.get<ScheduleEvent>('events', params.id).then((e) => {
      if (!e) return;
      setExisting(e);
      setKind(e.kind);
      setTitle(e.title);
      setTargets(e.targets);
      setDate(e.date);
      setStart(e.start);
      setEnd(e.end);
      setRepeat(!!e.repeatWeekdays?.length);
      setRepeatWeekdays(e.repeatWeekdays ?? []);
      setRepeatUntil(e.repeatUntil ?? '');
      setPlace(e.place ?? '');
      setMemo(e.memo ?? '');
      setChecklist((e.checklist ?? []).join(', '));
      setScope(e.scope ?? 'family');
      setCustomRem(!!e.reminders?.length);
      if (e.reminders?.length) setRem(e.reminders);
    });
  }, [repo, params.id]);

  const parentOnly = targets.length > 0 && targets.every((t) => t === 'dad' || t === 'mom');

  async function save() {
    if (!repo) return;
    if (!title.trim()) return setError('제목을 입력해 주세요.');
    if (targets.length === 0) return setError('누구의 일정인지 골라 주세요.');
    if (end <= start) return setError('끝나는 시각이 시작보다 늦어야 합니다.');
    if (repeat && repeatWeekdays.length === 0) return setError('반복할 요일을 골라 주세요.');
    const data: ScheduleEvent = {
      kind,
      title: title.trim(),
      targets,
      date,
      start,
      end,
      repeatWeekdays: repeat ? repeatWeekdays : [],
      repeatUntil: repeat ? repeatUntil : '',
      place: place.trim(),
      memo: memo.trim(),
      checklist: checklist
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
      scope: parentOnly ? scope : 'family',
      reminders: customRem ? rem : [],
      createdBy: existing?.createdBy ?? me,
      ...(params.makeupFor || existing?.makeupFor ? { makeupFor: existing?.makeupFor ?? params.makeupFor } : {}),
    };
    const ctx = writeContext(`일정 ${existing ? '수정' : '추가'}: ${data.title} ${date}`);
    const mine = exceptions.docs.map((e) => ({ id: e.id, version: e.version, data: e as unknown as OccurrenceException }));
    const ok = existing
      ? (
          await repo.applyBatch(
            [
              { type: 'update', col: 'events', id: existing.id, patch: data as unknown as Record<string, unknown>, expectVersion: existing.version },
              // 시작 시각·날짜가 바뀌면 휴강·준비물 체크 등 회차 기록도 새 회차로 옮김
              ...moveEventExceptions({ id: existing.id, version: existing.version, data: existing }, data, mine),
            ],
            ctx,
          )
        ).ok
      : (await repo.create('events', ulid(), data as unknown as Record<string, unknown>, ctx)) === 'created';
    if (!ok) return setError('다른 기기에서 먼저 수정했습니다. 다시 열어 주세요.');
    goBack('/schedule');
  }

  async function remove() {
    if (!repo || !existing) return;
    // 일정과 그 회차 기록(휴강·준비물 체크)을 함께 휴지통으로 (30일 안에 되살릴 수 있음)
    const prefix = `event:${existing.id}@`;
    const ok = await moveToTrash(`일정: ${existing.title} ${existing.date}`, [
      { col: 'events', doc: existing as unknown as StoredDoc },
      ...exceptions.docs.filter((e) => e.id.startsWith(prefix)).map((e) => ({ col: 'exceptions' as const, doc: e as unknown as StoredDoc })),
    ]);
    if (!ok) return setError('다른 기기에서 먼저 수정했습니다. 다시 열어 주세요.');
    goBack('/schedule');
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: existing ? '일정 수정' : '일정 추가' }} />
      <Label>종류</Label>
      <ChipSelect options={KINDS.map((k) => ({ value: k, label: EVENT_KIND_LABELS[k] }))} value={kind} onChange={setKind} />
      <TextInput mode="outlined" label="제목 (예: 치과, 스터디, 학원 상담)" value={title} onChangeText={setTitle} />

      <Label>누구</Label>
      <MemberMultiSelect value={targets} onChange={setTargets} />

      <Label>언제</Label>
      <View style={styles.row}>
        <DateField
          label="날짜"
          value={date}
          onChange={(d) => {
            setDate(d);
            if (repeat && repeatWeekdays.length === 0 && d) setRepeatWeekdays([weekdayOf(d)]);
          }}
        />
      </View>
      <View style={styles.row}>
        <TimeField label="시작" value={start} onChange={setStart} />
        <TimeField label="끝" value={end} onChange={setEnd} />
      </View>
      <View style={styles.switchRow}>
        <Text>매주 반복</Text>
        <Switch
          value={repeat}
          onValueChange={(v) => {
            setRepeat(v);
            if (v && repeatWeekdays.length === 0) setRepeatWeekdays([weekdayOf(date)]);
          }}
        />
      </View>
      {repeat && (
        <>
          <WeekdayChips value={repeatWeekdays} onChange={setRepeatWeekdays} />
          <DateField label="반복 종료일 (비우면 계속)" value={repeatUntil} onChange={setRepeatUntil} />
        </>
      )}

      <Label>더 보기</Label>
      <TextInput mode="outlined" dense label="장소 (주소 또는 이름)" value={place} onChangeText={setPlace} style={styles.gap} />
      {places.docs.length > 0 && (
        <View style={styles.chips}>
          {places.docs
            .filter((p) => !(p as unknown as { spikeTest?: boolean }).spikeTest)
            .map((p) => (
              <Chip key={p.id} compact icon="map-marker-outline" onPress={() => setPlace(p.address || p.name)}>
                {p.name}
              </Chip>
            ))}
        </View>
      )}
      <TextInput
        mode="outlined"
        dense
        label="준비물 (쉼표로 구분, 예: 교재, 숙제장)"
        value={checklist}
        onChangeText={setChecklist}
        style={styles.gap}
      />
      <TextInput mode="outlined" dense label="메모" value={memo} onChangeText={setMemo} multiline style={styles.gap} />
      <View style={styles.remRow}>
        <Text variant="labelLarge">이 일정만 알림 따로</Text>
        <Switch value={customRem} onValueChange={setCustomRem} />
      </View>
      {customRem ? (
        <MinutesEditor value={rem} onChange={setRem} />
      ) : (
        <Text variant="bodySmall" style={styles.remHint}>
          끄면 각자 알림 설정(더보기 → 알림 설정)을 따릅니다.
        </Text>
      )}
      {parentOnly && (
        <>
          <Label>공개 범위 (부모 일정)</Label>
          <ChipSelect options={SCOPES} value={scope} onChange={setScope} />
        </>
      )}

      {error && <HelperText type="error">{error}</HelperText>}
      <Button mode="contained" onPress={save} style={styles.save}>
        저장
      </Button>
      {existing && (
        <ConfirmButton label="삭제" confirmText={existing.repeatWeekdays?.length ? '반복 일정 전체를 지울까요?' : '이 일정을 지울까요?'} onConfirm={remove} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  remRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  remHint: { opacity: 0.6 },
  row: { flexDirection: 'row', gap: 8, marginVertical: 4 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 8 },
  gap: { marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  save: { marginTop: 16, marginBottom: 8 },
});
