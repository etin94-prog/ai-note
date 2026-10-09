import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Chip } from 'react-native-paper';

import type { PendingState } from '@/data/repository';
import { useRepository } from '@/state/RepositoryContext';

/** 동기화 상태 표시 (X-14): 오프라인 / 전송 대기 n건 / 완료 */
export function SyncIndicator() {
  const { repo, settings, syncError, refresh } = useRepository();
  const [pending, setPending] = useState<PendingState>({ count: 0, failed: 0, online: true });

  useEffect(() => repo?.pending(setPending), [repo]);

  if (!repo) {
    return (
      <View style={styles.row}>
        <Chip icon="database-off-outline" compact>
          저장 모드 미설정
        </Chip>
      </View>
    );
  }

  const label = syncError
    ? '동기화 오류'
    : !pending.online
      ? '오프라인'
      : pending.count > 0
        ? `전송 중 ${pending.count}건`
        : settings.mode === 'github'
          ? 'GitHub 동기화 완료'
          : settings.mode === 'demo'
            ? '체험 모드 (이 기기에만)'
            : 'Firebase 연결됨';
  const icon = syncError ? 'alert-circle-outline' : pending.count > 0 ? 'cloud-upload-outline' : 'cloud-check-outline';

  return (
    <View style={styles.row}>
      <Chip icon={icon} compact onPress={() => void refresh()}>
        {label}
      </Chip>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 8 },
});
