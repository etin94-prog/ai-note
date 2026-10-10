import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Button, Card, List, Text, useTheme } from 'react-native-paper';

import { Screen } from '@/components/Screen';
import { formatDate, nowLocal } from '@/domain/dates';
import { type InboxItem, liveTitle } from '@/domain/reminders';
import { useRepository } from '@/state/RepositoryContext';
import { useNow } from '@/state/useCollection';
import { useReminders } from '@/state/useReminders';

const when = (at: string) => `${formatDate(at.slice(0, 10))} ${at.slice(11)}`;

/** 알림함 (N-13): 이 기기 사용자에게 온 일정·학원비 알림. 읽음 표시는 기기별 */
export default function InboxScreen() {
  const theme = useTheme();
  const { repo, isChild } = useRepository();
  const { inbox, unread, upcoming, markRead, prefs, me } = useReminders();
  const now = nowLocal(useNow());

  if (!repo) return <Screen><Text>더보기 → 저장 모드 연결 후 사용할 수 있습니다.</Text></Screen>;
  if (!me) return <Screen><Text>더보기 → 저장 모드에서 이 기기 사용자를 먼저 골라 주세요.</Text></Screen>;

  const open = (i: InboxItem) => {
    markRead([i.id]);
    router.push({ pathname: i.link.pathname as never, params: i.link.params });
  };

  return (
    <Screen>
      <View style={styles.head}>
        <Text variant="titleMedium">알림 {inbox.length ? `${inbox.length}건` : ''}</Text>
        <View style={styles.row}>
          {unread.length > 0 && (
            <Button compact onPress={() => markRead(inbox.map((i) => i.id))}>
              모두 읽음
            </Button>
          )}
          <Button compact icon="cog-outline" onPress={() => router.push('/reminders')}>
            설정
          </Button>
        </View>
      </View>
      {prefs.muted && (
        <Text style={styles.dim}>이 기기에서 일정 알림을 꺼 두었습니다. 설정에서 다시 켤 수 있습니다.</Text>
      )}

      <Card mode="outlined" style={styles.card}>
        {inbox.length === 0 && (
          <Card.Content>
            <Text style={styles.dim}>지금 확인할 알림이 없습니다.</Text>
          </Card.Content>
        )}
        {inbox.map((i) => {
          const isUnread = !prefs.read.includes(i.id);
          return (
            <List.Item
              key={i.id}
              title={liveTitle(i, now)}
              titleNumberOfLines={2}
              titleStyle={isUnread ? styles.bold : styles.dim}
              description={`${i.body}\n${when(i.at)}`}
              descriptionNumberOfLines={3}
              onPress={() => open(i)}
              left={(p) => (
                <List.Icon
                  {...p}
                  icon={i.type === 'fee' ? 'cash-clock' : 'bell-ring-outline'}
                  color={i.priority === 0 ? theme.colors.error : isUnread ? theme.colors.primary : p.color}
                />
              )}
              right={(p) => <List.Icon {...p} icon="chevron-right" />}
            />
          );
        })}
      </Card>

      {upcoming.length > 0 && (
        <Card mode="outlined" style={styles.card}>
          <Card.Title title="다음 알림" subtitle={isChild ? '내 일정 알림 예정' : '앞으로 울릴 알림 (이 기기 사용자 기준)'} titleVariant="titleSmall" />
          {upcoming.slice(0, 5).map((i) => (
            <List.Item
              key={i.id}
              title={i.subject && i.eventAt ? `${i.subject} · ${when(i.eventAt)} 시작` : i.title}
              description={`알림 ${when(i.at)}`}
              titleNumberOfLines={1}
              style={styles.compact}
            />
          ))}
        </Card>
      )}
      <View style={{ height: 40 }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', gap: 4 },
  card: { marginVertical: 8 },
  bold: { fontWeight: '700' },
  dim: { opacity: 0.6 },
  compact: { paddingVertical: 0 },
});
