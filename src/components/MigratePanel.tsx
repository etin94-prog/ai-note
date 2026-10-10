import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Checkbox, DataTable, HelperText, Text } from 'react-native-paper';

import { countDocs, loadAll, makeBackup } from '@/io/backup';
import { type MigrateResult, migrate } from '@/io/migrate';
import { downloadFile, localTime, MODE_LABEL, stamp } from '@/lib/files';
import { buildRepo, useRepository } from '@/state/RepositoryContext';
import type { StorageMode } from '@/state/settings';

/**
 * 저장 모드 이동 (D-M2, D-M3): 지금 모드의 데이터를 다른 모드로 전체 복사 + 대조표.
 * 대상 연결 정보(토큰·가족 ID)는 저장 모드 화면에 이미 입력된 값을 쓴다.
 */
export function MigratePanel() {
  const { repo, settings, updateSettings, writeContext } = useRepository();
  const [target, setTarget] = useState<StorageMode | null>(null);
  const [targetCount, setTargetCount] = useState<number | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<MigrateResult | null>(null);

  const modes: { mode: StorageMode; ready: boolean; why: string }[] = [
    { mode: 'github', ready: !!settings.github.token, why: '저장 모드 화면에서 GitHub 토큰을 먼저 입력' },
    { mode: 'firebase', ready: !!settings.firebase.familyId && !!buildRepo({ ...settings, mode: 'firebase' }), why: 'Firebase 설정(가이드 2단계) 후 사용' },
    { mode: 'demo', ready: true, why: '' },
  ];
  const choices = modes.filter((m) => m.mode !== settings.mode);
  const targetRepo = () => (target ? buildRepo({ ...settings, mode: target }) : null);

  const run = async (what: string, f: () => Promise<void>) => {
    setBusy(what);
    setError('');
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const pick = (m: StorageMode) =>
    run('check', async () => {
      setTarget(m);
      setResult(null);
      setOverwrite(false);
      const t = buildRepo({ ...settings, mode: m });
      if (!t) throw new Error('대상 모드에 연결할 수 없습니다');
      setTargetCount(countDocs(await loadAll(t)));
    });

  const start = () =>
    run('migrate', async () => {
      const t = targetRepo();
      if (!repo || !t || !target) return;
      if (targetCount && targetCount > 0) {
        // D-M3: 덮어쓰기 전 대상 백업
        const data = await loadAll(t);
        downloadFile(JSON.stringify(makeBackup(data, { exportedAt: localTime(), mode: MODE_LABEL[target], by: settings.memberId }), null, 1), `학원노트_백업_이동전_${MODE_LABEL[target]}_${stamp()}.json`, 'application/json');
      }
      setResult(await migrate(repo, t, { overwrite, ctxOf: writeContext }));
      setTargetCount(null);
    });

  return (
    <Card mode="outlined" style={styles.card}>
      <Card.Title title="저장 모드 이동" subtitle={`${MODE_LABEL[settings.mode ?? 'demo']} 모드 데이터를 다른 모드로 전체 복사`} subtitleNumberOfLines={2} titleVariant="titleMedium" />
      <Card.Content style={styles.gap}>
        <View style={styles.row}>
          {choices.map((m) => (
            <Button
              key={m.mode}
              mode={target === m.mode ? 'contained' : 'outlined'}
              compact
              disabled={!m.ready || !!busy}
              loading={busy === 'check' && target === m.mode}
              onPress={() => void pick(m.mode)}>
              → {MODE_LABEL[m.mode]}
            </Button>
          ))}
        </View>
        {choices
          .filter((m) => !m.ready)
          .map((m) => (
            <Text key={m.mode} variant="bodySmall" style={styles.dim}>
              {MODE_LABEL[m.mode]}: {m.why}
            </Text>
          ))}
        {target && targetCount != null && (
          <>
            {targetCount === 0 ? (
              <Text>대상({MODE_LABEL[target]})이 비어 있습니다. 그대로 복사합니다.</Text>
            ) : (
              <Checkbox.Item
                status={overwrite ? 'checked' : 'unchecked'}
                onPress={() => setOverwrite(!overwrite)}
                position="leading"
                labelStyle={styles.left}
                label={`대상에 이미 ${targetCount}건이 있습니다. 대상 백업 파일을 받은 뒤 지금 데이터로 덮어씁니다 (합치지 않음)`}
              />
            )}
            <Button
              mode="contained"
              icon="database-arrow-right-outline"
              style={styles.start}
              disabled={!!busy || (targetCount > 0 && !overwrite)}
              loading={busy === 'migrate'}
              onPress={() => void start()}>
              {MODE_LABEL[target]}(으)로 복사
            </Button>
          </>
        )}
        {result && target && (
          <>
            <Text variant="titleSmall" style={{ color: result.ok ? '#15803D' : '#B91C1C' }}>
              {result.ok ? `복사 완료 · ${result.copied}건 · 대조 모두 일치` : '복사했지만 대조에서 차이가 있습니다 — 아래 표를 확인하세요'}
            </Text>
            <DataTable>
              <DataTable.Header>
                <DataTable.Title>항목</DataTable.Title>
                <DataTable.Title numeric>지금</DataTable.Title>
                <DataTable.Title numeric>대상</DataTable.Title>
              </DataTable.Header>
              {result.rows.map((r) => (
                <DataTable.Row key={r.label}>
                  <DataTable.Cell>{`${r.ok ? '✓' : '✗'} ${r.label}`}</DataTable.Cell>
                  <DataTable.Cell numeric>{r.source}</DataTable.Cell>
                  <DataTable.Cell numeric>{r.target}</DataTable.Cell>
                </DataTable.Row>
              ))}
            </DataTable>
            {result.ok && (
              <Button mode="outlined" icon="swap-horizontal" style={styles.start} onPress={() => updateSettings({ ...settings, mode: target })}>
                이 기기를 {MODE_LABEL[target]} 모드로 전환
              </Button>
            )}
          </>
        )}
        {error ? <HelperText type="error">{error}</HelperText> : null}
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginVertical: 8 },
  gap: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dim: { opacity: 0.65 },
  left: { textAlign: 'left' },
  start: { alignSelf: 'flex-start' },
});
