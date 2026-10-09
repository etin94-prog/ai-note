import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Card, Text } from 'react-native-paper';

import { formatDuration } from '@/domain/dates';
import { liveStatus, type Occurrence } from '@/domain/schedule';
import type { MemberInfo } from '@/domain/types';

/** S-V1 사람별 실시간 상태 — 수업 중 / 다음 일정까지(자투리) / 오늘 끝 */
export function LiveStatusCard({ member, todays, now }: { member: MemberInfo; todays: Occurrence[]; now: string }) {
  const s = liveStatus(todays, now);
  let main = '';
  let sub = '';
  let target: Occurrence | undefined;
  if (s.state === 'busy') {
    main = `${s.occ.title} 중 · ${formatDuration(s.minutesLeft)} 남음`;
    sub = s.next ? `다음 ${s.next.start} ${s.next.title}` : '오늘 마지막 일정';
    target = s.occ;
  } else if (s.state === 'gap') {
    main = `${s.after ? '자투리 ' : ''}${formatDuration(s.minutesUntil)} 후 ${s.next.title}`;
    sub = `${s.next.start}~${s.next.end}${s.next.place ? ` · ${s.next.place}` : ''}`;
    target = s.next;
  } else if (s.state === 'done') {
    main = '오늘 일정 끝';
  } else {
    main = '오늘 일정 없음';
  }
  return (
    <Card
      mode="outlined"
      style={[styles.card, { borderLeftColor: member.color }]}
      onPress={target ? () => router.push({ pathname: '/occurrence', params: { key: target!.key } }) : undefined}>
      <Card.Content style={styles.content}>
        <Text style={[styles.name, { color: member.color }]}>{member.name}</Text>
        <View style={styles.body}>
          <Text variant="titleSmall">{main}</Text>
          {sub ? <Text variant="bodySmall" style={styles.sub}>{sub}</Text> : null}
        </View>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 8, borderLeftWidth: 4 },
  content: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  name: { fontWeight: '700', width: 32 },
  body: { flex: 1 },
  sub: { opacity: 0.7 },
});
