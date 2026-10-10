import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, FAB, IconButton, List, Snackbar, Text } from 'react-native-paper';

import { BillBadge } from '@/components/BillBadge';
import { BillDetail } from '@/components/BillDetail';
import { MemberFilter } from '@/components/MemberChips';
import { goPay, PaymentDialog } from '@/components/PaymentDialog';
import { Screen, SplitView } from '@/components/Screen';
import { formatDate, today } from '@/domain/dates';
import { addMonths, monthSummary, todoItems, won } from '@/domain/money';
import { CHILDREN, memberById, type MemberId, PARENTS } from '@/domain/types';
import { useLayout } from '@/lib/useLayout';
import { useRepository } from '@/state/RepositoryContext';
import { type BillRow, useEnsureBills, useMoney } from '@/state/useMoney';

const isOpen = (r: BillRow) =>
  r.state.remaining > 0 && r.state.status !== '취소' && r.state.status !== '환불진행' && r.state.status !== '환불완료';

/**
 * 비용 홈 (F-V1, F-V2): 이달 요약 + 처리 필요(월 무관) + 월별 청구 + 기타 지출. 부모 전용.
 * PC: 청구 표 + 오른쪽 상세 패널 (X-18). 폰: 카드 목록 + 상세 화면 이동.
 */
