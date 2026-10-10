import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, ProgressBar, Surface, Text } from 'react-native-paper';

import type { PendingState } from '@/data/repository';
import { useRepository } from '@/state/RepositoryContext';

const IDLE: PendingState = { count: 0, failed: 0, online: true };

/**
 * 모든 화면 위에 뜨는 저장 진행 표시.
 * 저장하면 화면에는 바로 반영되고 서버 전송은 뒤에서 진행되므로, 그동안 "저장 중"을 보여 주고
 * 끝나면 잠깐 "저장됨", 실패하면 되돌렸다는 안내를 띄운다. 전송 중 창을 닫으려 하면 브라우저가 한 번 묻는다.
 */
export function SavingBar() {
  const { repo } = useRepository();
  const [p, setP] = useState<PendingState>(IDLE);
  const [done, setDone] = useState(false);
  const wasBusy = useRef(false);

  useEffect(() => {
    if (!repo) return;
    return repo.pending((s) => {
      setP(s);
      if (s.count > 0) {
        wasBusy.current = true;
        setDone(false);
      } else if (wasBusy.current) {
        wasBusy.current = false;
        if (s.failed === 0) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }
    });
  }, [repo]);

  // 보내는 중에 창을 닫으면 저장이 사라질 수 있어 한 번 확인
  const busy = p.count > 0;
  useEffect(() => {
    if (Platform.OS !== 'web' || !busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  if (p.failed > 0) {
    return (
      <View style={styles.wrap} pointerEvents="box-none">
        <Surface style={[styles.pill, styles.fail]} elevation={3} accessibilityRole="alert">
          <Icon source="alert-circle-outline" size={20} color="#B91C1C" />
          <View style={styles.failText}>
            <Text variant="labelLarge" style={styles.failTitle}>
              저장하지 못해 되돌렸습니다{p.failed > 1 ? ` (${p.failed}건)` : ''}
            </Text>
            <Text variant="bodySmall" numberOfLines={3}>
              {p.lastError ?? '다시 시도해 주세요.'}
            </Text>
          </View>
          <Button compact onPress={() => repo?.ackFailures?.()}>
            확인
          </Button>
        </Surface>
      </View>
    );
  }
  if (!busy && !done) return null;
  return (
    <View style={styles.wrap} pointerEvents="none">
      {busy && <ProgressBar indeterminate style={styles.bar} />}
      <Surface style={styles.pill} elevation={2} accessibilityLiveRegion="polite">
        {busy ? <ActivityIndicator size={14} /> : <Icon source="check-circle" size={16} color="#16A34A" />}
        <Text variant="labelMedium">{busy ? `저장 중${p.count > 1 ? ` ${p.count}건` : ''}…` : '저장됨'}</Text>
      </Surface>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', zIndex: 50 },
  // 진행 막대는 맨 위, 알약 표시는 화면 제목을 가리지 않게 머리말 아래
  bar: { height: 3, alignSelf: 'stretch', width: '100%', position: 'absolute', top: 0 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginTop: 60, backgroundColor: '#FFFFFF' },
  fail: { borderWidth: 1, borderColor: '#FCA5A5', maxWidth: 520, marginHorizontal: 12, borderRadius: 14, alignItems: 'flex-start' },
  failText: { flex: 1, minWidth: 0 },
  failTitle: { color: '#B91C1C' },
});
