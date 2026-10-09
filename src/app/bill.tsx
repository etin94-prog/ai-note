import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Divider, HelperText, List, Snackbar, Text, TextInput } from 'react-native-paper';
import { ulid } from 'ulid';

import { BillBadge } from '@/components/BillBadge';
import { ChipSelect, DateField, Label } from '@/components/FormFields';
import { MoneyInput } from '@/components/MoneyInput';
import { goPay, PaymentDialog } from '@/components/PaymentDialog';
import { Screen } from '@/components/Screen';
import type { Collection } from '@/data/repository';
import { formatDate, today } from '@/domain/dates';
import {
  type Adjustment,
  type Bill,
  PAY_METHOD_LABELS,
  type PayMethod,
  type Receipt,
  type Refund,
  REFUND_REASON_LABELS,
  type RefundReason,
  won,
  wonFull,
} from '@/domain/money';
import { CHILDREN, memberById, type MemberId, PARENTS } from '@/domain/types';
import { useRepository } from '@/state/RepositoryContext';
import { useMoney } from '@/state/useMoney';

const R = (o: object) => o as unknown as Record<string, unknown>;
const REASONS = (Object.keys(REFUND_REASON_LABELS) as RefundReason[]).map((r) => ({ value: r, label: REFUND_REASON_LABELS[r] }));
const METHODS = (Object.keys(PAY_METHOD_LABELS) as PayMethod[]).map((m) => ({ value: m, label: PAY_METHOD_LABELS[m] }));

