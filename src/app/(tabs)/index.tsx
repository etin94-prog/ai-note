import { router } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';

import { DashboardTiles } from '@/components/DashboardTiles';
import { InboxBanner } from '@/components/InboxBanner';
import { InstallPrompt } from '@/components/InstallPrompt';
import { LiveStatusCard } from '@/components/LiveStatusCard';
import { MoneySummaryCard } from '@/components/MoneySummaryCard';
import { OccurrenceRow } from '@/components/OccurrenceRow';
import { Columns, Screen } from '@/components/Screen';
import { SyncIndicator } from '@/components/SyncIndicator';
import { TodoCard } from '@/components/TodoCard';
import { formatDate, nowLocal, today } from '@/domain/dates';
import { findConflicts, visibleFor } from '@/domain/schedule';
import { type Academy, memberById, type MemberId, MEMBERS, WEEKDAY_LABELS } from '@/domain/types';
import { PALETTE } from '@/lib/theme';
import { useLayout } from '@/lib/useLayout';
import { useRepository } from '@/state/RepositoryContext';
import { useCollection, useNow, useOccurrences } from '@/state/useCollection';

/**
 * 홈 (S-V1, 구현계획서 4.3): 처리 필요, 실시간 상태, 오늘 일정, (부모) 이달 학원비.
 * PC: 3단 대시보드 (X-17), 폰: 위아래.
 */
export default function HomeScreen() {
  const { repo, isChild, readOnly, settings } = useRepository();
  const { wide } = useLayout();
  const now = useNow();
  const d = today(now);
  const { occurrences: all, loaded } = useOccurrences(d, d);
  const academies = useCollection<Academy>('academies');
  const needSetup = !!repo && !isChild && !readOnly && academies.loaded && academies.docs.length === 0;
  // 자녀 기기는 본인 일정만 (U-06)
  const occurrences = useMemo(() => (isChild ? visibleFor(all, settings.memberId as MemberId) : all), [all, isChild, settings.memberId]);
  const conflicts = useMemo(() => findConflicts(occurrences), [occurrences]);
  const people = isChild
    ? MEMBERS.filter((m) => m.id === settings.memberId)
    : MEMBERS.filter((m) => m.role === 'child' || visibleFor(occurrences, m.id).length > 0);

  const todayCard = (
    <Card mode="outlined" style={{ marginTop: wide ? 0 : 8, marginBottom: 12 }}>
      <Card.Title title={`오늘 일정 · ${formatDate(d)}`} titleVariant="titleMedium" />
      {occurrences.length === 0 ? (
        <Card.Content>
          <Text style={{ opacity: 0.6 }}>{loaded ? '오늘 일정이 없습니다.' : '불러오는 중…'}</Text>
        </Card.Content>
      ) : (
        occurrences.map((o) => <OccurrenceRow key={o.key} occ={o} conflict={conflicts.has(o.key)} />)
      )}
      <Card.Actions>
        {!isChild && !readOnly && <Button onPress={() => router.push('/academies')}>학원 관리</Button>}
        <Button onPress={() => router.push('/schedule')}>일정 전체 보기</Button>
      </Card.Actions>
    </Card>
  );

  const me = memberById(settings.memberId);
  const header = (
    <View style={{ marginBottom: 12 }}>
      <Text variant="headlineSmall" style={{ fontWeight: '700', color: PALETTE.text, letterSpacing: -0.6 }}>
        {Number(d.slice(5, 7))}월 {Number(d.slice(8))}일 {WEEKDAY_LABELS[now.getDay()]}요일
      </Text>
      {me && (
        <Text variant="bodyMedium" style={{ color: PALETTE.sub }}>
          {me.name}의 오늘 · {nowLocal(now).slice(11)} 기준
        </Text>
      )}
    </View>
  );
  // 빠른 실행: 폰에서도 한 줄에 같은 폭으로
  const quick = repo && !readOnly && (
    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
      <Button style={wide ? { minWidth: 160 } : { flex: 1 }} compact mode="contained" icon="calendar-plus" onPress={() => router.push({ pathname: '/event', params: { date: d } })}>
        일정 추가
      </Button>
      {!isChild && (
        <Button style={wide ? { minWidth: 160 } : { flex: 1 }} compact mode="contained-tonal" icon="message-text-outline" onPress={() => router.push('/input')}>
          채팅 입력
        </Button>
      )}
      {!isChild && (
        <Button style={wide ? { minWidth: 160 } : { flex: 1 }} compact mode="contained-tonal" icon="cash-check" onPress={() => router.push('/cost')}>
          학원비
        </Button>
      )}
    </View>
  );

  return (
    <Screen wide>
      <SyncIndicator />
      {repo && header}
      {repo && <InboxBanner />}
      {repo && !needSetup && <DashboardTiles occurrences={occurrences} isChild={isChild} />}
      {quick}
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
          {needSetup && (
            <Card style={{ marginBottom: 12 }}>
              <Card.Title title="처음 설정" subtitle="학원·수강 정보가 아직 없습니다" titleVariant="titleMedium" />
              <Card.Content>
                <Text variant="bodyMedium">집·학교 → 학원 → 수강(요일·시간·수강료) 순서로 한 번에 입력할 수 있습니다.</Text>
              </Card.Content>
              <Card.Actions>
                <Button mode="contained" onPress={() => router.push('/setup')}>
                  처음 설정 시작
                </Button>
              </Card.Actions>
            </Card>
          )}
          <Columns flex={[1, 1.2, 1]}>
            {[
              <View key="now">
                {!isChild && <TodoCard />}
                <Text variant="titleMedium" style={{ marginBottom: 8 }}>
                  {isChild ? '지금' : '아이들 지금'}
                </Text>
                {people.map((m) => (
                  <LiveStatusCard key={m.id} member={m} todays={visibleFor(occurrences, m.id)} now={nowLocal(now)} />
                ))}
              </View>,
              <View key="today">{todayCard}</View>,
              !isChild && wide ? (
                <View key="money">
                  <MoneySummaryCard />
                </View>
              ) : null,
            ]}
          </Columns>
        </>
      )}
    </Screen>
  );
}
