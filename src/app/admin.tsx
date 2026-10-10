import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, HelperText, Snackbar, Text, TextInput } from 'react-native-paper';

import { MigratePanel } from '@/components/MigratePanel';
import { Screen } from '@/components/Screen';
import { memberById } from '@/domain/types';
import { type AllData, applyInChunks, type BackupFile, countDocs, loadAll, makeBackup, parseBackup, resetOps, restoreOps } from '@/io/backup';
import { downloadFile, localTime, MODE_LABEL, pickFiles, stamp } from '@/lib/files';
import { useRepository } from '@/state/RepositoryContext';

const CONFIRM_WORD = '초기화';

/**
 * 관리자 (부모 전용): 전체 백업(JSON)·복원 (I-20), 데이터 초기화.
 * 복원·초기화 전에는 항상 현재 데이터를 백업 파일로 먼저 받는다.
 * 저장 모드 연결(토큰 등 이 기기 설정)은 건드리지 않는다.
 */
export default function AdminScreen() {
  const { repo, isChild, settings, writeContext } = useRepository();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [snack, setSnack] = useState('');
  const [counts, setCounts] = useState<number | null>(null);
  const [confirm, setConfirm] = useState('');
  const [restore, setRestore] = useState<{ name: string; file: BackupFile } | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState('');

  if (isChild) return <Screen><Text>부모만 사용할 수 있습니다.</Text></Screen>;
  if (!repo) return <Screen><Text>더보기 → 저장 모드 연결 후 사용할 수 있습니다.</Text></Screen>;
  const mode = MODE_LABEL[settings.mode ?? 'demo'];
  const by = memberById(settings.memberId)?.name ?? settings.memberId;

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

  const saveBackup = (data: AllData, tag: string) => {
    const file = makeBackup(data, { exportedAt: localTime(), mode, by });
    downloadFile(JSON.stringify(file, null, 1), `학원노트_백업_${tag}${stamp()}.json`, 'application/json');
  };

  const doBackup = () =>
    run('backup', async () => {
      const data = await loadAll(repo);
      saveBackup(data, '');
      setCounts(countDocs(data));
      setSnack(`백업 파일을 받았습니다 (${countDocs(data)}건)`);
    });

  const doCount = () => run('count', async () => setCounts(countDocs(await loadAll(repo))));

  const doReset = () =>
    run('reset', async () => {
      const data = await loadAll(repo);
      const n = countDocs(data);
      if (n === 0) {
        setSnack('지울 데이터가 없습니다');
        return;
      }
      saveBackup(data, '초기화전_');
      await applyInChunks(repo, resetOps(data), `데이터 초기화 (${n}건 삭제)`, writeContext);
      setConfirm('');
      setCounts(0);
      setSnack(`초기화했습니다 — ${n}건 삭제. 직전 백업 파일을 받아 두었습니다.`);
    });

  const pickRestore = () =>
    run('pick', async () => {
      const [f] = await pickFiles({ accept: '.json,application/json' });
      if (!f) return;
      setRestore({ name: f.name, file: parseBackup(await f.text()) });
      setRestoreConfirm('');
    });

  const doRestore = () =>
    run('restore', async () => {
      if (!restore) return;
      const data = await loadAll(repo);
      if (countDocs(data) > 0) saveBackup(data, '복원전_');
      const ops = restoreOps(data, restore.file.data);
      await applyInChunks(repo, ops, `백업 복원: ${restore.file.exportedAt} (${countDocs(restore.file.data)}건)`, writeContext);
      setSnack(`복원했습니다 — ${countDocs(restore.file.data)}건`);
      setRestore(null);
      setCounts(countDocs(restore.file.data));
    });

  return (
    <View style={styles.fill}>
      <Screen wide>
        <Text variant="bodyMedium" style={styles.dim}>
          지금 연결: {mode} 모드{settings.mode === 'github' ? ` (${settings.github.owner}/${settings.github.repo})` : ''} · 사용자 {by}
          {counts != null ? ` · 데이터 ${counts}건` : ''}
        </Text>
        {counts == null && (
          <Button compact style={styles.start} onPress={() => void doCount()} loading={busy === 'count'}>
            데이터 건수 확인
          </Button>
        )}

        <Card mode="outlined" style={styles.card}>
          <Card.Title title="전체 백업 (JSON)" subtitle="가족 전체 데이터를 파일 하나로 받습니다. 복원용" subtitleNumberOfLines={2} titleVariant="titleMedium" />
          <Card.Content style={styles.gap}>
            <Text variant="bodySmall" style={styles.dim}>
              엑셀에 없는 항목(이름 연결 등)까지 들어갑니다. 토큰·기기 설정은 들어가지 않습니다. 실데이터가 들어 있으니 공개된 곳에 올리지 마세요.
            </Text>
            <Button mode="contained" icon="content-save-outline" loading={busy === 'backup'} disabled={!!busy} onPress={() => void doBackup()} style={styles.start}>
              백업 파일 받기
            </Button>
          </Card.Content>
        </Card>

        <Card mode="outlined" style={styles.card}>
          <Card.Title title="백업에서 복원" subtitle="지금 데이터를 백업 파일 내용으로 전체 교체합니다" subtitleNumberOfLines={2} titleVariant="titleMedium" />
          <Card.Content style={styles.gap}>
            <Button mode="outlined" icon="folder-open-outline" loading={busy === 'pick'} disabled={!!busy} onPress={() => void pickRestore()} style={styles.start}>
              백업 파일 선택
            </Button>
            {restore && (
              <>
                <Text>
                  {restore.name}
                  {'\n'}백업 시각 {restore.file.exportedAt} · {restore.file.mode} 모드 · {restore.file.by} · {countDocs(restore.file.data)}건
                </Text>
                <Text variant="bodySmall" style={styles.warnText}>
                  지금 데이터는 지워지고 백업 내용으로 바뀝니다. 실행 전에 지금 데이터를 백업 파일로 자동으로 받습니다.
                </Text>
                <TextInput mode="outlined" dense label={`확인: '복원' 입력`} value={restoreConfirm} onChangeText={setRestoreConfirm} style={styles.confirm} />
                <View style={styles.row}>
                  <Button onPress={() => setRestore(null)}>취소</Button>
                  <Button mode="contained" icon="backup-restore" disabled={restoreConfirm.trim() !== '복원' || !!busy} loading={busy === 'restore'} onPress={() => void doRestore()}>
                    복원
                  </Button>
                </View>
              </>
            )}
          </Card.Content>
        </Card>

        <MigratePanel />

        <Card mode="outlined" style={[styles.card, styles.danger]}>
          <Card.Title title="데이터 초기화" titleStyle={styles.dangerTitle} subtitle="가족 데이터를 모두 지우고 처음부터 시작합니다" subtitleNumberOfLines={2} titleVariant="titleMedium" />
          <Card.Content style={styles.gap}>
            <Text variant="bodySmall">
              학원·수강·일정·청구·납부·환불·지출·이름 연결 등 <Text style={styles.bold}>{mode} 모드의 모든 데이터</Text>를 지웁니다. 저장 모드 연결과 이 기기 설정은 그대로입니다.
              {settings.mode === 'github' ? ' GitHub 저장소에는 커밋 기록이 남아 있어 필요하면 되살릴 수 있습니다.' : ''}
            </Text>
            <Text variant="bodySmall" style={styles.warnText}>
              실행하면 먼저 지금 데이터를 백업 파일(학원노트_백업_초기화전_….json)로 받습니다. 지운 뒤에도 [백업에서 복원]으로 되돌릴 수 있습니다.
            </Text>
            <TextInput mode="outlined" dense label={`확인: '${CONFIRM_WORD}' 입력`} value={confirm} onChangeText={setConfirm} style={styles.confirm} />
            <Button
              mode="contained"
              buttonColor="#B91C1C"
              icon="delete-forever-outline"
              disabled={confirm.trim() !== CONFIRM_WORD || !!busy}
              loading={busy === 'reset'}
              onPress={() => void doReset()}
              style={styles.start}>
              백업 받고 초기화
            </Button>
          </Card.Content>
        </Card>
        {error ? <HelperText type="error">{error}</HelperText> : null}
        <View style={{ height: 40 }} />
      </Screen>
      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={6000}>
        {snack}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  card: { marginVertical: 8 },
  gap: { gap: 8 },
  dim: { opacity: 0.7 },
  bold: { fontWeight: '700' },
  start: { alignSelf: 'flex-start' },
  row: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  confirm: { maxWidth: 260 },
  danger: { borderColor: '#B91C1C' },
  dangerTitle: { color: '#B91C1C' },
  warnText: { color: '#B45309' },
});