/** 청구 상세·추가 (F-V3): 납부 기록·정정, 조정, 환불 건·수령 */
export default function BillScreen() {
  const params = useLocalSearchParams<{ id?: string; period?: string }>();
  const { repo, writeContext, settings, isChild } = useRepository();
  const money = useMoney();
  const row = money.rows.find((r) => r.id === params.id);
  const me = settings.memberId || 'unknown';
  const [snack, setSnack] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [panel, setPanel] = useState<null | 'edit' | 'adjust' | 'refund' | { receiptFor: string } | { closeFor: string }>(null);

  // 폼 상태 (추가·수정·조정·환불 공용)
  const [childId, setChildId] = useState<MemberId | 'common'>('son');
  const [academyId, setAcademyId] = useState('');
  const [title, setTitle] = useState('');
  const [period, setPeriod] = useState(params.period || today().slice(0, 7));
  const [amount, setAmount] = useState(0);
  const [dueDate, setDueDate] = useState(today());
  const [payer, setPayer] = useState<MemberId>('dad');
  const [payUrl, setPayUrl] = useState('');
  const [memo, setMemo] = useState('');
  const [reason, setReason] = useState<RefundReason>('withdraw');
  const [date1, setDate1] = useState(today());
  const [text1, setText1] = useState('');
  const [method, setMethod] = useState<PayMethod>('transfer');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!row) return;
    setTitle(row.bill.title);
    setAmount(row.bill.amount);
    setDueDate(row.bill.dueDate);
    setPayUrl(row.bill.payUrl ?? '');
    setMemo(row.bill.memo ?? '');
  }, [row?.doc.version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isChild) return <Screen><Text>부모만 볼 수 있습니다.</Text></Screen>;

  const ctx = (label: string) => writeContext(row ? `${label}: ${row.bill.title} ${Number(row.bill.period.slice(5))}월분` : label);

  // ───── 새 청구 ─────
  if (!params.id) {
    const academies = money.academies.filter((a) => a.status === 'active');
    const create = async () => {
      if (!repo) return;
      if (!title.trim() || amount <= 0) return setError('제목과 금액을 입력해 주세요.');
      if (!/^\d{4}-\d{2}$/.test(period)) return setError('대상 월은 2026-11 형식입니다.');
      const bill: Bill = { title: title.trim(), academyId, childId, period, amount, dueDate, payer, payUrl: payUrl.trim(), source: 'manual', memo: memo.trim() };
      const id = ulid();
      await repo.create('bills', id, R(bill), writeContext(`청구 추가: ${bill.title} ${period}`));
      router.replace({ pathname: '/bill', params: { id } });
    };
    return (
      <Screen>
        <Stack.Screen options={{ title: '청구 추가' }} />
        <Label>누구</Label>
        <ChipSelect options={[...CHILDREN.map((c) => ({ value: c.id as MemberId | 'common', label: c.name })), { value: 'common', label: '공통' }]} value={childId} onChange={setChildId} />
        <Label>학원 (선택)</Label>
        <ChipSelect
          options={[{ value: '', label: '없음' }, ...academies.map((a) => ({ value: a.id, label: a.name }))]}
          value={academyId}
          onChange={(v) => {
            setAcademyId(v);
            const a = academies.find((x) => x.id === v);
            if (a && !title) setTitle(`${a.name} `);
            const info = money.paymentInfos.find((i) => i.id === v);
            if (info) setPayer(info.payer);
          }}
        />
        <TextInput mode="outlined" label="제목 (예: 수학 겨울특강, 교재비)" value={title} onChangeText={setTitle} style={styles.gap} />
        <MoneyInput label="금액" value={amount} onChange={setAmount} />
        <View style={styles.row}>
          <TextInput mode="outlined" dense label="대상 월 (YYYY-MM)" value={period} onChangeText={setPeriod} style={styles.flex} />
          <DateField label="납부 기한" value={dueDate} onChange={setDueDate} />
        </View>
        <Label>납부 담당</Label>
        <ChipSelect options={PARENTS.map((p) => ({ value: p.id, label: p.name }))} value={payer} onChange={setPayer} />
        <TextInput mode="outlined" dense label="이달 결제 링크 (카톡·문자로 받은 링크, 선택)" value={payUrl} onChangeText={setPayUrl} autoCapitalize="none" style={styles.gap} />
        <TextInput mode="outlined" dense label="메모" value={memo} onChangeText={setMemo} style={styles.gap} />
        {error && <HelperText type="error">{error}</HelperText>}
        <Button mode="contained" onPress={() => void create()}>
          저장
        </Button>
      </Screen>
    );
  }

  if (!row) return <Screen><Text>{money.loaded ? '청구를 찾을 수 없습니다.' : '불러오는 중…'}</Text></Screen>;

  const { bill, state } = row;
  const info = money.paymentInfos.find((i) => i.id === bill.academyId);
  const voidRecord = async (col: Collection, id: string, version: number, label: string) => {
    await repo?.update(col, id, { voided: { by: me, at: new Date().toISOString(), reason: '정정' } }, version, ctx(label));
    setSnack('취소 기록을 남겼습니다 (원래 기록은 이력에 보존)');
  };

  const saveEdit = async () => {
    if (!repo) return;
    const r = await repo.update('bills', row.id, { title: title.trim(), amount, dueDate, payUrl: payUrl.trim(), memo: memo.trim(), needsReview: false }, row.doc.version, ctx('청구 수정'));
    if (r !== 'ok') return setError('다른 기기에서 먼저 수정했습니다. 다시 열어 주세요.');
    setPanel(null);
  };

  const addAdjustment = async () => {
    if (!repo || amount <= 0) return;
    const adj: Adjustment = { billId: row.id, amount, reason: text1.trim() || '면제', by: me, at: new Date().toISOString() };
    await repo.create('adjustments', ulid(), R(adj), ctx(`감액·면제 ${won(amount)}`));
    setPanel(null);
  };

  const addRefund = async () => {
    if (!repo || amount <= 0) return;
    const rf: Refund = { billId: row.id, causeDate: date1, requestedOn: today(), reason, requested: amount, memo: text1.trim() };
    await repo.create('refunds', ulid(), R(rf), ctx(`환불 요청 ${won(amount)}`));
    setPanel(null);
  };

  const addReceipt = async (refundId: string) => {
    if (!repo || amount <= 0) return;
    const rc: Receipt = { refundId, billId: row.id, receivedOn: date1, amount, method, by: me, at: new Date().toISOString() };
    await repo.create('receipts', ulid(), R(rc), ctx(`환불 수령 ${won(amount)}`));
    setPanel(null);
  };

  const patchRefund = async (id: string, patch: Partial<Refund>, label: string) => {
    const doc = row.refunds.find((r) => r.id === id);
    if (doc) await repo?.update('refunds', id, R(patch), doc.version, ctx(label));
    setPanel(null);
  };

  const open = (p: typeof panel, preset: { amount?: number; date?: string; text?: string } = {}) => {
    setAmount(preset.amount ?? 0);
    setDate1(preset.date ?? today());
    setText1(preset.text ?? '');
    setError(null);
    setPanel(p);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: bill.title }} />
      <Card mode="outlined" style={styles.card}>
        <Card.Content>
          <View style={styles.titleRow}>
            <Text variant="titleLarge" style={[styles.flex, bill.cancelled && styles.strike]}>
              {bill.title}
            </Text>
            <BillBadge status={state.status} />
          </View>
          <Text style={styles.line}>
            {bill.childId === 'common' ? '공통' : memberById(bill.childId)?.name} · {bill.period.slice(0, 4)}년 {Number(bill.period.slice(5))}월분 · 기한 {formatDate(bill.dueDate)} · 담당 {memberById(bill.payer)?.name}
          </Text>
          <Text variant="titleMedium" style={styles.line}>
            청구 {wonFull(bill.amount)}
            {state.adjusted ? ` − 조정 ${won(state.adjusted)}` : ''} · 납부 {won(state.paid)} · 남은 {won(state.remaining)}
          </Text>
          {state.overpaid > 0 && <Text style={styles.warn}>과납 {won(state.overpaid)} — 학원에 확인하세요</Text>}
          {bill.needsReview && <Text style={styles.warn}>중도 시작·종료 달입니다. 실제 금액을 확인해 [수정]으로 고쳐 주세요.</Text>}
          {bill.memo ? <Text style={styles.line}>메모: {bill.memo}</Text> : null}
        </Card.Content>
        <Card.Actions style={styles.wrap}>
          {state.remaining > 0 && !bill.cancelled && (
            <>
              <Button icon="open-in-new" onPress={async () => setSnack(await goPay(info, bill))}>
                납부하러 가기
              </Button>
              <Button mode="contained" icon="check" onPress={() => setPaying(true)}>
                납부 기록
              </Button>
            </>
          )}
          <Button icon="pencil" onPress={() => open('edit', { amount: bill.amount })}>
            수정
          </Button>
        </Card.Actions>
      </Card>

      {panel === 'edit' && (
        <Card mode="outlined" style={styles.card}>
          <Card.Title title="청구 수정" titleVariant="titleSmall" subtitle="이 청구만 바뀝니다 (수강 비용 조건은 그대로)" />
          <Card.Content style={styles.gapCol}>
            <TextInput mode="outlined" dense label="제목" value={title} onChangeText={setTitle} />
            <MoneyInput label="금액" value={amount} onChange={setAmount} quick={false} />
            <DateField label="납부 기한" value={dueDate} onChange={setDueDate} />
            <TextInput mode="outlined" dense label="이달 결제 링크" value={payUrl} onChangeText={setPayUrl} autoCapitalize="none" />
            <TextInput mode="outlined" dense label="메모 (수정 사유)" value={memo} onChangeText={setMemo} />
            {error && <HelperText type="error">{error}</HelperText>}
          </Card.Content>
          <Card.Actions>
            <Button textColor="#DC2626" onPress={() => void repo?.update('bills', row.id, { cancelled: !bill.cancelled }, row.doc.version, ctx(bill.cancelled ? '청구 취소 되돌림' : '청구 취소')).then(() => setPanel(null))}>
              {bill.cancelled ? '취소 되돌리기' : '청구 취소'}
            </Button>
            <Button onPress={() => setPanel(null)}>닫기</Button>
            <Button mode="contained" onPress={() => void saveEdit()}>
              저장
            </Button>
          </Card.Actions>
        </Card>
      )}

      <Card mode="outlined" style={styles.card}>
        <Card.Title title={`납부 기록 ${won(state.paid)}`} titleVariant="titleSmall" />
        {row.payments.length === 0 && <Card.Content><Text style={styles.dim}>아직 없습니다.</Text></Card.Content>}
        {[...row.payments].sort((a, b) => (a.paidOn < b.paidOn ? -1 : 1)).map((p) => (
          <List.Item
            key={p.id}
            style={styles.item}
            title={`${formatDate(p.paidOn)}  ${wonFull(p.amount)}`}
            titleStyle={p.voided ? styles.strike : undefined}
            description={`${PAY_METHOD_LABELS[p.method]}${p.card ? ` ${p.card}` : ''} · ${memberById(p.by)?.name ?? p.by}${p.voided ? ' · 취소됨' : ''}`}
            right={() => (!p.voided ? <Button compact onPress={() => void voidRecord('payments', p.id, p.version, '납부 기록 정정')}>정정(취소)</Button> : null)}
          />
        ))}
      </Card>

      <Card mode="outlined" style={styles.card}>
        <Card.Title title="감액·면제" titleVariant="titleSmall" subtitle="퇴원 후 남은 미납 면제, 할인 등" />
        {row.adjustments.map((a) => (
          <List.Item
            key={a.id}
            style={styles.item}
            title={`− ${wonFull(a.amount)} · ${a.reason}`}
            titleStyle={a.voided ? styles.strike : undefined}
            right={() => (!a.voided ? <Button compact onPress={() => void voidRecord('adjustments', a.id, a.version, '조정 정정')}>정정(취소)</Button> : null)}
          />
        ))}
        {panel === 'adjust' ? (
          <Card.Content style={styles.gapCol}>
            <MoneyInput label="감액 금액" value={amount} onChange={setAmount} quick={false} />
            <TextInput mode="outlined" dense label="사유 (예: 퇴원 면제, 형제 할인)" value={text1} onChangeText={setText1} />
            <View style={styles.row}>
              <Button onPress={() => setPanel(null)}>닫기</Button>
              <Button mode="contained" onPress={() => void addAdjustment()}>저장</Button>
            </View>
          </Card.Content>
        ) : (
          <Card.Actions>
            <Button icon="minus-circle-outline" onPress={() => open('adjust', { amount: state.remaining, text: '면제' })}>감액·면제 추가</Button>
          </Card.Actions>
        )}
      </Card>

      <Card mode="outlined" style={styles.card}>
        <Card.Title title="환불" titleVariant="titleSmall" subtitle="기록만 합니다 — 실제 환불은 학원과 진행" />
        {state.refunds.map(({ refund, state: rs }) => {
          const recs = row.receipts.filter((x) => x.refundId === refund.id);
          return (
            <View key={refund.id} style={styles.refund}>
              <Text variant="titleSmall">
                {REFUND_REASON_LABELS[refund.reason]} · 요청 {won(refund.requested)}
                {refund.agreed != null ? ` · 합의 ${won(refund.agreed)}` : ''} · 받음 {won(rs.received)} ·{' '}
                <Text style={rs.closed ? styles.dim : styles.purple}>
                  {rs.closedBy === 'withdrawn' ? '철회' : rs.closed ? `종결${rs.closedBy === 'manual' ? `(${refund.manualClose?.reason})` : ''}` : `잔액 ${won(rs.balance)}`}
                </Text>
              </Text>
              <Text variant="bodySmall" style={styles.dim}>
                사유 발생 {formatDate(refund.causeDate)} · 요청 {formatDate(refund.requestedOn)} · 법정 반환기한 참고 {formatDate(rs.legalDue)}
                {!rs.closed && rs.legalDue < today() ? ' (지남)' : ''}
              </Text>
              {rs.balance < 0 && <Text style={styles.warn}>요청액보다 {won(-rs.balance)} 더 받았습니다</Text>}
              {recs.map((x) => (
                <List.Item
                  key={x.id}
                  style={styles.item}
                  title={`${formatDate(x.receivedOn)} 수령 ${wonFull(x.amount)}`}
                  titleStyle={x.voided ? styles.strike : undefined}
                  description={`${PAY_METHOD_LABELS[x.method]}${x.voided ? ' · 취소됨' : ''}`}
                  right={() => (!x.voided ? <Button compact onPress={() => void voidRecord('receipts', x.id, x.version, '환불 수령 정정')}>정정(취소)</Button> : null)}
                />
              ))}
              {typeof panel === 'object' && panel && 'receiptFor' in panel && panel.receiptFor === refund.id ? (
                <View style={styles.gapCol}>
                  <MoneyInput label="받은 금액" value={amount} onChange={setAmount} quick={false} />
                  <DateField label="받은 날" value={date1} onChange={setDate1} />
                  <ChipSelect options={METHODS} value={method} onChange={setMethod} />
                  <View style={styles.row}>
                    <Button onPress={() => setPanel(null)}>닫기</Button>
                    <Button mode="contained" onPress={() => void addReceipt(refund.id)}>저장</Button>
                  </View>
                </View>
              ) : typeof panel === 'object' && panel && 'closeFor' in panel && panel.closeFor === refund.id ? (
                <View style={styles.gapCol}>
                  <MoneyInput label="합의한 환불액 (선택)" value={amount} onChange={setAmount} quick={false} />
                  <TextInput mode="outlined" dense label="종결 사유 (예: 학원과 합의)" value={text1} onChangeText={setText1} />
                  <View style={styles.row}>
                    <Button onPress={() => setPanel(null)}>닫기</Button>
                    <Button onPress={() => void patchRefund(refund.id, { agreed: amount || null }, '환불 합의액')}>합의액만 저장</Button>
                    <Button mode="contained" onPress={() => void patchRefund(refund.id, { agreed: amount || null, manualClose: { reason: text1.trim() || '합의', by: me, at: new Date().toISOString() } }, '환불 종결')}>
                      종결
                    </Button>
                  </View>
                </View>
              ) : (
                <View style={styles.wrapRow}>
                  {!rs.closed && (
                    <>
                      <Button compact mode="contained-tonal" onPress={() => open({ receiptFor: refund.id }, { amount: Math.max(0, rs.balance) })}>
                        수령 기록
                      </Button>
                      <Button compact onPress={() => open({ closeFor: refund.id }, { amount: refund.agreed ?? 0 })}>합의·종결</Button>
                      <Button compact onPress={() => void patchRefund(refund.id, { withdrawn: true }, '환불 요청 철회')}>철회</Button>
                    </>
                  )}
                  {(refund.manualClose || refund.withdrawn) && (
                    <Button compact onPress={() => void patchRefund(refund.id, { manualClose: null, withdrawn: false }, '환불 재개')}>다시 열기</Button>
                  )}
                </View>
              )}
              <Divider style={styles.divider} />
            </View>
          );
        })}
        {panel === 'refund' ? (
          <Card.Content style={styles.gapCol}>
            <ChipSelect options={REASONS} value={reason} onChange={setReason} />
            <DateField label="사유 발생일 (퇴원·휴원 결정일)" value={date1} onChange={setDate1} />
            <MoneyInput label="요청 금액" value={amount} onChange={setAmount} quick={false} />
            <TextInput mode="outlined" dense label="메모" value={text1} onChangeText={setText1} />
            <HelperText type="info">학원법상 반환사유 발생일부터 5일 이내 반환이 기준입니다(참고). 정확한 금액은 학원과 확인하세요.</HelperText>
            <View style={styles.row}>
              <Button onPress={() => setPanel(null)}>닫기</Button>
              <Button mode="contained" onPress={() => void addRefund()}>저장</Button>
            </View>
          </Card.Content>
        ) : (
          state.paid > 0 && (
            <Card.Actions>
              <Button icon="cash-refund" onPress={() => open('refund', { amount: state.paid })}>환불 요청 기록</Button>
            </Card.Actions>
          )
        )}
      </Card>

      <PaymentDialog
        target={paying ? row : null}
        onDismiss={() => setPaying(false)}
        onSaved={() => {
          setPaying(false);
          setSnack('납부를 기록했습니다');
        }}
      />
      <Snackbar visible={!!snack} onDismiss={() => setSnack(null)} duration={4000}>
        {snack}
      </Snackbar>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  gap: { marginVertical: 6 },
  gapCol: { gap: 8 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', justifyContent: 'flex-end', marginVertical: 4 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  flex: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  line: { marginTop: 4 },
  wrap: { flexWrap: 'wrap' },
  item: { paddingVertical: 0 },
  dim: { opacity: 0.65 },
  warn: { color: '#EA580C', marginTop: 4 },
  purple: { color: '#7C3AED', fontWeight: '700' },
  strike: { textDecorationLine: 'line-through', opacity: 0.5 },
  refund: { paddingHorizontal: 16, paddingTop: 4 },
  divider: { marginTop: 8 },
});
