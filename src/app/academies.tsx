import { router, Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Card, FAB, List, Text } from 'react-native-paper';

import { Screen } from '@/components/Screen';
import { useRepository } from '@/state/RepositoryContext';
import { type Academy, type Enrollment, memberById, WEEKDAY_LABELS } from '@/domain/types';
import { useCollection } from '@/state/useCollection';

/** 학원 목록 (B-1). 학원마다 수강 중인 자녀·요일 요약 */
export default function AcademiesScreen() {
  const { isChild, readOnly, settings } = useRepository();
  const academies = useCollection<Academy>('academies');
  const enrollments = useCollection<Enrollment>('enrollments');
  // 자녀 기기는 본인이 다니는 학원만 (U-06)
  const own = new Set(enrollments.docs.filter((e) => e.childId === settings.memberId).map((e) => e.academyId));
  const sorted = [...academies.docs].filter((a) => !isChild || own.has(a.id)).sort((a, b) =>
    a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'active' ? -1 : 1,
  );

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: '학원' }} />
      <Screen>
        {academies.loaded && sorted.length === 0 && (
          <Card mode="outlined">
            <Card.Content>
              <Text>아직 등록된 학원이 없습니다. 아래 [학원 추가]로 시작하세요.</Text>
              <Text style={styles.hint}>학원 → 수강(아이·요일·시간)을 등록하면 시간표가 자동으로 만들어집니다.</Text>
            </Card.Content>
          </Card>
        )}
        {sorted.map((a) => {
          const mine = enrollments.docs.filter((e) => e.academyId === a.id && e.status !== 'ended' && (!isChild || e.childId === settings.memberId));
          const desc =
            mine
              .map(
                (e) =>
                  `${memberById(e.childId)?.name} ${e.slots.map((s) => WEEKDAY_LABELS[s.weekday]).join('')} ${e.slots[0]?.start ?? ''}${e.status === 'paused' ? ' (휴원)' : ''}`,
              )
              .join(' / ') || '수강 등록 전';
          return (
            <List.Item
              key={a.id}
              title={`${a.name}${a.status === 'closed' ? ' (그만둠)' : ''}`}
              description={`${a.subject} · ${desc}`}
              left={(p) => <List.Icon {...p} icon="school-outline" />}
              right={(p) => <List.Icon {...p} icon="chevron-right" />}
              onPress={() => router.push({ pathname: '/academy', params: { id: a.id } })}
              style={a.status === 'closed' ? styles.closed : undefined}
            />
          );
        })}
        <View style={{ height: 80 }} />
      </Screen>
      {!isChild && !readOnly && <FAB icon="plus" label="학원 추가" style={styles.fab} onPress={() => router.push('/academy')} />}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hint: { marginTop: 8, opacity: 0.7 },
  closed: { opacity: 0.5 },
  fab: { position: 'absolute', right: 16, bottom: 16 },
});
