import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, List, Text, TextInput } from 'react-native-paper';
import { ulid } from 'ulid';

import { ConfirmButton } from '@/components/ConfirmButton';
import { Screen } from '@/components/Screen';
import type { StoredDoc } from '@/data/repository';
import type { Place } from '@/domain/types';
import { useRepository } from '@/state/RepositoryContext';
import { useCollection } from '@/state/useCollection';
import { useTrash } from '@/state/useTrash';
import { useBusy } from '@/lib/useBusy';

/** 자주 가는 장소 (S-06): 집·학교 등. 일정 입력에서 골라 쓰고, 지도 열기에 사용 */
export default function PlacesScreen() {
  const { repo, writeContext, readOnly } = useRepository();
  const [busy, run] = useBusy();
  const moveToTrash = useTrash();
  const { docs } = useCollection<Place>('places');
  const [editing, setEditing] = useState<StoredDoc<Place> | 'new' | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');

  const open = (p: StoredDoc<Place> | 'new') => {
    setEditing(p);
    setName(p === 'new' ? '' : p.name);
    setAddress(p === 'new' ? '' : (p.address ?? ''));
  };

  async function save() {
    if (!repo || !name.trim() || !editing) return;
    const data = { name: name.trim(), address: address.trim() };
    if (editing === 'new') await repo.create('places', ulid(), data, writeContext(`장소 추가: ${data.name}`));
    else await repo.update('places', editing.id, data, editing.version, writeContext(`장소 수정: ${data.name}`));
    setEditing(null);
  }

  const sorted = [...docs].filter((p) => !(p as unknown as { spikeTest?: boolean }).spikeTest).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Screen>
      <Stack.Screen options={{ title: '장소' }} />
      {sorted.length === 0 && !editing && (
        <Text style={styles.hint}>집, 학교, 자주 가는 학원 건물 등을 등록해 두면 일정 입력 때 골라 쓸 수 있습니다.</Text>
      )}
      {sorted.map((p) => (
        <List.Item
          key={p.id}
          title={p.name}
          description={p.address || '주소 없음'}
          left={(pr) => <List.Icon {...pr} icon="map-marker-outline" />}
          onPress={readOnly ? undefined : () => open(p)}
        />
      ))}
      {editing && (
        <Card mode="outlined" style={styles.card}>
          <Card.Content style={styles.gap}>
            <TextInput mode="outlined" dense label="이름 (예: 집, OO중학교)" value={name} onChangeText={setName} />
            <TextInput mode="outlined" dense label="주소 (지도 연결용)" value={address} onChangeText={setAddress} />
          </Card.Content>
          <Card.Actions>
            {editing !== 'new' && (
              <ConfirmButton
                icon="delete-outline"
                label="삭제"
                confirmText="지울까요?"
                onConfirm={async () => {
                  await moveToTrash(`장소: ${editing.name}`, [{ col: 'places', doc: editing as unknown as StoredDoc }]);
                  setEditing(null);
                }}
              />
            )}
            <Button onPress={() => setEditing(null)}>취소</Button>
            <Button mode="contained" loading={busy} onPress={() => run(save)} disabled={!name.trim() || busy}>
              저장
            </Button>
          </Card.Actions>
        </Card>
      )}
      {!editing && !readOnly && (
        <View style={styles.add}>
          <Button icon="plus" mode="contained-tonal" onPress={() => open('new')}>
            장소 추가
          </Button>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { opacity: 0.7, marginBottom: 12 },
  card: { marginTop: 8 },
  gap: { gap: 8 },
  add: { marginTop: 12, alignItems: 'flex-start' },
});
