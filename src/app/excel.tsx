import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, HelperText, Snackbar, Text } from 'react-native-paper';
import { ulid } from 'ulid';

import { ExcelPreview } from '@/components/ExcelPreview';
import { Screen } from '@/components/Screen';
import { memberById } from '@/domain/types';
import { applyInChunks, loadAll } from '@/io/backup';
import { SCHEMA } from '@/io/excel/sheets';
import { buildImportOps, defaultChoices, exportTables, type Plan, planImport, refOptions } from '@/io/excel/sync';
import { buildWorkbook, FILE_KIND, readWorkbook } from '@/io/excel/workbook';
import { downloadFile, localTime, MODE_LABEL, pickFiles, stamp, XLSX_MIME } from '@/lib/files';
import { useRepository } from '@/state/RepositoryContext';

/** 엑셀 동기화 파일 (D-11, I-11~I-19). 부모 전용. */
export default function ExcelScreen() {
  const { repo, isChild, settings, writeContext } = useRepository();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [fileNote, setFileNote] = useState('');
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const [snack, setSnack] = useState<{ text: string; undo?: () => void } | null>(null);

  if (isChild) return <Screen><Text>부모만 사용할 수 있습니다.</Text></Screen>;
  if (!repo) return <Screen><Text>더보기 → 저장 모드 연결 후 사용할 수 있습니다.</Text></Screen>;
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

  const doExport = (template: boolean) =>
    run(template ? 'template' : 'export', async () => {
      const data = template ? {} : await loadAll(repo);
      const tables = exportTables(data, { parent: true, template });
      const buf = await buildWorkbook(tables, { exportedAt: localTime(), mode: MODE_LABEL[settings.mode ?? 'demo'], by, template }, refOptions(data));
      downloadFile(buf, template ? '학원노트_빈양식.xlsx' : `학원노트_동기화_${stamp()}.xlsx`, XLSX_MIME);
    });

  const doPick = () =>
    run('import', async () => {
      const [file] = await pickFiles({ accept: '.xlsx,' + XLSX_MIME });
      if (!file) return;
      const { tables, info } = await readWorkbook(await file.arrayBuffer());
      const notes = [file.name];
      if (info.kind === FILE_KIND) notes.push(`내보낸 시각 ${info.exportedAt ?? '?'} · ${info.mode ?? ''} 모드 · ${info.by ?? ''}`);
      else notes.push('앱에서 내보낸 파일이 아닙니다 — 열 제목이 같은 시트만 읽습니다');
      if (info.schema && info.schema > SCHEMA) throw new Error('더 새 버전 앱에서 만든 파일입니다. 앱을 새로고침한 뒤 다시 시도해 주세요.');
      const isSync = info.kind === FILE_KIND && info.purpose !== '빈 양식';
      const p = planImport(tables, await loadAll(repo), { parent: true, newId: ulid, detectMissing: isSync });
      if (p.items.length === 0 && p.missing.length === 0) throw new Error('가져올 행이 없습니다. 예시 행은 가져오지 않으며, 시트 이름(학원·수강·청구 …)과 열 제목이 양식과 같아야 합니다.');
      setFileNote(notes.join('\n'));
      setChoices(defaultChoices(p));
      setPlan(p);
    });

  const doApply = () =>
    run('apply', async () => {
      if (!plan) return;
      // 미리보기 뒤 다른 기기에서 바뀐 것이 있으면 version 확인에서 걸러진다
      const data = await loadAll(repo);
      const r = buildImportOps(plan, choices, data, { by: settings.memberId || 'unknown', now: new Date().toISOString(), newId: ulid });
      if (r.ops.length === 0) throw new Error('반영할 변경이 없습니다');
      const ids = await applyInChunks(repo, r.ops, `엑셀 가져오기: 신규 ${r.counts.create} · 수정 ${r.counts.update}${r.counts.remove ? ` · 삭제 ${r.counts.remove}` : ''}`, writeContext);
      setPlan(null);
      setSnack({
        text: `반영했습니다 — 신규 ${r.counts.create} · 수정 ${r.counts.update} · 삭제 ${r.counts.remove}${r.dropped.length ? ` (참조 대상이 없어 ${r.dropped.length}건 제외)` : ''}`,
        undo: () =>
          void (async () => {
            for (const id of [...ids].reverse()) await repo.revertBatch(id, writeContext('엑셀 가져오기 되돌리기'));
            setSnack({ text: '되돌렸습니다' });
          })(),
      });
    });

  return (
    <View style={styles.fill}>
      <Screen wide>
        <Card mode="outlined" style={styles.card}>
          <Card.Title title="내보내기" subtitle="지금 데이터를 엑셀 파일로 받아 PC에서 고친 뒤 다시 가져올 수 있습니다" subtitleNumberOfLines={2} titleVariant="titleMedium" />
          <Card.Content style={styles.gap}>
            <Text variant="bodySmall" style={styles.dim}>
              학원·수강·요금·청구·납부·환불·지출·일정·방학 시트가 들어갑니다. 숨김 열(ID·version)은 그대로 두세요. 편집은 PC 엑셀을 권장합니다.
            </Text>
            <View style={styles.row}>
              <Button mode="contained" icon="microsoft-excel" loading={busy === 'export'} disabled={!!busy} onPress={() => void doExport(false)}>
                동기화 파일 받기
              </Button>
              <Button mode="outlined" icon="file-outline" loading={busy === 'template'} disabled={!!busy} onPress={() => void doExport(true)}>
                빈 양식 받기
              </Button>
            </View>
          </Card.Content>
        </Card>

        <Card mode="outlined" style={styles.card}>
          <Card.Title title="가져오기" subtitle="바뀐 행만 반영합니다. 반영 전에 미리보기로 확인합니다" subtitleNumberOfLines={2} titleVariant="titleMedium" />
          <Card.Content style={styles.gap}>
            <Text variant="bodySmall" style={styles.dim}>
              파일은 이 기기에서만 읽고 어디에도 올리지 않습니다. 반영 후 [되돌리기]로 취소할 수 있습니다.
            </Text>
            <Button mode="contained-tonal" icon="upload" loading={busy === 'import'} disabled={!!busy} onPress={() => void doPick()} style={styles.start}>
              엑셀 파일 선택
            </Button>
          </Card.Content>
        </Card>
        {error ? <HelperText type="error">{error}</HelperText> : null}

        {plan && (
          <ExcelPreview
            plan={plan}
            header={fileNote}
            choices={choices}
            setChoice={(k, v) => setChoices((c) => ({ ...c, [k]: v }))}
            busy={busy === 'apply'}
            onApply={() => void doApply()}
          />
        )}
        <View style={{ height: 40 }} />
      </Screen>
      <Snackbar
        visible={!!snack}
        onDismiss={() => setSnack(null)}
        duration={snack?.undo ? 10000 : 4000}
        action={snack?.undo ? { label: '되돌리기', onPress: () => snack.undo?.() } : undefined}>
        {snack?.text}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  card: { marginVertical: 8 },
  gap: { gap: 8 },
  dim: { opacity: 0.7 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  start: { alignSelf: 'flex-start' },
});
