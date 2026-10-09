import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { Button, HelperText, TextInput } from 'react-native-paper';
import { ulid } from 'ulid';

import { ChipSelect, DateField, Label } from '@/components/FormFields';
import { MoneyInput } from '@/components/MoneyInput';
import { Screen } from '@/components/Screen';
import { goBack } from '@/lib/nav';
import type { StoredDoc } from '@/data/repository';
import { today } from '@/domain/dates';
import { DEFAULT_EXPENSE_CATEGORIES, type Expense, won } from '@/domain/money';
import { CHILDREN, type MemberId } from '@/domain/types';
import { useRepository } from '@/state/RepositoryContext';
import { useCollection } from '@/state/useCollection';

const LAST = 'ai-note.last-expense.v1';

/**
 * 기타 지출 입력 (F-21, F-V4): 한 화면에서 금액 → 분류 → 누구 → 저장 (목표 15초).
 * 날짜 기본 오늘, 분류·자녀는 지난번 선택 (X-03).
 */
export default function ExpenseScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { repo, writeContext, isChild } = useRepository();
  const { docs } = useCollection<Expense>('expenses');
  const [existing, setExisting] = useState<StoredDoc<Expense> | null>(null);
  const last = (() => {
    try {
      return JSON.parse(globalThis.localStorage?.getItem(LAST) ?? '{}') as Partial<Expense>;
    } catch {
      return {};
    }
  })();
  const [amount, setAmount] = useState(0);
  const [category, setCategory] = useState(last.category ?? '교재비');
  const [childId, setChildId] = useState<MemberId | 'common'>(last.childId ?? 'son');
  const [date, setDate] = useState(today());
  const [memo, setMemo] = useState('');
  const [error, setError] = useState<string | null>(null);

  // 수정할 지출이 불러와지면 한 번만 폼에 채움
  const found = existing ? undefined : docs.find((d) => d.id === id);
  if (found) {
    setExisting(found);
    setAmount(found.amount);
    setCategory(found.category);
    setChildId(found.childId);
    setDate(found.date);
    setMemo(found.memo ?? '');
  }

  // 쓴 적 있는 사용자 분류도 칩으로 (F-22)
  const categories = [...new Set([...DEFAULT_EXPENSE_CATEGORIES, ...docs.map((d) => d.category)])];

  async function save() {
    if (!repo) return;
    if (amount <= 0) return setError('금액을 입력해 주세요.');
    const data: Expense = { date, amount, category: category.trim() || '기타', childId, memo: memo.trim() };
    const label = `지출 ${existing ? '수정' : '추가'}: ${data.category} ${won(amount)}`;
    if (existing) await repo.update('expenses', existing.id, data as unknown as Record<string, unknown>, existing.version, writeContext(label));
    else await repo.create('expenses', ulid(), data as unknown as Record<string, unknown>, writeContext(label));
    globalThis.localStorage?.setItem(LAST, JSON.stringify({ category: data.category, childId }));
    goBack('/cost');
  }

  if (isChild) return null;

  return (
    <Screen>
      <Stack.Screen options={{ title: existing ? '지출 수정' : '기타 지출' }} />
      <MoneyInput label="금액" value={amount} onChange={setAmount} autoFocus={!id} />
      <Label>분류</Label>
      <ChipSelect options={categories.map((c) => ({ value: c, label: c }))} value={category} onChange={setCategory} />
      <TextInput mode="outlined" dense label="새 분류 (직접 입력)" value={categories.includes(category) ? '' : category} onChangeText={setCategory} />
      <Label>누구</Label>
      <ChipSelect
        options={[...CHILDREN.map((c) => ({ value: c.id as MemberId | 'common', label: c.name })), { value: 'common', label: '공통' }]}
        value={childId}
        onChange={setChildId}
      />
      <DateField label="날짜" value={date} onChange={setDate} />
      <TextInput mode="outlined" dense label="메모 (선택)" value={memo} onChangeText={setMemo} style={styles.gap} />
      {error && <HelperText type="error">{error}</HelperText>}
      <Button mode="contained" onPress={() => void save()} style={styles.gap}>
        저장
      </Button>
      {existing && (
        <Button
          textColor="#DC2626"
          onPress={async () => {
            await repo?.remove('expenses', existing.id, existing.version, writeContext(`지출 삭제: ${existing.category} ${won(existing.amount)}`));
            goBack('/cost');
          }}>
          삭제
        </Button>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { marginTop: 8 },
});
