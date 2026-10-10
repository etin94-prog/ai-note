import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, HelperText, List, Text } from 'react-native-paper';

import { ConfirmButton } from '@/components/ConfirmButton';
import { Screen } from '@/components/Screen';
import { formatDate } from '@/domain/dates';
import { daysLeft, expiredTrash, restoreFromTrash, TRASH_DAYS, type TrashItem } from '@/domain/trash';
import { memberById } from '@/domain/types';
import { useRepository } from '@/state/RepositoryContext';
import { useCollection } from '@/state/useCollection';

/** 휴지통 (X-08): 지운 일정·지출·장소·방학을 30일 동안 되살릴 수 있다. 부모 전용. */
export default function TrashScreen() {
  const { repo, isChild, writeContext } = useRepository();
  const trash = useCollection<TrashItem>('trash');
  const [error, setError] = useState('');
  const now = new Date().toISOString();

  // 30일 지난 항목은 화면을 열 때 정리
  const purged = useRef(false);
  useEffect(() => {
    if (!repo || isChild || !trash.loaded || purged.current) return;
    const old = expiredTrash(trash.docs, new Date().toISOString());
    purged.current = true;
    if (old.length === 0) return;
    void repo.applyBatch(
      old.map((d) => ({ type: 'delete' as const, col: 'trash' as const, id: d.id, expectVersion: d.version })),
      writeContext(`휴지통 정리: ${TRASH_DAYS}일 지난 ${old.length}건`),
    );
  }, [repo, isChild, trash.loaded, trash.docs, writeContext]);

  if (isChild) return <Screen><Text>부모만 사용할 수 있습니다.</Text></Screen>;
  if (!repo) return <Screen><Text>더보기 → 저장 모드 연결 후 사용할 수 있습니다.</Text></Screen>;

  const items = [...trash.docs].sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));

  return (
    <Screen>
      <Text variant="bodyMedium" style={styles.dim}>
        지운 일정·기타 지출·장소·방학은 {TRASH_DAYS}일 동안 여기 있다가 완전히 지워집니다. 납부·환불 기록은 지우지 않고 ‘정정’으로 남기 때문에 여기에 오지 않습니다.
      </Text>
      <Card mode="outlined" style={styles.card}>
        {items.length === 0 && (
          <Card.Content>
            <Text style={styles.dim}>{trash.loaded ? '휴지통이 비어 있습니다.' : '불러오는 중…'}</Text>
          </Card.Content>
        )}
        {items.map((it) => (
          <List.Item
            key={it.id}
            title={it.label}
            titleNumberOfLines={2}
            description={`${formatDate(it.deletedAt.slice(0, 10))} ${memberById(it.deletedBy)?.name ?? it.deletedBy} 삭제 · ${Math.max(0, daysLeft(it, now))}일 남음`}
            right={() => (
              <View style={styles.actions}>
                <Button
                  compact
                  mode="contained-tonal"
                  icon="restore"
                  onPress={async () => {
                    const r = await repo.applyBatch(restoreFromTrash(it), writeContext(`되살리기: ${it.label}`));
                    setError(r.ok ? '' : '같은 항목이 이미 있어 되살리지 못했습니다.');
                  }}>
                  되살리기
                </Button>
                <ConfirmButton
                  icon="delete-forever-outline"
                  label="완전히 삭제"
                  confirmText="되돌릴 수 없습니다"
                  onConfirm={async () => {
                    await repo.remove('trash', it.id, it.version, writeContext(`휴지통에서 삭제: ${it.label}`));
                  }}
                />
              </View>
            )}
          />
        ))}
      </Card>
      {error ? <HelperText type="error">{error}</HelperText> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  dim: { opacity: 0.7 },
  card: { marginVertical: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 220 },
});
