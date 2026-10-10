import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, IconButton, Text } from 'react-native-paper';

/**
 * 한 번 누르면 "정말 ~할까요?" 를 보여 주고, 두 번째에 실행 (실수로 지우기 방지).
 * icon 을 주면 아이콘 버튼으로 시작.
 */
export function ConfirmButton({
  label,
  confirmText,
  onConfirm,
  icon,
  color = '#DC2626',
}: {
  label: string;
  confirmText: string;
  onConfirm: () => void | Promise<void>;
  icon?: string;
  color?: string;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking)
    return icon ? (
      <IconButton icon={icon} iconColor={color} accessibilityLabel={label} onPress={() => setAsking(true)} />
    ) : (
      <Button textColor={color} onPress={() => setAsking(true)}>
        {label}
      </Button>
    );
  return (
    <View style={styles.row} accessibilityRole="alert">
      <Text style={[styles.q, { color }]}>{confirmText}</Text>
      <Button compact onPress={() => setAsking(false)} disabled={busy}>
        아니요
      </Button>
      <Button
        compact
        mode="contained"
        buttonColor={color}
        loading={busy}
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}>
        {label}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, paddingVertical: 4 },
  q: { fontWeight: '600' },
});
