import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Button, Chip, Dialog, Portal, Text } from 'react-native-paper';

import { formatDate, weekdayOf } from '@/domain/dates';
import { type Academy, CHILDREN, type MemberId, WEEKDAY_LABELS } from '@/domain/types';
import { useCollection } from '@/state/useCollection';

const plusHour = (t: string) => `${String(Math.min(23, Number(t.slice(0, 2)) + 1)).padStart(2, '0')}:${t.slice(3, 5)}`;

/**
 * 시간표 빈 칸을 눌렀을 때: 그 날·그 시각으로 [일정 추가] 또는 [학원 수업 추가(매주 반복)].
 * 사람 필터가 골라져 있으면 그 사람을 미리 채운다.
 */
export function AddAtTimeDialog({
  at,
  member,
  allowClass,
  onDismiss,
}: {
  at: { date: string; time: string } | null;
  member: MemberId | 'all';
  /** 학원 수업 추가 (부모만) */
  allowClass: boolean;
  onDismiss: () => void;
}) {
  const academies = useCollection<Academy>('academies');
  const active = academies.docs.filter((a) => a.status === 'active').sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const child = CHILDREN.some((c) => c.id === member) ? member : undefined;

  const go = (pathname: '/event' | '/enrollment', params: Record<string, string>) => {
    onDismiss();
    router.push({ pathname, params });
  };

  if (!at) return null;
  const end = plusHour(at.time);
  const wd = weekdayOf(at.date);
  return (
    <Portal>
      <Dialog visible onDismiss={onDismiss} style={styles.dialog}>
        <Dialog.Title>
          {formatDate(at.date)} {at.time}
        </Dialog.Title>
        <Dialog.Content style={styles.gap}>
          <Button
            mode="contained"
            icon="calendar-plus"
            onPress={() => go('/event', { date: at.date, start: at.time, end, ...(member !== 'all' ? { targets: member } : {}) })}>
            일정 추가
          </Button>
          {allowClass && (
            <View style={styles.gap}>
              <Text variant="labelLarge">
                학원 수업 추가 — 매주 {WEEKDAY_LABELS[wd]} {at.time}
              </Text>
              {active.length === 0 ? (
                <Text style={styles.dim}>등록된 학원이 없습니다. 더보기 → 학원 · 수강에서 먼저 추가해 주세요.</Text>
              ) : (
                <View style={styles.chips}>
                  {active.map((a) => (
                    <Chip
                      key={a.id}
                      icon="school-outline"
                      onPress={() =>
                        go('/enrollment', {
                          academyId: a.id,
                          weekday: String(wd),
                          start: at.time,
                          end,
                          date: at.date,
                          ...(child ? { childId: child } : {}),
                        })
                      }>
                      {a.name}
                    </Chip>
                  ))}
                </View>
              )}
            </View>
          )}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onDismiss}>닫기</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  dialog: { maxWidth: 520, width: '92%', alignSelf: 'center' },
  gap: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dim: { opacity: 0.6 },
});
