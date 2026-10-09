import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Linking, StyleSheet, View } from 'react-native';
import { Button, Card, Checkbox, Text } from 'react-native-paper';

import { Screen } from '@/components/Screen';
import { formatDate } from '@/domain/dates';
import type { ExceptionStatus, OccurrenceException } from '@/domain/types';
import { EVENT_KIND_LABELS, exceptionLabel, isClassKind, memberById } from '@/domain/types';
import { useRepository } from '@/state/RepositoryContext';
import { useOccurrences } from '@/state/useCollection';

/** 회차 상세: 휴강·결석 처리(S-04), 준비물 체크(S-16), 지도에서 보기(R-06) */
export default function OccurrenceScreen() {
  const { key = '' } = useLocalSearchParams<{ key: string }>();
  const date = key.split('@')[1]?.slice(0, 10) ?? '';
  const { occurrences, exceptions, loaded } = useOccurrences(date, date);
  const { repo, writeContext } = useRepository();
  const occ = occurrences.find((o) => o.key === key);
  const ex = exceptions.find((e) => e.id === key);

  async function saveException(patch: Partial<OccurrenceException>, label: string) {
    if (!repo || !occ) return;
    const ctx = writeContext(`${label}: ${occ.title} ${formatDate(occ.date)} ${occ.start}`);
    if (ex) await repo.update('exceptions', key, patch, ex.version, ctx);
    else await repo.create('exceptions', key, { occurrenceKey: key, ...patch }, ctx);
  }

  const setStatus = (s: ExceptionStatus | undefined) =>
    saveException(
      { status: s ?? null } as unknown as Partial<OccurrenceException>,
      s && occ ? exceptionLabel(occ.kind, s) : '정상으로 되돌림',
    );

  const toggleCheck = (item: string) => {
    const cur = occ?.checked ?? [];
    void saveException({ checked: cur.includes(item) ? cur.filter((c) => c !== item) : [...cur, item] }, `준비물 체크`);
  };

  if (!occ) {
    return (
      <Screen>
        <Stack.Screen options={{ title: '일정' }} />
        <Text>{loaded ? '일정을 찾을 수 없습니다.' : '불러오는 중…'}</Text>
      </Screen>
    );
  }

  const who = occ.targets.map((t) => memberById(t)?.name).join(', ');
  return (
    <Screen>
      <Stack.Screen options={{ title: occ.title }} />
      <Card mode="outlined" style={styles.card}>
        <Card.Content>
          <Text variant="titleLarge">
            {occ.title}
            {occ.subtitle ? <Text style={styles.sub}> {occ.subtitle}</Text> : null}
          </Text>
          <Text variant="bodyLarge" style={styles.line}>
            {formatDate(occ.date)} {occ.start}~{occ.end}
          </Text>
          <Text style={styles.line}>
            {who} · {EVENT_KIND_LABELS[occ.kind]}
            {occ.status !== 'normal' ? ` · ${exceptionLabel(occ.kind, occ.status)}` : ''}
          </Text>
          {occ.place ? <Text style={styles.line}>📍 {occ.place}</Text> : null}
        </Card.Content>
        {occ.place ? (
          <Card.Actions>
            <Button
              icon="map-marker"
              onPress={() => void Linking.openURL(`https://map.kakao.com/link/search/${encodeURIComponent(occ.place!)}`)}>
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
              status={occ.checked.includes(item) ? 'checked' : 'unchecked'}
              onPress={() => toggleCheck(item)}
            />
          ))}
        </Card>
      )}

      <Card mode="outlined" style={styles.card}>
        <Card.Title
          title="이 회차만"
          titleVariant="titleMedium"
          subtitle={isClassKind(occ.kind) ? '학원비·환불에는 자동 반영되지 않습니다' : '이 날짜 일정만 바뀝니다'}
        />
        <Card.Actions style={styles.actions}>
          {occ.status === 'normal' ? (
            isClassKind(occ.kind) ? (
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
          {occ.status === 'cancelled' && isClassKind(occ.kind) && (
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
        </Card.Actions>
      </Card>

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
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  sub: { fontSize: 15, opacity: 0.7 },
  line: { marginTop: 4 },
  actions: { flexWrap: 'wrap', justifyContent: 'flex-start' },
  footer: { alignItems: 'flex-start' },
});
