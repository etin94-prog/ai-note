import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Chip, HelperText, Text, TextInput } from 'react-native-paper';

import { isValidDate, normalizeTime } from '@/domain/dates';
import { WEEK_ORDER, WEEKDAY_LABELS, type Weekday } from '@/domain/types';

/** 'HH:mm' 시각 입력 — "7시", "1930" 도 받아 정리 (X-03 입력 편의) */
export function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [error, setError] = useState(false);
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setText(value);
  }
  return (
    <View style={styles.flex}>
      <TextInput
        mode="outlined"
        dense
        label={label}
        value={text}
        keyboardType="numbers-and-punctuation"
        placeholder="19:00"
        onChangeText={setText}
        onBlur={() => {
          const t = normalizeTime(text);
          setError(!t);
          if (t) {
            setText(t);
            onChange(t);
          }
        }}
        error={error}
      />
      {error && <HelperText type="error">예: 19:00, 1930, 7시</HelperText>}
    </View>
  );
}

/** 'YYYY-MM-DD' 날짜 입력 */
export function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [error, setError] = useState(false);
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setText(value);
  }
  return (
    <View style={styles.flex}>
      <TextInput
        mode="outlined"
        dense
        label={label}
        value={text}
        placeholder="2026-11-09"
        keyboardType="numbers-and-punctuation"
        onChangeText={setText}
        onBlur={() => {
          const t = text.trim().replace(/[./]/g, '-');
          const ok = t === '' || isValidDate(t);
          setError(!ok);
          if (ok) onChange(t);
        }}
        error={error}
      />
      {error && <HelperText type="error">예: 2026-11-09</HelperText>}
    </View>
  );
}

/** 요일 선택 칩 (월~일 순서) */
export function WeekdayChips({ value, onChange, single }: { value: Weekday[]; onChange: (v: Weekday[]) => void; single?: boolean }) {
  return (
    <View style={styles.row}>
      {WEEK_ORDER.map((d) => {
        const on = value.includes(d);
        return (
          <Chip
            key={d}
            compact
            selected={on}
            showSelectedOverlay
            onPress={() => onChange(single ? [d] : on ? value.filter((x) => x !== d) : [...value, d])}>
            {WEEKDAY_LABELS[d]}
          </Chip>
        );
      })}
    </View>
  );
}

export function ChipSelect<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.row}>
      {options.map((o) => (
        <Chip key={o.value} compact selected={value === o.value} showSelectedOverlay onPress={() => onChange(o.value)}>
          {o.label}
        </Chip>
      ))}
    </View>
  );
}

export function Label({ children }: { children: string }) {
  return (
    <Text variant="labelLarge" style={styles.label}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 },
  label: { marginTop: 12 },
});
