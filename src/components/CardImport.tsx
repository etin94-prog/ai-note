import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Checkbox, Chip, Divider, Text } from 'react-native-paper';

import { buildCardOps, type CardTxn, matchTxns, type MatchRow, type OpenBill } from '@/domain/card';
import { type Alias, aliasId } from '@/domain/kakaoImport';
import { won } from '@/domain/money';
import { type Academy, memberById } from '@/domain/types';
import { useRepository } from '@/state/RepositoryContext';
import { useCollection } from '@/state/useCollection';
import { type BillRow, useMoney } from '@/state/useMoney';

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

/**
 * 카드 거래 → 청구 짝짓기 미리보기 → 납부 기록 (C-01~C-03).
 * 학원이 아닌 거래는 화면에도 데이터에도 남기지 않는다.
 */
export function CardImport({ txns, onDone }: { txns: CardTxn[]; onDone?: (msg: string, undo?: () => void) => void }) {
  const { repo, writeContext, settings } = useRepository();
  const academies = useCollection<Academy>('academies');
  const aliases = useCollection<Alias>('aliases');
  const cardTxns = useCollection<{ fingerprint: string }>('cardTxns');
  const money = useMoney();
  const [pick, setPick] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);

  const ctx = useMemo(() => {
    const acName = (id: string) => academies.docs.find((a) => a.id === id)?.name ?? '';
    const toOpen = (r: BillRow): OpenBill => ({
      id: r.id,
      label: `${r.bill.childId === 'common' ? '공통' : (memberById(r.bill.childId)?.name ?? '')} ${acName(r.bill.academyId) || r.bill.title} ${Number(r.bill.period.slice(5))}월분 ${won(r.state.due)}`,
      academyId: r.bill.academyId,
      dueDate: r.bill.dueDate,
      due: r.state.due,
      remaining: r.state.remaining,
    });
    const live = money.rows.filter((r) => !r.bill.cancelled);
    return {
      bills: live.filter((r) => r.state.remaining > 0).map(toOpen),
      paidBills: live.filter((r) => r.state.remaining === 0 && r.state.paid > 0).map(toOpen),
      aliases: aliases.docs,
      academies: academies.docs.filter((a) => a.status === 'active').map((a) => ({ id: a.id, name: a.name })),
      existing: new Set(cardTxns.docs.map((d) => d.id)),
    };
  }, [money.rows, aliases.docs, academies.docs, cardTxns.docs]);

  const rows = useMemo(() => matchTxns(txns, ctx), [txns, ctx]);
  const billOf = (r: MatchRow) => (r.txn.fingerprint in pick ? pick[r.txn.fingerprint] : (r.billId ?? null));
  const chosen = rows.filter((r) => (r.status === 'match' || r.status === 'choose') && billOf(r));
  const by = (st: MatchRow['status']) => rows.filter((r) => r.status === st);
  const unknownMerchants = [...new Map(by('unknown').map((r) => [r.txn.merchant, r])).keys()];

  const saveAlias = async (text: string, targetId: string) => {
    if (!repo) return;
    const id = aliasId('academy', text);
    const ex = aliases.docs.find((a) => a.id === id) as (Alias & { id: string; version: number }) | undefined;
    const label = `가맹점 연결: ${text} → ${targetId === 'ignore' ? '무시' : (academies.docs.find((a) => a.id === targetId)?.name ?? '')}`;
    if (ex) await repo.update('aliases', id, { targetId }, ex.version, writeContext(label));
    else await repo.create('aliases', id, { kind: 'academy', text, targetId }, writeContext(label));
  };

  async function doImport() {
    if (!repo || chosen.length === 0) return;
    setBusy(true);
    try {
      const ops = buildCardOps(
        chosen.map((row) => ({ row, billId: billOf(row)! })),
        { by: settings.memberId || 'unknown', now: new Date().toISOString() },
      );
      const total = chosen.reduce((s, r) => s + r.txn.amount, 0);
      const r = await repo.applyBatch(ops, writeContext(`카드 내역으로 납부 기록 ${chosen.length}건 ${won(total)}`));
      if (!r.ok) throw new Error('다른 기기에서 먼저 저장했습니다. 다시 열어 주세요.');
      onDone?.(
        `납부 ${chosen.length}건 (${won(total)}) 기록했습니다`,
        () => void repo.revertBatch(r.batchId, writeContext('카드 내역 가져오기 되돌리기')),
      );
    } catch (e) {
      onDone?.(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const line = (r: MatchRow) =>
    `${md(r.txn.date)}${r.txn.time ? ` ${r.txn.time}` : ''} · ${r.txn.merchant} · ${won(r.txn.amount)}${r.txn.card ? ` · ${r.txn.card}` : ''}`;

  return (
    <View>
      <Text style={styles.summary}>
        거래 {rows.length}건 · 짝지음 {by('match').length} · 고르기 {by('choose').length} · 이름 연결 {by('unknown').length} · 이미 기록{' '}
        {by('exists').length + by('already').length}
        {'\n'}학원이 아닌 거래 {by('other').length}건은 저장하지 않습니다.
      </Text>

      {unknownMerchants.length > 0 && (
        <Card mode="outlined" style={[styles.card, styles.warn]}>
          <Card.Title title="처음 보는 가맹점" subtitle="학원을 고르면 다음부터 자동으로 연결됩니다" titleVariant="titleMedium" />
          <Card.Content style={styles.gap}>
            {unknownMerchants.map((m) => (
              <View key={m}>
                <Text variant="labelLarge">{m}</Text>
                <View style={styles.chips}>
                  {ctx.academies.map((a) => (
                    <Chip key={a.id} compact onPress={() => void saveAlias(m, a.id)}>
                      {a.name}
                    </Chip>
                  ))}
                  <Chip compact icon="eye-off-outline" onPress={() => void saveAlias(m, 'ignore')}>
                    학원 아님
                  </Chip>
                </View>
              </View>
            ))}
          </Card.Content>
        </Card>
      )}

      <Card mode="outlined" style={styles.card}>
        <Card.Title
          title={`납부로 기록할 거래 ${chosen.length}건`}
          titleVariant="titleMedium"
          subtitle="금액·기간·가맹점이 맞는 청구를 골라 두었습니다"
        />
        {[...by('match'), ...by('choose')].map((r) => {
          const sel = billOf(r);
          const exact = r.candidates.find((c) => c.id === sel)?.exact;
          return (
            <View key={r.txn.fingerprint}>
              <Checkbox.Item
                status={sel ? 'checked' : 'unchecked'}
                onPress={() => setPick((p) => ({ ...p, [r.txn.fingerprint]: sel ? null : (r.billId ?? r.candidates[0]?.id ?? null) }))}
                position="leading"
                labelStyle={styles.left}
                label={`${line(r)}\n→ ${sel ? (r.candidates.find((c) => c.id === sel)?.label ?? '') : '청구를 골라 주세요'}${sel && !exact ? ' (금액 다름 — 부분납부)' : ''}`}
              />
              {(r.status === 'choose' || r.candidates.length > 1) && (
                <View style={[styles.chips, styles.indent]}>
                  {r.candidates.slice(0, 6).map((c) => (
                    <Chip
                      key={c.id}
                      compact
                      selected={sel === c.id}
                      showSelectedOverlay
                      onPress={() => setPick((p) => ({ ...p, [r.txn.fingerprint]: c.id }))}>
                      {c.label}
                    </Chip>
                  ))}
                  {r.candidates.length === 0 && (
                    <Text style={styles.dim}>이 학원의 남은 청구가 없습니다. 비용 탭에서 청구를 먼저 만들어 주세요.</Text>
                  )}
                </View>
              )}
              <Divider />
            </View>
          );
        })}
        {[...by('already'), ...by('exists'), ...by('cancel')].map((r) => (
          <Text key={r.txn.fingerprint} style={[styles.info, styles.dim]}>
            {line(r)} —{' '}
            {r.status === 'exists'
              ? '이미 가져옴'
              : r.status === 'already'
                ? '같은 금액 납부가 이미 기록됨'
                : '결제 취소 — 환불은 청구 화면에서 기록'}
          </Text>
        ))}
        <Card.Actions>
          <Button mode="contained" icon="check" loading={busy} disabled={busy || chosen.length === 0} onPress={() => void doImport()}>
            {chosen.length}건 납부 기록
          </Button>
        </Card.Actions>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { marginVertical: 6, opacity: 0.8 },
  card: { marginBottom: 12 },
  warn: { borderColor: '#F59E0B' },
  gap: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 4 },
  indent: { paddingHorizontal: 16, paddingBottom: 8 },
  left: { textAlign: 'left' },
  dim: { opacity: 0.6 },
  info: { paddingHorizontal: 16, paddingVertical: 6 },
});
