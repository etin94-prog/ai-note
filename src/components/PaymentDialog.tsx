import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet } from 'react-native';
import { Button, Dialog, HelperText, Portal, Text, TextInput } from 'react-native-paper';
import { ulid } from 'ulid';

import type { Bill, BillState, Payment, PayMethod } from '@/domain/money';
import { PAY_METHOD_LABELS, won } from '@/domain/money';
import { today } from '@/domain/dates';
import { PAY_TYPE_LABELS, type PaymentInfo } from '@/domain/types';
import { useRepository } from '@/state/RepositoryContext';

import { ChipSelect, DateField } from './FormFields';
import { MoneyInput } from './MoneyInput';

const LAST_KEY = 'ai-note.last-pay-method.v1';
function lastMethod(): { method: PayMethod; card: string } {
  try {
    return { method: 'card', card: '', ...JSON.parse(globalThis.localStorage?.getItem(LAST_KEY) ?? '{}') };
  } catch {
    return { method: 'card', card: '' };
  }
}

const METHODS = (Object.keys(PAY_METHOD_LABELS) as PayMethod[]).map((m) => ({ value: m, label: PAY_METHOD_LABELS[m] }));

/**
 * 납부 기록 (F-03 2탭): [납부 기록] → 이 대화상자 [확인].
 * 기본값: 금액 = 남은 금액, 날짜 = 오늘, 수단 = 지난번 (X-03). 기록 ID 는 열 때 생성 → 재전송해도 1건 (F-34).
 */
export function PaymentDialog({
  target,
  onDismiss,
  onSaved,
}: {
  target: { id: string; bill: Bill; state: BillState } | null;
  onDismiss: () => void;
  onSaved: (paymentId: string, label: string) => void;
}) {
  const { repo, writeContext, settings } = useRepository();
  const [opId, setOpId] = useState('');
  const [amount, setAmount] = useState(0);
  const [paidOn, setPaidOn] = useState(today());
  const [method, setMethod] = useState<PayMethod>('card');
  const [card, setCard] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    const last = lastMethod();
    setOpId(ulid());
    setAmount(target.state.remaining || target.state.due);
    setPaidOn(today());
    setMethod(last.method);
    setCard(last.card);
  }, [target]);

  // PC 키보드 (X-20): Enter = 확인, Esc = 닫기
  const keyRef = useRef<{ confirm: () => void; dismiss: () => void }>({ confirm: () => {}, dismiss: () => {} });
  keyRef.current = { confirm: () => void confirm(), dismiss: onDismiss };
  useEffect(() => {
    if (!target || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') keyRef.current.dismiss();
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        keyRef.current.confirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target]);

  async function confirm() {
    if (!repo || !target || amount <= 0 || saving) return;
    setSaving(true);
    const data: Payment = {
      billId: target.id,
      paidOn,
      amount,
      method,
      card: method === 'card' ? card.trim() : '',
      by: settings.memberId || 'unknown',
      at: new Date().toISOString(),
    };
    const label = `납부 기록: ${target.bill.title} ${Number(target.bill.period.slice(5))}월분 ${won(amount)}`;
    try {
      await repo.create('payments', opId, data as unknown as Record<string, unknown>, writeContext(label));
      globalThis.localStorage?.setItem(LAST_KEY, JSON.stringify({ method, card: data.card }));
      onSaved(opId, label);
    } finally {
      setSaving(false);
    }
  }

  const over = target ? amount - target.state.remaining : 0;
  return (
    <Portal>
      <Dialog visible={!!target} onDismiss={onDismiss}>
        <Dialog.Title>납부 기록</Dialog.Title>
        {target && (
          <Dialog.Content style={styles.gap}>
            <Text variant="bodyMedium">
              {target.bill.title} · {Number(target.bill.period.slice(5))}월분 · 남은 {won(target.state.remaining)}
            </Text>
            <MoneyInput label="납부 금액" value={amount} onChange={setAmount} quick={false} />
            {over > 0 && target.state.remaining > 0 && <HelperText type="error">청구보다 {won(over)} 많습니다 (과납)</HelperText>}
            {amount > 0 && amount < target.state.remaining && <HelperText type="info">부분 납부로 기록됩니다</HelperText>}
            <DateField label="납부일" value={paidOn} onChange={setPaidOn} />
            <ChipSelect options={METHODS} value={method} onChange={setMethod} />
            {method === 'card' && <TextInput mode="outlined" dense label="카드 (선택, 예: 삼성카드)" value={card} onChangeText={setCard} />}
          </Dialog.Content>
        )}
        <Dialog.Actions>
          <Button onPress={onDismiss}>취소</Button>
          <Button mode="contained" onPress={() => void confirm()} loading={saving} disabled={saving || amount <= 0}>
            확인
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

/**
 * [납부하러 가기] (F-30, A-12): 납부 유형별 동작. 결과 안내 문구를 돌려준다.
 * 앱은 결제를 하지 않는다 — 학원 결제 페이지·앱·계좌로 안내만 (D-03).
 */
export async function goPay(info: PaymentInfo | undefined, bill: Bill): Promise<string> {
  if (bill.payUrl) {
    await Linking.openURL(bill.payUrl);
    return '이달 결제 링크를 열었습니다. 납부 후 [납부 기록]을 눌러 주세요.';
  }
  if (!info) return '학원 납부 방법이 없습니다. 학원 정보에서 등록해 주세요.';
  switch (info.payType) {
    case 'fixedLink':
      if (!info.url) return '결제 링크가 등록되지 않았습니다.';
      await Linking.openURL(info.url);
      return '결제 페이지를 열었습니다. 납부 후 [납부 기록]을 눌러 주세요.';
    case 'monthlyLink':
      return '이달 링크가 아직 없습니다. 카톡에서 학원 안내 메시지의 [결제하기]로 납부해 주세요. (메시지 붙여넣기는 다음 단계에서 지원)';
    case 'transfer': {
      const text = [info.bank, info.account, info.holder].filter(Boolean).join(' ');
      if (!info.account) return '계좌번호가 등록되지 않았습니다.';
      try {
        await navigator.clipboard.writeText(text);
        return `계좌를 복사했습니다: ${text}`;
      } catch {
        return `계좌: ${text}`;
      }
    }
    case 'app':
      return `${info.appName || '학원 전용 앱'}에서 납부해 주세요.`;
    default:
      return `${PAY_TYPE_LABELS[info.payType]}로 납부해 주세요.`;
  }
}

const styles = StyleSheet.create({
  gap: { gap: 8 },
});
