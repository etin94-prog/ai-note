import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, List, Switch, Text, TextInput } from 'react-native-paper';
import { ulid } from 'ulid';

import { DateField, Label } from '@/components/FormFields';
import { MemberMultiSelect } from '@/components/MemberChips';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Screen } from '@/components/Screen';
import type { StoredDoc } from '@/data/repository';
import { formatDate } from '@/domain/dates';
import { CHILDREN, type Holiday, memberById, type MemberId } from '@/domain/types';
import { useRepository } from '@/state/RepositoryContext';
import { useCollection } from '@/state/useCollection';

/** 방학·휴일 (S-05, S-14): 아이(학교)별 기간 → 등하교·학원 수업을 시간표에서 뺌 */
export default function HolidaysScreen() {
  const { repo, writeContext, readOnly } = useRepository();
  const { docs } = useCollection<Holiday>('holidays');
  const [editing, setEditing] = useState<StoredDoc<Holiday> | 'new' | null>(null);
  const [form, setForm] = useState<Holiday>({ name: '', memberIds: [], start: '', end: '', skipSchool: true, skipClass: false });

  const open = (h: StoredDoc<Holiday> | 'new') => {
    setEditing(h);
    setForm(h === 'new' ? { name: '', memberIds: CHILDREN.map((c) => c.id), start: '', end: '', skipSchool: true, skipClass: false } : h);
  };
  const set = (p: Partial<Holiday>) => setForm((f) => ({ ...f, ...p }));
  const valid = form.name.trim() && form.memberIds.length && form.start && form.end && form.start <= form.end;

  async function save() {
    if (!repo || !editing || !valid) return;
    const data: Holiday = {
      name: form.name.trim(),
      memberIds: form.memberIds,
      start: form.start,
      end: form.end,
      skipSchool: form.skipSchool,
      skipClass: form.skipClass,
    };
    const ctx = writeContext(`방학·휴일 ${editing === 'new' ? '추가' : '수정'}: ${data.name}`);
    if (editing === 'new') await repo.create('holidays', ulid(), data as unknown as Record<string, unknown>, ctx);
    else await repo.update('holidays', editing.id, data as unknown as Record<string, unknown>, editing.version, ctx);
    setEditing(null);
  }

  const sorted = [...docs].sort((a, b) => (a.start < b.start ? 1 : -1));

  return (
    <Screen>
      <Stack.Screen options={{ title: '방학·휴일' }} />
      {sorted.length === 0 && !editing && (
        <Text style={styles.hint}>방학·재량휴업일을 아이별로 등록하면 그 기간 등하교(필요하면 학원 수업도)가 시간표에서 빠집니다.</Text>
      )}
      {sorted.map((h) => (
        <List.Item
          key={h.id}
          title={`${h.name} · ${h.memberIds.map((m) => memberById(m)?.name).join('·')}`}
          description={`${formatDate(h.start)} ~ ${formatDate(h.end)} · ${[h.skipSchool && '등하교 제외', h.skipClass && '학원 제외'].filter(Boolean).join(', ') || '표시만'}`}
          left={(p) => <List.Icon {...p} icon="beach" />}
          onPress={readOnly ? undefined : () => open(h)}
        />
      ))}
      {editing && (
        <Card mode="outlined" style={styles.card}>
          <Card.Content>
            <TextInput mode="outlined" dense label="이름 (예: 겨울방학)" value={form.name} onChangeText={(name) => set({ name })} />
            <Label>누구 (학교가 다르면 따로 등록)</Label>
            <MemberMultiSelect members={CHILDREN} value={form.memberIds} onChange={(memberIds: MemberId[]) => set({ memberIds })} />
            <View style={styles.row}>
              <DateField label="시작일" value={form.start} onChange={(start) => set({ start })} />
              <DateField label="종료일" value={form.end} onChange={(end) => set({ end })} />
            </View>
            <View style={styles.switch}>
              <Text>등하교 일정 빼기</Text>
              <Switch value={form.skipSchool} onValueChange={(skipSchool) => set({ skipSchool })} />
            </View>
            <View style={styles.switch}>
              <Text>학원 수업도 빼기 (방학에도 학원은 가면 끔)</Text>
              <Switch value={form.skipClass} onValueChange={(skipClass) => set({ skipClass })} />
            </View>
          </Card.Content>
          <Card.Actions>
            {editing !== 'new' && (
              <ConfirmButton
                icon="delete-outline"
                label="삭제"
                confirmText="지울까요?"
                onConfirm={async () => {
                  await repo?.remove('holidays', editing.id, editing.version, writeContext(`방학·휴일 삭제: ${editing.name}`));
                  setEditing(null);
                }}
              />
            )}
            <Button onPress={() => setEditing(null)}>취소</Button>
            <Button mode="contained" onPress={save} disabled={!valid}>
              저장
            </Button>
          </Card.Actions>
        </Card>
      )}
      {!editing && !readOnly && (
        <View style={styles.add}>
          <Button icon="plus" mode="contained-tonal" onPress={() => open('new')}>
            방학·휴일 추가
          </Button>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { opacity: 0.7, marginBottom: 12 },
  card: { marginTop: 8 },
  row: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  switch: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 4 },
  add: { marginTop: 12, alignItems: 'flex-start' },
});
