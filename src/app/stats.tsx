import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Card, SegmentedButtons, Text } from 'react-native-paper';

import { Screen } from '@/components/Screen';
import { today } from '@/domain/dates';
import { type GroupTotal, monthlySeries, totalsBy } from '@/domain/insights';
import { won } from '@/domain/money';
import { memberById } from '@/domain/types';
import { NUM, PALETTE } from '@/lib/theme';
import { useRepository } from '@/state/RepositoryContext';
import { useMoney } from '@/state/useMoney';

const BAR_H = 140;

/** 통계 (F-25): 최근 12개월 추이, 올해 누적, 자녀별·학원별 합계. 부모 전용. */
export default function StatsScreen() {
  const { repo, isChild } = useRepository();
  const money = useMoney();
  const now = today().slice(0, 7);
  const year = now.slice(0, 4);
  const [range, setRange] = useState<'year' | '12'>('year');
  const [picked, setPicked] = useState<string | null>(null);

  const series = useMemo(() => monthlySeries(now, 12, money.rows, money.payments, money.receipts, money.expenses), [now, money]);
  const from = range === 'year' ? `${year}-01` : series[0].period;
  const inRange = series.filter((p) => p.period >= from);
  const total = inRange.reduce((t, p) => ({ billed: t.billed + p.billed, paid: t.paid + p.paid, cashOut: t.cashOut + p.cashOut, expenses: t.expenses + p.expenses }), {
    billed: 0,
    paid: 0,
    cashOut: 0,
    expenses: 0,
  });
  const byChild = useMemo(() => totalsBy(money.rows, from, now, (b) => b.childId), [money.rows, from, now]);
  const byAcademy = useMemo(() => totalsBy(money.rows, from, now, (b) => b.academyId || b.title), [money.rows, from, now]);

  if (isChild) return <Screen><Text>부모만 사용할 수 있습니다.</Text></Screen>;
  if (!repo) return <Screen><Text>더보기 → 저장 모드 연결 후 사용할 수 있습니다.</Text></Screen>;

  const max = Math.max(1, ...series.map((p) => Math.max(p.billed, p.cashOut)));
  const sel = series.find((p) => p.period === picked) ?? series[series.length - 1];
  const months = inRange.filter((p) => p.billed > 0 || p.cashOut > 0).length || 1;
  const acName = (id: string) => money.academies.find((a) => a.id === id)?.name ?? id;

  const group = (title: string, rows: GroupTotal[], nameOf: (k: string) => string, colorOf?: (k: string) => string | undefined) => (
    <Card mode="outlined" style={styles.card}>
      <Card.Content style={styles.gap}>
        <Text variant="titleSmall" style={styles.bold}>
          {title}
        </Text>
        {rows.length === 0 && <Text style={styles.dim}>이 기간 청구가 없습니다.</Text>}
        {rows.map((r) => (
          <View key={r.key}>
            <View style={styles.between}>
              <Text numberOfLines={1} style={styles.flex}>
                {nameOf(r.key)}
              </Text>
              <Text style={[styles.bold, NUM]}>{won(r.billed)}</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fillBar, { width: `${Math.round((r.billed / Math.max(1, rows[0].billed)) * 100)}%`, backgroundColor: colorOf?.(r.key) ?? '#2563EB' }]} />
            </View>
            <Text variant="labelSmall" style={styles.dim}>
              납부 {won(r.paid)} · 전체의 {Math.round((r.billed / Math.max(1, total.billed)) * 100)}%
            </Text>
          </View>
        ))}
      </Card.Content>
    </Card>
  );

  return (
    <Screen wide>
      <SegmentedButtons
        value={range}
        onValueChange={(v) => setRange(v as 'year' | '12')}
        buttons={[
          { value: 'year', label: `${year}년` },
          { value: '12', label: '최근 12개월' },
        ]}
        style={styles.seg}
      />

      <View style={styles.tiles}>
        {(
          [
            ['청구 합계', total.billed],
            ['납부 합계', total.paid],
            ['실제 지출', total.cashOut],
            ['월 평균 지출', Math.round(total.cashOut / months)],
          ] as const
        ).map(([label, v]) => (
          <View key={label} style={styles.tile}>
            <Text variant="labelMedium" style={styles.sub}>
              {label}
            </Text>
            <Text variant="titleLarge" style={[styles.bold, NUM]}>
              {won(v)}
            </Text>
          </View>
        ))}
      </View>

      <Card mode="outlined" style={styles.card}>
        <Card.Content>
          <View style={styles.between}>
            <Text variant="titleSmall" style={styles.bold}>
              월별 추이
            </Text>
            <View style={styles.legend}>
              <View style={[styles.swatch, styles.barBilled]} />
              <Text variant="labelSmall" style={styles.dim}>
                청구
              </Text>
              <View style={[styles.swatch, styles.barCash]} />
              <Text variant="labelSmall" style={styles.dim}>
                실제 지출 · 막대를 누르면 그 달
              </Text>
            </View>
          </View>
          <View style={styles.chart} accessibilityLabel="월별 청구와 실제 지출 막대 그래프">
            {series.map((p) => {
              const on = p.period === sel.period;
              const faded = p.period < from;
              return (
                <Pressable
                  key={p.period}
                  style={[styles.col, faded && styles.faded]}
                  onPress={() => setPicked(p.period)}
                  accessibilityRole="button"
                  accessibilityLabel={`${Number(p.period.slice(5))}월 청구 ${won(p.billed)}, 실제 지출 ${won(p.cashOut)}`}>
                  <View style={styles.bars}>
                    <View style={[styles.bar, styles.barBilled, { height: Math.max(2, (p.billed / max) * BAR_H) }, on && styles.barOn]} />
                    <View style={[styles.bar, styles.barCash, { height: Math.max(2, (Math.max(0, p.cashOut) / max) * BAR_H) }]} />
                  </View>
                  <Text variant="labelSmall" style={[styles.month, on && styles.monthOn]}>
                    {Number(p.period.slice(5))}월
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.selLine}>
            <Text style={styles.bold}>
              {sel.period.slice(0, 4)}년 {Number(sel.period.slice(5))}월
            </Text>{' '}
            청구 {won(sel.billed)} · 납부 {won(sel.paid)} · 실제 지출 {won(sel.cashOut)}
            {sel.expenses ? ` (기타 ${won(sel.expenses)} 포함)` : ''}
          </Text>
        </Card.Content>
      </Card>

      <View style={styles.groups}>
        <View style={styles.groupCol}>
          {group(
            '자녀별',
            byChild,
            (k) => (k === 'common' ? '공통' : (memberById(k)?.name ?? k)),
            (k) => memberById(k)?.color,
          )}
        </View>
        <View style={styles.groupCol}>{group('학원별', byAcademy, acName)}</View>
      </View>
      <Text variant="bodySmall" style={styles.dim}>
        청구·납부는 대상 월 기준, 실제 지출은 돈이 나간 날 기준(납부 − 환불 수령 + 기타 지출)입니다.
      </Text>
      <View style={{ height: 40 }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  seg: { maxWidth: 360, marginBottom: 12 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  tile: { flexGrow: 1, flexBasis: 150, backgroundColor: PALETTE.card, borderRadius: 16, borderWidth: 1, borderColor: PALETTE.line, padding: 14, gap: 2 },
  sub: { color: PALETTE.sub },
  card: { marginBottom: 12 },
  gap: { gap: 12 },
  bold: { fontWeight: '700' },
  dim: { opacity: 0.65 },
  flex: { flex: 1 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginTop: 12, height: BAR_H + 22 },
  col: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  faded: { opacity: 0.35 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: BAR_H },
  bar: { width: 8, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  barBilled: { backgroundColor: '#C7D7F8' },
  barOn: { backgroundColor: '#93B4F5' },
  barCash: { backgroundColor: '#2563EB' },
  month: { marginTop: 4, color: PALETTE.sub },
  monthOn: { color: '#2563EB', fontWeight: '700' },
  selLine: { marginTop: 10 },
  track: { height: 8, borderRadius: 4, backgroundColor: '#E8ECF2', overflow: 'hidden', marginVertical: 4 },
  fillBar: { height: 8, borderRadius: 4 },
  groups: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  groupCol: { flexGrow: 1, flexBasis: 300, minWidth: 0 },
});
