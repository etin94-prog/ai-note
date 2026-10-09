import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Chip, FAB, IconButton, List, Snackbar, Text } from 'react-native-paper';

import { BillBadge } from '@/components/BillBadge';
import { MemberFilter } from '@/components/MemberChips';
import { goPay, PaymentDialog } from '@/components/PaymentDialog';
import { Screen } from '@/components/Screen';
import { formatDate, today } from '@/domain/dates';
import { addMonths, monthSummary, todoItems, won } from '@/domain/money';
import { CHILDREN, memberById, type MemberId, PARENTS } from '@/domain/types';
import { useRepository } from '@/state/RepositoryContext';
import { type BillRow, useEnsureBills, useMoney } from '@/state/useMoney';

/** 비용 홈 (F-V1, F-V2): 이달 요약 + 처리 필요(월 무관) + 월별 청구 + 기타 지출. 부모 전용 */
export default function CostScreen() {
  const { repo, isChild, writeContext } = useRepository();
  useEnsureBills();
  const money = useMoney();
  const [period, setPeriod] = useState(today().slice(0, 7));
  const [child, setChild] = useState<MemberId | 'all'>('all');
  const [payer, setPayer] = useState<MemberId | 'all'>('all');
  const [paying, setPaying] = useState<BillRow | null>(null);
  const [snack, setSnack] = useState<{ text: string; undo?: () => void } | null>(null);
  const [fabOpen, setFabOpen] = useState(false);

  const t = today();
  const filtered = useMemo(
    () =>
      money.rows.filter(
        (r) => (child === 'all' || r.bill.childId === child) && (payer === 'all' || r.bill.payer === payer),
      ),
    [money.rows, child, payer],
  );
  const summary = useMemo(
    () => monthSummary(period, filtered, money.payments, money.receipts, money.expenses.filter((e) => child === 'all' || e.childId === child)),
    [period, filtered, money.payments, money.receipts, money.expenses, child],
  );
  const todos = useMemo(() => todoItems(filtered, t), [filtered, t]);
  const monthRows = filtered
    .filter((r) => r.bill.period === period)
    .sort((a, b) => (a.bill.childId === b.bill.childId ? (a.bill.dueDate < b.bill.dueDate ? -1 : 1) : a.bill.childId < b.bill.childId ? -1 : 1));
  const monthExpenses = money.expenses
    .filter((e) => e.date.startsWith(period) && (child === 'all' || e.childId === child))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  if (isChild) {
    return (
      <Screen>
        <Text>비용 정보는 부모만 볼 수 있습니다.</Text>
      </Screen>
    );
  }

  const pay = async (r: BillRow) => {
    const info = money.paymentInfos.find((i) => i.id === r.bill.academyId);
    setSnack({ text: await goPay(info, r.bill) });
  };

  const billRow = (r: BillRow) => {
    const s = r.state;
    const open = s.remaining > 0 && s.status !== '취소' && s.status !== '환불진행' && s.status !== '환불완료';
    const extra = s.status === '미납' ? `D+${Math.max(0, Math.round((Date.parse(t) - Date.parse(r.bill.dueDate)) / 864e5))}` : '';
    return (
      <View key={r.id} style={styles.billRow}>
        <List.Item
          style={styles.item}
          onPress={() => router.push({ pathname: '/bill', params: { id: r.id } })}
          title={`${r.bill.title}  ${won(s.due)}`}
          titleStyle={r.bill.cancelled ? styles.strike : undefined}
          description={`기한 ${formatDate(r.bill.dueDate)} · ${memberById(r.bill.payer)?.name}${s.paid ? ` · 납부 ${won(s.paid)}` : ''}${r.bill.needsReview ? ' · 금액 확인 필요' : ''}`}
          right={() => <BillBadge status={s.status} extra={extra} />}
        />
        {open && (
          <View style={styles.actions}>
            <Button compact icon="open-in-new" onPress={() => void pay(r)}>
              납부하러 가기
            </Button>
            <Button compact mode="contained-tonal" icon="check" onPress={() => setPaying(r)}>
              납부 기록
            </Button>
          </View>
        )}
      </View>
    );
  };

  const childGroups: (MemberId | 'common')[] = ['son', 'daughter', 'common'];
  const label = `${Number(period.slice(5))}월분`;

  return (
    <View style={styles.fill}>
      <Screen>
        <View style={styles.nav}>
          <IconButton icon="chevron-left" onPress={() => setPeriod(addMonths(period, -1))} />
          <Button compact onPress={() => setPeriod(today().slice(0, 7))}>
            {period.slice(0, 4)}년 {label}
          </Button>
          <IconButton icon="chevron-right" onPress={() => setPeriod(addMonths(period, 1))} />
        </View>
        <MemberFilter value={child} onChange={setChild} members={CHILDREN} />
        <View style={styles.chips}>
          <Text variant="labelMedium" style={styles.dim}>
            담당
          </Text>
          {(['all', ...PARENTS.map((p) => p.id)] as const).map((p) => (
            <Chip key={p} compact selected={payer === p} showSelectedOverlay onPress={() => setPayer(p)}>
              {p === 'all' ? '전체' : memberById(p)?.name}
            </Chip>
          ))}
        </View>

        <Card mode="outlined" style={styles.card}>
          <Card.Title title={`${label} 학원비`} titleVariant="titleMedium" />
          <Card.Content>
            <View style={styles.sumRow}>
              <Sum label="청구" value={summary.billed} />
              <Sum label="납부" value={summary.paid} color="#16A34A" />
              <Sum label="남은 금액" value={summary.remaining} color={summary.overdue ? '#DC2626' : undefined} sub={summary.overdue ? `연체 ${won(summary.overdue)}` : undefined} />
            </View>
            <View style={styles.sumRow}>
              <Sum label="환불 미수령(전체)" value={summary.refundOpen} color={summary.refundOpen ? '#7C3AED' : undefined} />
              <Sum label="이달 실제 지출" value={summary.cashOut} sub={summary.expenses ? `기타 ${won(summary.expenses)} 포함` : undefined} />
            </View>
          </Card.Content>
        </Card>

        {todos.length > 0 && (
          <Card mode="outlined" style={[styles.card, styles.todo]}>
            <Card.Title title={`⚠ 처리 필요 (${todos.length})`} titleVariant="titleMedium" subtitle="지난달 것도 포함" />
            {todos.map((td) => {
              const row = money.rows.find((r) => r.id === td.billId)!;
              return (
                <View key={`${td.kind}-${td.billId}`} style={styles.billRow}>
                  <List.Item
                    style={styles.item}
                    onPress={() => router.push({ pathname: '/bill', params: { id: td.billId } })}
                    title={`${memberById(td.childId as MemberId)?.name ?? '공통'} ${td.title} ${won(td.amount)}`}
                    description={`${td.text} · 담당 ${memberById(td.payer)?.name}`}
                    titleStyle={td.kind === 'overdue' ? styles.red : td.kind === 'refund' ? styles.purple : undefined}
                  />
                  {(td.kind === 'overdue' || td.kind === 'dueSoon') && (
                    <View style={styles.actions}>
                      <Button compact icon="open-in-new" onPress={() => void pay(row)}>
                        납부하러 가기
                      </Button>
                      <Button compact mode="contained-tonal" icon="check" onPress={() => setPaying(row)}>
                        납부 기록
                      </Button>
                    </View>
                  )}
                </View>
              );
            })}
          </Card>
        )}

        {monthRows.length === 0 && money.loaded && (
          <Card mode="outlined" style={styles.card}>
            <Card.Content>
              <Text>{label} 청구가 없습니다.</Text>
              <Text style={styles.dim}>학원·수강 화면에서 월 수강료를 입력하면 매달 청구가 자동으로 만들어집니다. 특강·교재는 [+ 청구]로 추가하세요.</Text>
            </Card.Content>
          </Card>
        )}
        {childGroups.map((c) => {
          const rows = monthRows.filter((r) => r.bill.childId === c);
          if (!rows.length) return null;
          return (
            <Card key={c} mode="outlined" style={styles.card}>
              <Card.Title title={c === 'common' ? '공통' : memberById(c)?.name} titleVariant="titleSmall" />
              {rows.map(billRow)}
            </Card>
          );
        })}

        {monthExpenses.length > 0 && (
          <Card mode="outlined" style={styles.card}>
            <Card.Title title={`기타 지출 ${won(summary.expenses)}`} titleVariant="titleSmall" />
            {monthExpenses.map((e) => (
              <List.Item
                key={e.id}
                style={styles.item}
                title={`${e.category} ${won(e.amount)}`}
                description={`${formatDate(e.date)} · ${e.childId === 'common' ? '공통' : memberById(e.childId)?.name}${e.memo ? ` · ${e.memo}` : ''}`}
                onPress={() => router.push({ pathname: '/expense', params: { id: e.id } })}
              />
            ))}
          </Card>
        )}
        <View style={{ height: 90 }} />
      </Screen>

      <PaymentDialog
        target={paying}
        onDismiss={() => setPaying(null)}
        onSaved={(id, lbl) => {
          setPaying(null);
          setSnack({
            text: `${lbl.replace('납부 기록: ', '')} 기록됨`,
            // 실행 취소: 방금 만든 기록 1건만 (F-06)
            undo: () => void repo?.remove('payments', id, 1, writeContext(`납부 기록 실행 취소`)),
          });
        }}
      />
      {repo && (
        // Portal 로 띄우면 다른 탭에서도 남으므로 화면 안에 둔다
        <FAB.Group
          open={fabOpen}
          visible
          icon={fabOpen ? 'close' : 'plus'}
          actions={[
            { icon: 'cart-outline', label: '기타 지출', onPress: () => router.push('/expense') },
            { icon: 'receipt-text-plus-outline', label: '청구 추가 (특강·교재)', onPress: () => router.push({ pathname: '/bill', params: { period } }) },
          ]}
          onStateChange={({ open }) => setFabOpen(open)}
        />
      )}
      <Snackbar
        visible={!!snack}
        onDismiss={() => setSnack(null)}
        duration={snack?.undo ? 5000 : 4000}
        action={snack?.undo ? { label: '실행 취소', onPress: () => snack.undo?.() } : undefined}>
        {snack?.text}
      </Snackbar>
    </View>
  );
}

function Sum({ label, value, color, sub }: { label: string; value: number; color?: string; sub?: string }) {
  return (
    <View style={styles.sum}>
      <Text variant="labelSmall" style={styles.dim}>
        {label}
      </Text>
      <Text variant="titleMedium" style={color ? { color, fontWeight: '700' } : { fontWeight: '700' }}>
        {won(value)}
      </Text>
      {sub ? (
        <Text variant="labelSmall" style={color ? { color } : styles.dim}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 6 },
  card: { marginBottom: 10 },
  todo: { borderColor: '#F59E0B' },
  sumRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  sum: { flex: 1 },
  dim: { opacity: 0.65 },
  billRow: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#E5E7EB' },
  item: { paddingVertical: 2 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
  strike: { textDecorationLine: 'line-through', opacity: 0.5 },
  red: { color: '#DC2626', fontWeight: '700' },
  purple: { color: '#7C3AED', fontWeight: '700' },
});
