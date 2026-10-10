import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Surface, Text, useTheme } from 'react-native-paper';

import { nowLocal } from '@/domain/dates';
import { liveTitle } from '@/domain/reminders';
import { useNow } from '@/state/useCollection';
import { useReminders } from '@/state/useReminders';

/** 홈 상단 알림 배너 (N-13): 안 읽은 알림이 있을 때만 */
export function InboxBanner() {
  const theme = useTheme();
  const { unread } = useReminders();
  const now = nowLocal(useNow());
  if (unread.length === 0) return null;
  const first = unread[0];
  const urgent = first.priority === 0;
  return (
    <Surface
      elevation={0}
      style={[styles.box, { backgroundColor: urgent ? theme.colors.errorContainer : theme.colors.primaryContainer }]}
      accessibilityRole="alert">
      <Icon source={urgent ? 'alert-circle-outline' : 'bell-ring-outline'} size={22} color={urgent ? theme.colors.error : theme.colors.primary} />
      <View style={styles.text}>
        <Text variant="labelLarge" numberOfLines={1}>
          {liveTitle(first, now)}
        </Text>
        <Text variant="bodySmall" numberOfLines={1} style={styles.dim}>
          {unread.length > 1 ? `외 ${unread.length - 1}건 · ` : ''}
          {first.body}
        </Text>
      </View>
      <Button compact onPress={() => router.push('/inbox')}>
        보기
      </Button>
    </Surface>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, paddingVertical: 8, paddingLeft: 12, paddingRight: 4, marginBottom: 12 },
  text: { flex: 1, minWidth: 0 },
  dim: { opacity: 0.75 },
});
