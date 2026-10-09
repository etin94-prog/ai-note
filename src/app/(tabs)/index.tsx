import { router } from 'expo-router';
import { useMemo } from 'react';
import { Button, Card, Text } from 'react-native-paper';

import { InstallPrompt } from '@/components/InstallPrompt';
import { LiveStatusCard } from '@/components/LiveStatusCard';
import { OccurrenceRow } from '@/components/OccurrenceRow';
import { Screen } from '@/components/Screen';
import { SyncIndicator } from '@/components/SyncIndicator';
import { formatDate, nowLocal, today } from '@/domain/dates';
import { findConflicts, visibleFor } from '@/domain/schedule';
import { type MemberId, MEMBERS } from '@/domain/types';
import { useRepository } from '@/state/RepositoryContext';
import { useNow, useOccurrences } from '@/state/useCollection';

/** 홈 (S-V1, 구현계획서 4.3): 실시간 상태, 오늘 일정. 처리 필요(비용)는 Sprint 2. */
export default function HomeScreen() {
  const { repo, isChild, readOnly, settings } = useRepository();
  const now = useNow();
  const d = today(now);
  const { occurrences: all, loaded } = useOccurrences(d, d);
  // 자녀 기기는 본인 일정만 (U-06)
  const occurrences = useMemo(() => (isChild ? visibleFor(all, settings.memberId as MemberId) : all), [all, isChild, settings.memberId]);
  const conflicts = useMemo(() => findConflicts(occurrences), [occurrences]);
  const people = isChild
    ? MEMBERS.filter((m) => m.id === settings.memberId)
    : MEMBERS.filter((m) => m.role === 'child' || visibleFor(occurrences, m.id).length > 0);

  return (
    <Screen>
      <SyncIndicator />
      <InstallPrompt />
      {!repo ? (
        <Card style={{ marginBottom: 12 }}>
          <Card.Title title="처음 설정" titleVariant="titleMedium" />
          <Card.Content>
            <Text variant="bodyMedium">가족 데이터를 저장할 곳(GitHub 또는 Firebase)을 연결해 주세요.</Text>
          </Card.Content>
          <Card.Actions>
            <Button mode="contained" onPress={() => router.push('/settings/storage')}>
              저장 모드 연결
            </Button>
          </Card.Actions>
        </Card>
      ) : (
        <>
          <Text variant="titleMedium" style={{ marginBottom: 8 }}>
            지금 · {formatDate(d)} {nowLocal(now).slice(11)}
          </Text>
          {people.map((m) => (
            <LiveStatusCard key={m.id} member={m} todays={visibleFor(occurrences, m.id)} now={nowLocal(now)} />
          ))}
          <Card mode="outlined" style={{ marginTop: 8 }}>
            <Card.Title title="오늘 일정" titleVariant="titleMedium" />
            {occurrences.length === 0 ? (
              <Card.Content>
                <Text style={{ opacity: 0.6 }}>{loaded ? '오늘 일정이 없습니다.' : '불러오는 중…'}</Text>
              </Card.Content>
            ) : (
              occurrences.map((o) => <OccurrenceRow key={o.key} occ={o} conflict={conflicts.has(o.key)} />)
            )}
            {!readOnly && (
              <Card.Actions>
                {!isChild && <Button onPress={() => router.push('/academies')}>학원 관리</Button>}
                <Button mode="contained-tonal" icon="plus" onPress={() => router.push({ pathname: '/event', params: { date: d } })}>
                  일정 추가
                </Button>
              </Card.Actions>
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}