export default function CostScreen() {
  const { repo, isChild, writeContext } = useRepository();
  const { wide } = useLayout();
  useEnsureBills();
  const money = useMoney();
  const [period, setPeriod] = useState(today().slice(0, 7));
  const [child, setChild] = useState<MemberId | 'all'>('all');
  const [payer, setPayer] = useState<MemberId | 'all'>('all');
  const [paying, setPaying] = useState<BillRow | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [snack, setSnack] = useState<{ text: string; undo?: () => void } | null>(null);
  const [fabOpen, setFabOpen] = useState(false);

  const t = today();
  const filtered = useMemo(
    () => money.rows.filter((r) => (child === 'all' || r.bill.childId === child) && (payer === 'all' || r.bill.payer === payer)),
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
  /** PC: 오른쪽 패널, 폰: 상세 화면 */
  const openBill = (id: string) => (wide ? setSelected(id) : router.push({ pathname: '/bill', params: { id } }));
  const overdueDays = (r: BillRow) => Math.max(0, Math.round((Date.parse(t) - Date.parse(r.bill.dueDate)) / 864e5));
  const label = `${Number(period.slice(5))}월분`;

  // ─── 공통 조각 ───
  const filters = (
    <View style={wide ? styles.toolbarWide : undefined}>
      <View style={styles.nav}>
        <IconButton icon="chevron-left" accessibilityLabel="이전 달" onPress={() => setPeriod(addMonths(period, -1))} />
        <Button compact onPress={() => setPeriod(today().slice(0, 7))}>
          {period.slice(0, 4)}년 {label}
        </Button>
        <IconButton icon="chevron-right" accessibilityLabel="다음 달" onPress={() => setPeriod(addMonths(period, 1))} />
        <Button compact icon="chart-bar" onPress={() => router.push('/stats')}>
          통계
        </Button>
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
    </View>
  );

  const summaryCard = (
    <Card mode="outlined" style={styles.card}>
      <Card.Title title={`${label} 학원비`} titleVariant="titleMedium" />
      <Card.Content>
        <View style={[styles.sumRow, wide && styles.sumRowWide]}>
          <Sum label="청구" value={summary.billed} />
          <Sum label="납부" value={summary.paid} color="#16A34A" />
          <Sum label="남은 금액" value={summary.remaining} color={summary.overdue ? '#DC2626' : undefined} sub={summary.overdue ? `연체 ${won(summary.overdue)}` : undefined} />
          {wide && <Sum label="환불 미수령(전체)" value={summary.refundOpen} color={summary.refundOpen ? '#7C3AED' : undefined} />}
          {wide && <Sum label="이달 실제 지출" value={summary.cashOut} sub={summary.expenses ? `기타 ${won(summary.expenses)} 포함` : undefined} />}
        </View>
        {summary.billed > 0 && (
          <View style={styles.progressWrap} accessibilityLabel={`납부 ${Math.round((summary.paid / summary.billed) * 100)}%`}>
            <View style={styles.track}>
              <View style={[styles.fillBar, { width: `${Math.min(100, Math.round((summary.paid / summary.billed) * 100))}%` }]} />
            </View>
            <Text variant="labelSmall" style={[styles.dim, styles.pct]}>
              {Math.round((summary.paid / summary.billed) * 100)}% 냄
            </Text>
          </View>
        )}
        {!wide && (
          <View style={styles.sumRow}>
            <Sum label="환불 미수령(전체)" value={summary.refundOpen} color={summary.refundOpen ? '#7C3AED' : undefined} />
            <Sum label="이달 실제 지출" value={summary.cashOut} sub={summary.expenses ? `기타 ${won(summary.expenses)} 포함` : undefined} />
          </View>
        )}
      </Card.Content>
    </Card>
  );

  const todoCard = todos.length > 0 && (
    <Card mode="outlined" style={[styles.card, styles.todo]}>
      <Card.Title title={`⚠ 처리 필요 (${todos.length})`} titleVariant="titleMedium" subtitle="지난달 것도 포함" />
      {todos.map((td) => {
        const row = money.rows.find((r) => r.id === td.billId)!;
        return (
          <View key={`${td.kind}-${td.billId}`} style={[styles.billRow, wide && styles.rowInline]}>
            <List.Item
              style={[styles.item, styles.flex, selected === td.billId && styles.sel]}
              onPress={() => openBill(td.billId)}
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
  );

  const emptyCard = monthRows.length === 0 && money.loaded && (
    <Card mode="outlined" style={styles.card}>
      <Card.Content>
        <Text>{label} 청구가 없습니다{child !== 'all' || payer !== 'all' ? ' (지금 고른 조건)' : ''}.</Text>
        {child === 'all' && payer === 'all' ? (
          <Text style={styles.dim}>학원·수강 화면에서 월 수강료를 입력하면 매달 청구가 자동으로 만들어집니다. 특강·교재는 [+ 청구 추가]로 넣으세요.</Text>
        ) : (
          <Text style={styles.dim}>위의 자녀·담당 선택을 [전체]로 바꾸면 다른 청구도 보입니다.</Text>
        )}
      </Card.Content>
    </Card>
  );

  // ─── 폰: 아이별 카드 목록 ───
  const billCards = (['son', 'daughter', 'common'] as const).map((c) => {
    const rows = monthRows.filter((r) => r.bill.childId === c);
    if (!rows.length) return null;
    return (
      <Card key={c} mode="outlined" style={styles.card}>
        <View style={styles.childHead}>
          <View style={[styles.dot, { backgroundColor: c === 'common' ? '#9CA3AF' : (memberById(c)?.color ?? '#9CA3AF') }]} />
          <Text variant="titleSmall" style={styles.bold}>
            {c === 'common' ? '공통' : memberById(c)?.name}
          </Text>
          <Text variant="labelSmall" style={styles.dim}>
            {rows.length}건 · {won(rows.reduce((t, r) => t + r.state.due, 0))}
          </Text>
        </View>
        {rows.map((r) => (
          <View key={r.id} style={styles.billRow}>
            <List.Item
              style={styles.item}
              onPress={() => openBill(r.id)}
              title={`${r.bill.title}  ${won(r.state.due)}`}
              titleStyle={r.bill.cancelled ? styles.strike : undefined}
              description={`기한 ${formatDate(r.bill.dueDate)} · ${memberById(r.bill.payer)?.name}${r.state.paid ? ` · 납부 ${won(r.state.paid)}` : ''}${r.bill.needsReview ? ' · 금액 확인 필요' : ''}`}
              right={() => <BillBadge status={r.state.status} extra={r.state.status === '미납' ? `D+${overdueDays(r)}` : ''} />}
            />
            {isOpen(r) && (
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
        ))}
      </Card>
    );
  });

  // ─── PC: 청구 표 (X-18) ───
  const billTable = monthRows.length > 0 && (
    <Card mode="outlined" style={styles.card}>
      <Card.Title title={`${label} 청구 ${monthRows.length}건`} titleVariant="titleMedium" />
      <View style={[styles.tr, styles.th]}>
        <Text style={[styles.cName, styles.thText]}>아이</Text>
        <Text style={[styles.cTitle, styles.thText]}>학원·내용</Text>
        <Text style={[styles.cMoney, styles.thText]}>청구</Text>
        <Text style={[styles.cDate, styles.thText]}>기한</Text>
        <Text style={[styles.cName, styles.thText]}>담당</Text>
        <Text style={[styles.cMoney, styles.thText]}>납부</Text>
        <Text style={[styles.cStatus, styles.thText]}>상태</Text>
        <View style={styles.cAct} />
      </View>
      {monthRows.map((r) => (
        <Pressable key={r.id} onPress={() => openBill(r.id)} style={[styles.tr, selected === r.id && styles.sel]}>
          <Text style={styles.cName}>{r.bill.childId === 'common' ? '공통' : memberById(r.bill.childId)?.name}</Text>
          <Text style={[styles.cTitle, r.bill.cancelled && styles.strike]} numberOfLines={1}>
            {r.bill.title}
            {r.bill.needsReview ? ' ⚠' : ''}
          </Text>
          <Text style={styles.cMoney}>{won(r.state.due)}</Text>
          <Text style={styles.cDate}>{formatDate(r.bill.dueDate)}</Text>
          <Text style={styles.cName}>{memberById(r.bill.payer)?.name}</Text>
          <Text style={styles.cMoney}>{r.state.paid ? won(r.state.paid) : '-'}</Text>
          <View style={styles.cStatus}>
            <BillBadge status={r.state.status} extra={r.state.status === '미납' ? `D+${overdueDays(r)}` : ''} />
          </View>
          <View style={[styles.cAct, styles.actInline]}>
            {isOpen(r) && (
              <>
                <IconButton icon="open-in-new" size={18} onPress={() => void pay(r)} accessibilityLabel="납부하러 가기" />
                <Button compact mode="contained-tonal" icon="check" onPress={() => setPaying(r)}>
                  납부 기록
                </Button>
              </>
            )}
          </View>
        </Pressable>
      ))}
    </Card>
  );

  const expenseCard = monthExpenses.length > 0 && (
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
  );

  const fab = repo && (
    // Portal 로 띄우면 다른 탭에서도 남으므로 화면 안에 둔다
    <FAB.Group
      open={fabOpen}
      visible
      icon={fabOpen ? 'close' : 'plus'}
      accessibilityLabel={fabOpen ? '추가 메뉴 닫기' : '추가: 기타 지출 · 청구'}
      style={wide ? styles.fabWide : undefined}
      actions={[
        { icon: 'cart-outline', label: '기타 지출', onPress: () => router.push('/expense') },
        { icon: 'receipt-text-plus-outline', label: '청구 추가 (특강·교재)', onPress: () => router.push({ pathname: '/bill', params: { period } }) },
      ]}
      onStateChange={({ open }) => setFabOpen(open)}
    />
  );

  const dialogs = (
    <>
      <PaymentDialog
        target={paying}
        onDismiss={() => setPaying(null)}
        onSaved={(id, lbl) => {
          setPaying(null);
          setSnack({
            text: `${lbl.replace('납부 기록: ', '')} 기록됨`,
            // 실행 취소: 방금 만든 기록 1건만 (F-06)
            undo: () => void repo?.remove('payments', id, 1, writeContext('납부 기록 실행 취소')),
          });
        }}
      />
      <Snackbar
        visible={!!snack}
        onDismiss={() => setSnack(null)}
        duration={snack?.undo ? 5000 : 4000}
        action={snack?.undo ? { label: '실행 취소', onPress: () => snack.undo?.() } : undefined}>
        {snack?.text}
      </Snackbar>
    </>
  );

  if (wide) {
    return (
      <View style={styles.fill}>
        <SplitView
          main={
            <>
              {filters}
              {summaryCard}
              {/* 오른쪽 패널이 있어 본문이 좁으므로 표는 본문 전체 폭으로 (처리 필요는 위에) */}
              {todoCard}
              {emptyCard}
              {billTable}
              {expenseCard}
            </>
          }
          panel={
            selected ? (
              <BillDetail key={selected} id={selected} embedded />
            ) : (
              <Text style={styles.dim}>표나 처리 필요 목록에서 청구를 누르면 여기에서 수정·납부·환불 기록을 할 수 있습니다.</Text>
            )
          }
        />
        {fab}
        {dialogs}
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <Screen>
        {filters}
        {summaryCard}
        {todoCard}
        {emptyCard}
        {billCards}
        {expenseCard}
        <View style={{ height: 90 }} />
      </Screen>
      {fab}
      {dialogs}
    </View>
  );
}

function Sum({ label, value, color, sub }: { label: string; value: number; color?: string; sub?: string }) {
  return (
    <View style={styles.sum}>
      <Text variant="labelSmall" style={styles.dim}>
        {label}
      </Text>
      <Text variant="titleMedium" style={[{ fontWeight: '700', fontVariant: ['tabular-nums'] }, color ? { color } : null]}>
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
  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: '#E8ECF2', overflow: 'hidden' },
  fillBar: { height: 8, borderRadius: 4, backgroundColor: '#16A34A' },
  pct: { flexShrink: 0 },
  childHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  bold: { fontWeight: '700' },
  fill: { flex: 1 },
  flex: { flex: 1 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  toolbarWide: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 6 },
  card: { marginBottom: 10 },
  todo: { borderColor: '#F59E0B' },
  sumRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  sumRowWide: { gap: 24 },
  sum: { flex: 1 },
  dim: { opacity: 0.65 },
  billRow: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#E5E7EB' },
  rowInline: { flexDirection: 'column' },
  item: { paddingVertical: 2 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
  strike: { textDecorationLine: 'line-through', opacity: 0.5 },
  red: { color: '#DC2626', fontWeight: '700' },
  purple: { color: '#7C3AED', fontWeight: '700' },
  sel: { backgroundColor: '#EFF6FF' },
  // 표
  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    minHeight: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
    gap: 8,
  },
  th: { minHeight: 32, backgroundColor: '#F3F4F6' },
  thText: { fontSize: 12, fontWeight: '700', opacity: 0.7 },
  cName: { width: 40 },
  cTitle: { flex: 1, minWidth: 120 },
  cMoney: { width: 64, textAlign: 'right' },
  cDate: { width: 72 },
  cStatus: { width: 104 },
  cAct: { width: 136 },
  actInline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  fabWide: { paddingRight: 460 },
});
