import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Checkbox, Chip, Divider, Text } from 'react-native-paper';
import { ulid } from 'ulid';

import type { Op } from '@/data/repository';
import { addMonths } from '@/domain/money';
import { groupBills, normalizeName, type ParsedItem } from '@/domain/kakao';
import { type Alias, aliasId, buildOps, type ImportRow, planRows } from '@/domain/kakaoImport';
import { type Bill, won } from '@/domain/money';
import { type Academy, CHILDREN, memberById, type MemberId, type PaymentInfo } from '@/domain/types';
import { today } from '@/domain/dates';
import { useRepository } from '@/state/RepositoryContext';
import { useCollection } from '@/state/useCollection';

const STATUS_LABEL: Record<ImportRow['status'], string> = {
  new: '새 청구',
  'merge-auto': '자동 청구 금액 갱신',
  exists: '이미 있음',
  unmapped: '이름 연결 필요',
  ignored: '무시',
};

/**
 * 카톡·붙여넣기 해석 결과 미리보기 → 가져오기 (X-20~X-28).
 * 처음 보는 학생·학원 이름은 여기서 한 번 연결하면 별칭으로 저장되어 다음부터 자동 연결된다.
 */
export function ImportPreview({ items, onDone }: { items: ParsedItem[]; onDone?: (msg: string, undo?: () => void) => void }) {
  const { repo, writeContext, settings } = useRepository();
  const aliases = useCollection<Alias>('aliases');
  const academies = useCollection<Academy>('academies');
  const bills = useCollection<Bill>('bills');
  const infos = useCollection<PaymentInfo>('paymentInfos');
  const [range, setRange] = useState<'12' | '24' | 'all'>('12');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // 이번 달 이전 청구는 이미 낸 것으로 (기본 켬)
  const [assumePaid, setAssumePaid] = useState(true);
  const monthStart = `${today().slice(0, 7)}-01`;

  const { groups, orphans } = useMemo(() => groupBills(items), [items]);
  const cutoff = range === 'all' ? '0000-00' : addMonths(today().slice(0, 7), -Number(range));
  const ctx = useMemo(
    () => ({
      aliases: aliases.docs,
      academies: academies.docs.map((a) => ({ id: a.id, name: a.name })),
      bills: bills.docs.map((b) => ({ id: b.id, bill: b as Bill, version: b.version })),
      payerOf: (academyId: string) => infos.docs.find((i) => i.id === academyId)?.payer ?? ('dad' as MemberId),
      by: settings.memberId || 'unknown',
      now: new Date().toISOString(),
    }),
    [aliases.docs, academies.docs, bills.docs, infos.docs, settings.memberId],
  );
  const rows = useMemo(() => planRows(groups, ctx).filter((r) => r.period >= cutoff), [groups, ctx, cutoff]);

  // 연결이 필요한 이름 모음
  const unknownStudents = [...new Set(rows.filter((r) => r.status === 'unmapped' && !r.childId).map((r) => r.group.first.studentName))];
  const unknownAcademies = [
    ...new Map(
      rows.filter((r) => r.status === 'unmapped' && !r.academyId).map((r) => [normalizeName(r.group.first.academyName), r.group.first]),
    ).values(),
  ];

  const saveAlias = async (kind: Alias['kind'], text: string, targetId: string) => {
    if (!repo) return;
    const id = aliasId(kind, text);
    const ex = aliases.docs.find((a) => a.id === id);
    const ctxW = writeContext(`이름 연결: ${text} → ${kind === 'child' ? (memberById(targetId)?.name ?? targetId) : targetId === 'ignore' ? '무시' : '학원'}`);
    if (ex) await repo.update('aliases', id, { targetId }, ex.version, ctxW);
    else await repo.create('aliases', id, { kind, text, targetId }, ctxW);
  };
  const newAcademy = async (p: ParsedItem) => {
    if (!repo) return;
    const academyId = ulid();
    const name = p.academyName.replace(/-.*$/, '').trim() || p.academyName;
    const a: Academy = { name, subject: '', status: 'active', ...(p.phone ? { phone: p.phone } : {}) };
    await repo.applyBatch(
      [
        { type: 'create', col: 'academies', id: academyId, data: a as unknown as Record<string, unknown> },
        { type: 'create', col: 'aliases', id: aliasId('academy', p.academyName), data: { kind: 'academy', text: p.academyName, targetId: academyId } },
      ],
      writeContext(`학원 추가(카톡): ${name}`),
    );
  };

  const selectable = rows.filter((r) => r.status === 'new' || r.status === 'merge-auto');
  const chosen = selectable.filter((r) => !excluded.has(r.group.key));
  const toggle = (key: string) =>
    setExcluded((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  async function doImport() {
    if (!repo || chosen.length === 0) return;
    setBusy(true);
    try {
      const ops = buildOps(chosen, ctx, assumePaid ? { assumePaidBefore: monthStart } : {});
      // 큰 파일은 나눠 저장 (Firebase 트랜잭션 한도 대비). GitHub 모드는 묶음마다 커밋 1개
      const batchIds: string[] = [];
      for (let i = 0; i < ops.length; i += 200) {
        const part: Op[] = ops.slice(i, i + 200);
        const r = await repo.applyBatch(part, writeContext(`카톡 가져오기: 청구 ${chosen.length}건 (${i / 200 + 1}/${Math.ceil(ops.length / 200)})`));
        if (!r.ok) throw new Error('다른 기기에서 같은 항목을 먼저 저장했습니다. 다시 열어 주세요.');
        batchIds.push(r.batchId);
      }
      const paid = chosen.reduce((s, r) => s + r.group.paid.length, 0);
      const cancels = chosen.reduce((s, r) => s + r.group.cancels.length, 0);
      onDone?.(`청구 ${chosen.length}건${paid ? ` · 납부 ${paid}건` : ''}${cancels ? ` · 취소(환불) ${cancels}건` : ''} 가져왔습니다`, () => {
        void (async () => {
          for (const id of [...batchIds].reverse()) await repo.revertBatch(id, writeContext('카톡 가져오기 되돌리기'));
        })();
      });
    } catch (e) {
      onDone?.(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const pastUnpaid = chosen.filter((r) => r.status === 'new' && !r.group.paid.length && !r.group.cancels.length && (r.group.first.dueDate ?? r.group.autopay?.at?.slice(0, 10) ?? r.group.first.date) < monthStart).length;
  const count = (s: ImportRow['status']) => rows.filter((r) => r.status === s).length;

  return (
    <View>
      <View style={styles.chips}>
        <Text variant="labelLarge">기간</Text>
        {(
          [
            ['12', '최근 1년'],
            ['24', '최근 2년'],
            ['all', '전체'],
          ] as const
        ).map(([v, l]) => (
          <Chip key={v} compact selected={range === v} showSelectedOverlay onPress={() => setRange(v)}>
            {l}
          </Chip>
        ))}
      </View>
      <Text style={styles.summary}>
        새 청구 {count('new')} · 자동 청구 금액 갱신 {count('merge-auto')} · 이미 있음 {count('exists')} · 이름 연결 필요 {count('unmapped')} · 무시 {count('ignored')}
        {orphans.length ? ` · 짝 못 찾은 납부/취소 ${orphans.length}` : ''}
      </Text>

      {(unknownStudents.length > 0 || unknownAcademies.length > 0) && (
        <Card mode="outlined" style={[styles.card, styles.warn]}>
          <Card.Title title="처음 보는 이름 연결" subtitle="한 번 고르면 다음부터 자동으로 연결됩니다" titleVariant="titleMedium" />
          <Card.Content style={styles.gap}>
            {unknownStudents.map((name) => (
              <View key={`s-${name}`}>
                <Text variant="labelLarge">학생 “{name}”</Text>
                <View style={styles.chips}>
                  {CHILDREN.map((c) => (
                    <Chip key={c.id} compact onPress={() => void saveAlias('child', name, c.id)}>
                      {c.name}
                    </Chip>
                  ))}
                  <Chip compact icon="eye-off-outline" onPress={() => void saveAlias('child', name, 'ignore')}>
                    무시
                  </Chip>
                </View>
              </View>
            ))}
            {unknownAcademies.map((p) => (
              <View key={`a-${p.academyName}`}>
                <Text variant="labelLarge">학원 “{p.academyName}”</Text>
                <View style={styles.chips}>
                  {academies.docs
                    .filter((a) => a.status === 'active')
                    .map((a) => (
                      <Chip key={a.id} compact onPress={() => void saveAlias('academy', p.academyName, a.id)}>
                        {a.name}
                      </Chip>
                    ))}
                  <Chip compact icon="plus" onPress={() => void newAcademy(p)}>
                    새 학원으로 추가
                  </Chip>
                  <Chip compact icon="eye-off-outline" onPress={() => void saveAlias('academy', p.academyName, 'ignore')}>
                    무시
                  </Chip>
                </View>
              </View>
            ))}
          </Card.Content>
        </Card>
      )}

      <Card mode="outlined" style={styles.card}>
        <Card.Title title={`가져올 청구 ${chosen.length}건`} titleVariant="titleMedium" subtitle="체크를 풀면 그 청구는 가져오지 않습니다" />
        {rows.slice(0, 150).map((r) => {
          const f = r.group.first;
          const can = r.status === 'new' || r.status === 'merge-auto';
          const tags = [
            r.group.resends.length ? `재안내 ${r.group.resends.length}회` : '',
            r.group.autopay ? '자동결제' : '',
            r.group.paid.length ? '납부완료' : '',
            r.group.cancels.length ? '결제취소' : '',
            r.group.periodSource === 'date' ? '대상 월 추정' : '',
          ].filter(Boolean);
          return (
            <View key={r.group.key}>
              <Checkbox.Item
                disabled={!can}
                status={can && !excluded.has(r.group.key) ? 'checked' : 'unchecked'}
                onPress={() => toggle(r.group.key)}
                position="leading"
                labelStyle={[styles.left, !can && styles.dim]}
                label={`${Number(r.period.slice(5))}월분 · ${r.childId && r.childId !== 'common' ? memberById(r.childId)?.name : f.studentName} · ${r.title} · ${won(r.amount)}\n${STATUS_LABEL[r.status]} · 안내 ${f.date}${tags.length ? ` · ${tags.join(' · ')}` : ''}`}
              />
              <Divider />
            </View>
          );
        })}
        {rows.length > 150 && <Text style={styles.more}>외 {rows.length - 150}건 (기간을 줄이면 목록이 짧아집니다)</Text>}
        <Checkbox.Item
          status={assumePaid ? 'checked' : 'unchecked'}
          onPress={() => setAssumePaid((v) => !v)}
          position="leading"
          labelStyle={styles.left}
          label={`이번 달 이전 청구는 납부한 것으로 기록 (납부완료 안내가 없는 ${pastUnpaid}건)`}
        />
        <Card.Actions>
          <Button mode="contained" icon="download" loading={busy} disabled={busy || chosen.length === 0} onPress={() => void doImport()}>
            {chosen.length}건 가져오기
          </Button>
        </Card.Actions>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginVertical: 6 },
  summary: { marginVertical: 6, opacity: 0.8 },
  card: { marginBottom: 12 },
  warn: { borderColor: '#F59E0B' },
  gap: { gap: 10 },
  dim: { opacity: 0.5 },
  left: { textAlign: 'left' },
  more: { padding: 12, opacity: 0.6 },
});
