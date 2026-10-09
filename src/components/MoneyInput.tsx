import { StyleSheet, View } from 'react-native';
import { Chip, TextInput } from 'react-native-paper';

import { won } from '@/domain/money';

/** 금액 입력 (X-04): 숫자 키패드, 천단위 콤마, 빠른 버튼 +1만/+5만/+10만 */
export function MoneyInput({
  label,
  value,
  onChange,
  quick = true,
  autoFocus,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  quick?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <View>
      <TextInput
        mode="outlined"
        label={label}
        value={value ? value.toLocaleString('ko-KR') : ''}
        onChangeText={(t) => onChange(Number(t.replace(/[^\d]/g, '')) || 0)}
        keyboardType="number-pad"
        right={<TextInput.Affix text={value >= 10000 ? `원 (${won(value)})` : '원'} />}
        autoFocus={autoFocus}
      />
      {quick && (
        <View style={styles.row}>
          {[10000, 50000, 100000].map((n) => (
            <Chip key={n} compact icon="plus" onPress={() => onChange(value + n)}>
              {won(n)}
            </Chip>
          ))}
          {value > 0 && (
            <Chip compact icon="close" onPress={() => onChange(0)}>
              지우기
            </Chip>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
});
