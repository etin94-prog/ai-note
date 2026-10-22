import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Checkbox, HelperText, Text, TextInput } from 'react-native-paper';
import { ulid } from 'ulid';

import { Label, TimeField } from '@/components/FormFields';
import { MemberMultiSelect } from '@/components/MemberChips';
import type { Op } from '@/data/repository';
import { formatDate } from '@/domain/dates';
import type { ScheduleNotice } from '@/domain/scheduleNotice';
import type { MemberId, ScheduleEvent } from '@/domain/types';
import { useBusy } from '@/lib/useBusy';
import { useRepository } from '@/state/RepositoryContext';
import { useCollection } from '@/state/useCollection';

/**
 * 카톡·문자 수업 일정 공지 → 미리보기 → 날짜마다 일정 1건 (학원 수업).
 * 공지 원문은 메모로 남겨 회차 상세에서 그대로 본다. 같은 제목·날짜 일정이 이미 있으면 건너뜀.
 */
export function ScheduleNoticeImport({ notice, onDone }: { notice: ScheduleNotice; onDone?: (msg: string, undo?: () => void) => void }) {
  const { repo, writeContext, settings } = useRepository();
  const events = useCollection<ScheduleEvent>('events');
  const [busy, run] = useBusy();
  const [title, setTitle] = useState(notice.title);
  const [targets, setTargets] = useState<MemberId[]>([]);
  const [start, setStart] = useState(notice.start);
  const [end, setEnd] = useState(notice.end);
  const [place, setPlace] = useState(notice.place ?? '');
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const exists = (date: string) => events.docs.some((e) => !e.repeatWeekdays?.length && e.date === date && e.title.trim() === title.trim());
  // 공지에 따로 적힌 날은 그 시간, 나머지는 (고친) 정규 시간
  const sessions = notice.sessions.map((s) => (s.special ? s : { ...s, start, end }));
  const chosen = sessions.filter((s) => !skip.has(s.date) && !exists(s.date));

  const save = () =>
    run(async () => {
      if (!repo) return;
      if (!title.trim()) return setError('제목을 입력해 주세요.');
      if (targets.length === 0) return setError('누구의 수업인지 골라 주세요.');
      if (end <= start) return setError('끝나는 시각이 시작보다 늦어야 합니다.');
      if (chosen.length === 0) return setError('추가할 날짜가 없습니다.');
      setError(null);
      const me = (settings.memberId || 'dad') as MemberId;
      const ops: Op[] = chosen.map((s) => {
        const ev: ScheduleEvent = {
          kind: 'class',
          title: title.trim(),
          targets,
          date: s.date,
          start: s.start,
          end: s.end,
          ...(place.trim() ? { place: place.trim() } : {}),
          memo: notice.memo,
          scope: 'family',
          createdBy: me,
        };
        return { type: 'create', col: 'events', id: ulid(), data: ev as unknown as Record<string, unknown> };
      });
      const r = await repo.applyBatch(ops, writeContext(`카톡 공지로 일정 ${ops.length}건: ${title.trim()}`));
      if (!r.ok) return setError('다른 기기에서 먼저 저장했습니다. 다시 해석해 주세요.');
      onDone?.(`일정 ${ops.length}건 추가했습니다 — ${title.trim()}`, () => void repo.revertBatch(r.batchId, writeContext('카톡 공지 일정 되돌리기')));
    });

  return (
    <Card mode="outlined" style={styles.card}>
      <Card.Title title={`수업 일정 공지 · ${notice.sessions.length}회`} subtitle={notice.academy} titleVariant="titleMedium" />
      <Card.Content style={styles.gap}>
        <TextInput mode="outlined" dense label="제목" value={title} onChangeText={setTitle} />
        <Label>누구</Label>
        <MemberMultiSelect value={targets} onChange={setTargets} />
        <Label>정규 시간 (공지에 따로 적힌 날은 그 시간)</Label>
        <View style={styles.row}>
          <TimeField label="시작" value={start} onChange={setStart} />
          <TimeField label="끝" value={end} after={start} onChange={setEnd} />
        </View>
        {notice.endGuessed && end === notice.end && <HelperText type="info">끝 시각은 공지에 없어 추정한 값입니다. 다르면 고쳐 주세요.</HelperText>}
        <TextInput mode="outlined" dense label="장소" value={place} onChangeText={setPlace} />
      </Card.Content>
      <View style={styles.list}>
        {sessions.map((s) => {
          const dup = exists(s.date);
          return (
            <Checkbox.Item
              key={s.date}
              position="leading"
              labelStyle={styles.left}
              disabled={dup}
              status={dup ? 'indeterminate' : skip.has(s.date) ? 'unchecked' : 'checked'}
              onPress={() =>
                setSkip((cur) => {
                  const next = new Set(cur);
                  if (next.has(s.date)) next.delete(s.date);
                  else next.add(s.date);
                  return next;
                })
              }
              label={`${formatDate(s.date)} ${s.start}~${s.end}${s.special ? ' · 공지에 따로 적힌 시간' : ''}${dup ? ' · 이미 있음' : ''}`}
            />
          );
        })}
      </View>
      <Card.Content style={styles.gap}>
        {notice.warnings
          .filter((w) => !w.includes('추정'))
          .map((w) => (
            <HelperText key={w} type="info">
              {w}
            </HelperText>
          ))}
        <Text variant="bodySmall" style={styles.dim}>
          공지 원문은 각 일정의 메모에 저장되어, 시간표에서 수업을 누르면 그대로 볼 수 있습니다.
        </Text>
        {error && <HelperText type="error">{error}</HelperText>}
      </Card.Content>
      <Card.Actions>
        <Button mode="contained" icon="calendar-plus" loading={busy} disabled={busy || chosen.length === 0} onPress={() => void save()}>
          일정 {chosen.length}건 추가
        </Button>
      </Card.Actions>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  gap: { gap: 6 },
  row: { flexDirection: 'row', gap: 8 },
  list: { paddingVertical: 4 },
  left: { textAlign: 'left' },
  dim: { opacity: 0.6 },
});
