import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Checkbox, Divider, List, Text } from 'react-native-paper';

import type { MissingItem, Plan, PlanItem } from '@/io/excel/sync';

const STATUS: Record<PlanItem['status'], string> = {
  new: '신규',
  update: '수정',
  same: '변경 없음',
  conflict: '충돌',
  dup: '중복 후보',
  error: '오류',
};

const changeText = (it: PlanItem) => it.changes.map((c) => `${c.field}: ${c.from} → ${c.to}`).join('\n');

/** 엑셀 가져오기 미리보기 (구현계획서 4.6). 반영 전에는 데이터를 바꾸지 않는다 (I-12). */
export function ExcelPreview({
  plan,
  choices,
  setChoice,
  onApply,
  busy,
  header,
}: {
  plan: Plan;
  choices: Record<string, boolean>;
  setChoice: (key: string, v: boolean) => void;
  onApply: () => void;
  busy: boolean;
  header?: string;
}) {
  const [showSame, setShowSame] = useState(false);
  const sheets = [...new Set(plan.items.map((i) => i.sheet).concat(plan.missing.map((m) => m.sheet)))];
  const of = (st: PlanItem['status']) => plan.items.filter((i) => i.status === st);
  const errors = of('error');
  const warnings = plan.items.filter((i) => i.status !== 'error' && i.warnings.length);
  const chosen = plan.items.filter((i) => choices[i.key] && i.status !== 'same' && i.status !== 'error').length + plan.missing.filter((m) => choices[m.key]).length;

  const summary = (sheet: string) => {
    const its = plan.items.filter((i) => i.sheet === sheet);
    const parts = (Object.keys(STATUS) as PlanItem['status'][])
      .map((st) => [STATUS[st], its.filter((i) => i.status === st).length] as const)
      .filter(([, n]) => n > 0)
      .map(([l, n]) => `${l} ${n}`);
    const miss = plan.missing.filter((m) => m.sheet === sheet).length;
    if (miss) parts.push(`파일에 없음 ${miss}`);
    return parts.join(' · ');
  };

  const row = (it: PlanItem, label: string) => (
    <View key={it.key}>
      <Checkbox.Item
        status={choices[it.key] ? 'checked' : 'unchecked'}
        onPress={() => setChoice(it.key, !choices[it.key])}
        position="leading"
        labelStyle={styles.left}
        label={`[${it.sheet} ${it.rowNo}행] ${it.label}\n${label}${it.changes.length ? `\n${changeText(it)}` : ''}`}
      />
      <Divider />
    </View>
  );
  const missRow = (m: MissingItem) => (
    <View key={m.key}>
      <Checkbox.Item
        status={choices[m.key] ? 'checked' : 'unchecked'}
        onPress={() => setChoice(m.key, !choices[m.key])}
        position="leading"
        labelStyle={styles.left}
        label={`[${m.sheet}] ${m.label}\n체크하면 앱에서도 삭제${['payments', 'receipts', 'adjustments'].includes(m.col) ? ' (정정 처리)' : ''}`}
      />
      <Divider />
    </View>
  );

  const section = (title: string, sub: string | undefined, children: React.ReactNode, warn = false) => (
    <Card mode="outlined" style={[styles.card, warn && styles.warn]}>
      <Card.Title title={title} subtitle={sub} titleVariant="titleMedium" subtitleNumberOfLines={2} />
      {children}
    </Card>
  );

  return (
    <View>
      {header && <Text style={styles.header}>{header}</Text>}
      <Card mode="outlined" style={styles.card}>
        <Card.Content style={styles.gap}>
          {sheets.map((s) => (
            <Text key={s}>
              <Text style={styles.bold}>{s}</Text> {summary(s)}
            </Text>
          ))}
          {plan.ignored.length > 0 && <Text style={styles.dim}>무시함: {plan.ignored.join(', ')}</Text>}
        </Card.Content>
      </Card>

      {errors.length > 0 &&
        section(
          `오류 ${errors.length}행 — 가져오지 않음`,
          '고친 뒤 다시 가져오면 됩니다. 나머지 행은 반영할 수 있습니다.',
          errors.map((it) => (
            <List.Item
              key={it.key}
              title={`${it.sheet} ${it.rowNo}행`}
              description={it.errors.join('\n')}
              descriptionNumberOfLines={6}
              left={(p) => <List.Icon {...p} icon="alert-circle-outline" color="#B91C1C" />}
            />
          )),
          true,
        )}

      {of('conflict').length > 0 &&
        section(
          `충돌 ${of('conflict').length}건`,
          '내보낸 뒤 앱에서도 고친 항목입니다. 체크 = 파일 값으로 덮어쓰기, 해제 = 앱 값 유지',
          of('conflict').map((it) => row(it, `충돌 · 지금 앱: ${it.current?.updatedBy ?? ''} ${String(it.current?.updatedAt ?? '').slice(0, 16).replace('T', ' ')}`)),
          true,
        )}

      {(of('new').length > 0 || of('update').length > 0) &&
        section(
          `신규 ${of('new').length} · 수정 ${of('update').length}`,
          '체크를 풀면 그 행은 반영하지 않습니다',
          [...of('update'), ...of('new')].map((it) => row(it, STATUS[it.status])),
        )}

      {of('dup').length > 0 &&
        section(
          `중복 후보 ${of('dup').length}건`,
          '앱에 같은 항목이 이미 있는 것 같습니다. 체크 = 그래도 추가(덮어쓰기), 해제 = 건너뛰기',
          of('dup').map((it) => row(it, `이미 있음: ${it.dupOf?.label ?? ''}`)),
        )}

      {plan.missing.length > 0 &&
        section(`파일에 없음 ${plan.missing.length}건`, '파일에서 지운 행은 자동으로 삭제하지 않습니다', plan.missing.map(missRow))}

      {warnings.length > 0 &&
        section(
          `자동 변환 ${warnings.length}행`,
          '원래 값과 바뀐 값을 확인하세요',
          warnings.map((it) => (
            <List.Item key={it.key} title={`${it.sheet} ${it.rowNo}행 · ${it.label}`} description={it.warnings.join('\n')} descriptionNumberOfLines={6} />
          )),
        )}

      {of('same').length > 0 && (
        <Button compact onPress={() => setShowSame((v) => !v)} style={styles.start}>
          변경 없음 {of('same').length}건 {showSame ? '숨기기' : '보기'}
        </Button>
      )}
      {showSame && (
        <Card mode="outlined" style={styles.card}>
          {of('same').map((it) => (
            <List.Item key={it.key} title={`${it.sheet} · ${it.label}`} titleNumberOfLines={2} />
          ))}
        </Card>
      )}

      <Button mode="contained" icon="check" disabled={busy || chosen === 0} loading={busy} onPress={onApply} style={styles.apply}>
        {chosen}건 반영
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  warn: { borderColor: '#F59E0B' },
  gap: { gap: 4 },
  bold: { fontWeight: '700' },
  dim: { opacity: 0.6, marginTop: 4 },
  left: { textAlign: 'left' },
  header: { marginVertical: 8, opacity: 0.8 },
  start: { alignSelf: 'flex-start', marginBottom: 8 },
  apply: { alignSelf: 'flex-start', marginTop: 4 },
});
