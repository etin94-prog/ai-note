import { router, Stack } from 'expo-router';
import type { PropsWithChildren } from 'react';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Button, Card, Checkbox, HelperText, Text } from 'react-native-paper';
import { ulid } from 'ulid';

import { ChipSelect, TimeField } from '@/components/FormFields';
import { Screen } from '@/components/Screen';
import { goBack } from '@/lib/nav';
import { formatDate } from '@/domain/dates';
import { type EditScope, planTimeChange } from '@/domain/editScope';
import type { ExceptionStatus, OccurrenceException, ScheduleEvent } from '@/domain/types';
import { EVENT_KIND_LABELS, exceptionLabel, isClassKind, memberById } from '@/domain/types';
import { useRepository } from '@/state/RepositoryContext';
import { useOccurrences } from '@/state/useCollection';

const SCOPES: { value: EditScope; label: string }[] = [
  { value: 'this', label: '이번만' },
  { value: 'following', label: '이후 모두' },
  { value: 'all', label: '전체' },
];

/** 회차 상세: 휴강·결석·취소(S-04), 시간 변경 범위(S-03), 준비물(S-16), 지도(R-06) */
export function OccurrenceDetail({ occKey: key, embedded = false, onClose }: { occKey: string; embedded?: boolean; onClose?: () => void }) {
  const Wrap = embedded ? EmbeddedWrap : Screen;
  const date = key.split('@')[1]?.slice(0, 10) ?? '';
  const { occurrences, exceptions, events, loaded } = useOccurrences(date, date);
  const { repo, writeContext, readOnly } = useRepository();
  const occ = occurrences.find((o) => o.key === key);
  const ex = exceptions.find((e) => e.id === key);
  const source = occ?.source === 'event' ? events.find((e) => e.id === occ.sourceId) : undefined;
  const repeating = occ?.source === 'enrollment' || !!source?.repeatWeekdays?.length;
  const makeups = events.filter((e) => e.makeupFor === key);

  const [editTime, setEditTime] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [scope, setScope] = useState<EditScope>('this');
  const [error, setError] = useState<string | null>(null);
  // 회차 시각이 불러와지거나 바뀌면 입력칸에 채움 (null = 아직 한 번도 보지 않음)
  const occTime = occ ? `${occ.start}-${occ.end}` : undefined;
  const [prevOccTime, setPrevOccTime] = useState<string | undefined | null>(null);
  if (occTime !== prevOccTime) {
    setPrevOccTime(occTime);
    if (occ) {
      setStart(occ.start);
      setEnd(occ.end);
    }
  }

  async function saveException(patch: Partial<OccurrenceException>, label: string) {
    if (!repo || !occ) return;
    const ctx = writeContext(`${label}: ${occ.title} ${formatDate(occ.date)} ${occ.start}`);
    if (ex) await repo.update('exceptions', key, patch, ex.version, ctx);
    else await repo.create('exceptions', key, { occurrenceKey: key, ...patch }, ctx);
  }

  const setStatus = (s: ExceptionStatus | undefined) =>
    saveException({ status: s ?? null }, s && occ ? exceptionLabel(occ.kind, s) : '정상으로 되돌림');

  const toggleCheck = (item: string) => {
    const cur = occ?.checked ?? [];
    void saveException({ checked: cur.includes(item) ? cur.filter((c) => c !== item) : [...cur, item] }, '준비물 체크');
  };

  async function saveTime() {
    if (!repo || !occ) return;
    if (end <= start) return setError('끝나는 시각이 시작보다 늦어야 합니다.');
    setError(null);
    const label = `시간 변경(${SCOPES.find((s) => s.value === scope)?.label}): ${occ.title} ${formatDate(occ.date)}`;
    if (occ.source === 'enrollment' || scope === 'this') {
      // 원래 시각과 같게 저장하면 회차 계산에서 "바뀜" 표시가 자동으로 사라진다
      await saveException({ start, end }, label);
    } else if (source) {
      const ops = planTimeChange({
        scope,
        event: { id: source.id, version: source.version, data: source as unknown as ScheduleEvent },
        date: occ.date,
        start,
        end,
        exceptions: exceptions.map((e) => ({ id: e.id, version: e.version, data: e as unknown as OccurrenceException })),
        newId: ulid(),
      });
      const r = await repo.applyBatch(ops, writeContext(label));
      if (!r.ok) return setError('다른 기기에서 먼저 수정했습니다. 다시 열어 주세요.');
    }
    setEditTime(false);
    // "이후 모두/전체" 는 회차 키가 바뀔 수 있어 목록으로 돌아감
    if (occ.source === 'event' && scope !== 'this') {
      if (embedded) onClose?.();
      else goBack('/schedule');
    }
  }

  if (!occ) {
    return (
      <Wrap>
        {!embedded && <Stack.Screen options={{ title: '일정' }} />}
        <Text>{loaded ? '일정을 찾을 수 없습니다. (시간이 바뀌었거나 삭제됨)' : '불러오는 중…'}</Text>
      </Wrap>
    );
  }

  const who = occ.targets.map((t) => memberById(t)?.name).join(', ');
  const cls = isClassKind(occ.kind);
  return (
    <Wrap>
      {!embedded && <Stack.Screen options={{ title: occ.title }} />}
      <Card mode="outlined" style={styles.card}>
        <Card.Content>
          <Text variant="titleLarge">
            {occ.title}
            {occ.subtitle ? <Text style={styles.sub}> {occ.subtitle}</Text> : null}
          </Text>
          <Text variant="bodyLarge" style={styles.line}>
            {formatDate(occ.date)} {occ.start}~{occ.end}
            {occ.moved ? <Text style={styles.moved}> (원래 {occ.originalStart})</Text> : null}
          </Text>
          <Text style={styles.line}>
            {who} · {EVENT_KIND_LABELS[occ.kind]}
            {occ.status !== 'normal' ? ` · ${exceptionLabel(occ.kind, occ.status)}` : ''}
          </Text>
          {occ.place ? <Text style={styles.line}>📍 {occ.place}</Text> : null}
          {makeups.map((m) => (
            <Text key={m.id} style={styles.line}>
              ↪ 보강: {formatDate(m.date)} {m.start}~{m.end}
            </Text>
          ))}
        </Card.Content>
        {occ.place ? (
          <Card.Actions>
            <Button icon="map-marker" onPress={() => void Linking.openURL(`https://map.kakao.com/link/search/${encodeURIComponent(occ.place!)}`)}>
              카카오맵
            </Button>
            <Button onPress={() => void Linking.openURL(`https://map.naver.com/p/search/${encodeURIComponent(occ.place!)}`)}>
              네이버지도
            </Button>
          </Card.Actions>
        ) : null}
      </Card>

      {occ.checklist.length > 0 && (
        <Card mode="outlined" style={styles.card}>
          <Card.Title title={`준비물 ${occ.checked.length}/${occ.checklist.length}`} titleVariant="titleMedium" />
          {occ.checklist.map((item) => (
            <Checkbox.Item
              key={item}
              label={item}
              disabled={readOnly}
              status={occ.checked.includes(item) ? 'checked' : 'unchecked'}
              onPress={() => toggleCheck(item)}
            />
          ))}
        </Card>
      )}

      {!readOnly && (
        <Card mode="outlined" style={styles.card}>
          <Card.Title
            title="이 회차"
            titleVariant="titleMedium"
            subtitle={cls ? '학원비·환불에는 자동 반영되지 않습니다' : '이 날짜 일정만 바뀝니다'}
          />
          <Card.Actions style={styles.actions}>
            {occ.status === 'normal' ? (
              cls ? (
                <>
                  <Button mode="outlined" onPress={() => void setStatus('cancelled')}>
                    휴강
                  </Button>
                  <Button mode="outlined" onPress={() => void setStatus('absent')}>
                    결석
                  </Button>
                </>
              ) : (
                <Button mode="outlined" onPress={() => void setStatus('cancelled')}>
                  이번만 취소
                </Button>
              )
            ) : (
              <Button mode="contained-tonal" onPress={() => void setStatus(undefined)}>
                {exceptionLabel(occ.kind, occ.status)} 되돌리기
              </Button>
            )}
            {occ.status === 'cancelled' && cls && (
              <Button
                icon="calendar-plus"
                onPress={() =>
                  router.push({
                    pathname: '/event',
                    params: { date: occ.date, makeupFor: key, title: `${occ.title} 보강`, targets: occ.targets.join(',') },
                  })
                }>
                보강 추가
              </Button>
            )}
            {occ.status === 'normal' && !editTime && (
              <Button icon="clock-edit-outline" onPress={() => setEditTime(true)}>
                시간 변경
              </Button>
            )}
          </Card.Actions>
          {editTime && (
            <Card.Content>
              <View style={styles.row}>
                <TimeField label="시작" value={start} onChange={setStart} />
                <TimeField label="끝" value={end} onChange={setEnd} />
              </View>
              {occ.source === 'event' && repeating ? (
                <ChipSelect options={SCOPES} value={scope} onChange={setScope} />
              ) : occ.source === 'enrollment' ? (
                <HelperText type="info">이 날만 바뀝니다. 앞으로 계속 바뀌면 학원·수강 정보에서 시간을 고치세요.</HelperText>
              ) : null}
              {error && <HelperText type="error">{error}</HelperText>}
              <View style={styles.row}>
                <Button onPress={() => setEditTime(false)}>취소</Button>
                <Button mode="contained" onPress={() => void saveTime()}>
                  저장
                </Button>
              </View>
            </Card.Content>
          )}
        </Card>
      )}

      {!readOnly && (
        <View style={styles.footer}>
          {occ.source === 'event' ? (
            <Button icon="pencil" onPress={() => router.push({ pathname: '/event', params: { id: occ.sourceId } })}>
              일정 수정 (전체)
            </Button>
          ) : (
            <Button icon="school" onPress={() => router.push({ pathname: '/academy', params: { id: occ.academyId } })}>
              학원·수강 정보
            </Button>
          )}
        </View>
      )}
    </Wrap>
  );
}

function EmbeddedWrap({ children }: PropsWithChildren) {
  return <View>{children}</View>;
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  sub: { fontSize: 15, opacity: 0.7 },
  moved: { fontSize: 14, color: '#EA580C' },
  line: { marginTop: 4 },
  actions: { flexWrap: 'wrap', justifyContent: 'flex-start' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginVertical: 4 },
  footer: { alignItems: 'flex-start' },
});
