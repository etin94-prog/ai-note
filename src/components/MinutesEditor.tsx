import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Chip, HelperText, TextInput } from 'react-native-paper';

import { labelMinutes, MAX_PER_LIST, MINUTE_PRESETS, normalizeMinutes, parseMinutes } from '@/domain/reminders';

/** 알림 시점 목록 편집 (N-21): 프리셋 + 직접 입력, 최대 6개 */
export function MinutesEditor({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const add = (m: number) => {
    if (value.length >= MAX_PER_LIST && !value.includes(m)) return setError(`최대 ${MAX_PER_LIST}개까지`);
    setError('');
    onChange(normalizeMinutes([...value, m]));
  };
  return (
    <View style={styles.wrap}>
      <View style={styles.chips}>
        {value.length === 0 && <Chip compact disabled>알림 없음</Chip>}
        {value.map((m) => (
          <Chip key={m} compact mode="flat" selected onClose={() => onChange(value.filter((x) => x !== m))} closeIcon="close">
            {labelMinutes(m)}
          </Chip>
        ))}
      </View>
      <View style={styles.chips}>
        {MINUTE_PRESETS.filter((m) => !value.includes(m)).map((m) => (
          <Chip key={m} compact icon="plus" onPress={() => add(m)}>
            {labelMinutes(m).replace(' 전', '')}
          </Chip>
        ))}
        <TextInput
          mode="outlined"
          dense
          style={styles.input}
          placeholder="직접: 45분, 1시간 30분"
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => {
            const m = parseMinutes(text);
            if (!m || m > 10080) return setError('1분 ~ 7일 사이로 적어 주세요 (예: 45분, 2시간, 1일)');
            add(m);
            setText('');
          }}
        />
      </View>
      {error ? <HelperText type="error">{error}</HelperText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  input: { minWidth: 170, flexGrow: 1, maxWidth: 240 },
});
