import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, HelperText, IconButton, Text, TextInput } from 'react-native-paper';
import { ulid } from 'ulid';

import { ChipSelect, DateField, Label, TimeField, WeekdayChips } from '@/components/FormFields';
import { Screen } from '@/components/Screen';
import { goBack } from '@/lib/nav';
import type { Op, StoredDoc } from '@/data/repository';
import { today } from '@/domain/dates';
import { type Academy, CHILDREN, type Enrollment, type MemberId, type TimeSlot, type Weekday } from '@/domain/types';
import { useRepository } from '@/state/RepositoryContext';
import { useCollection } from '@/state/useCollection';
import { MoneyInput } from '@/components/MoneyInput';
import { type EnrollmentCost, type PayCycle, type PayTiming, won } from '@/domain/money';

const STATUS = [
  { value: 'active' as const, label: '수강 중' },
  { value: 'paused' as const, label: '휴원' },
  { value: 'ended' as const, label: '종료' },
];

/** 수강 등록 (A-02, A-04, A-05): 아이 + 요일·시간(여러 개) → 주간 시간표 자동 생성 (S-02) */
export default function EnrollmentScreen() {
  const { id, academyId } = useLocalSearchParams<{ id?: string; academyId: string }>();
  const { repo, writeContext, isChild } = useRepository();
  const costs = useCollection<EnrollmentCost>('enrollmentCosts');
  const myCosts = costs.docs.filter((c) => c.enrollmentId === id).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  // 비용 조건 (A-03, A-08) — 부모만
  const [costAmount, setCostAmount] = useState(0);
  const [payDay, setPayDay] = useState('5');
  const [timing, setTiming] = useState<PayTiming>('prepaid');
  const [cycle, setCycle] = useState<PayCycle>('monthly');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [academy, setAcademy] = useState<StoredDoc<Academy> | null>(null);
  const [existing, setExisting] = useState<StoredDoc<Enrollment> | null>(null);
  const [childId, setChildId] = useState<MemberId>('son');
  const [course, setCourse] = useState('');
  // 같은 시간이면 요일을 여러 개 고르고, 요일마다 시간이 다르면 줄을 추가
  const [groups, setGroups] = useState<{ weekdays: Weekday[]; start: string; end: string }[]>([
    { weekdays: [], start: '18:00', end: '20:00' },
  ]);
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState<Enrollment['status']>('active');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repo) return;
    if (academyId) void repo.get<Academy>('academies', academyId).then((a) => setAcademy(a ?? null));
    if (!id) return;
    void repo.get<Enrollment>('enrollments', id).then((e) => {
      if (!e) return;
      setExisting(e);
      setChildId(e.childId);
      setCourse(e.course);
      setStartDate(e.startDate);
      setEndDate(e.endDate ?? '');
      setStatus(e.status);
      // 같은 시간대끼리 묶어서 보여줌
      const map = new Map<string, Weekday[]>();
      for (const s of e.slots) map.set(`${s.start}-${s.end}`, [...(map.get(`${s.start}-${s.end}`) ?? []), s.weekday]);
      setGroups([...map].map(([k, w]) => ({ weekdays: w, start: k.split('-')[0], end: k.split('-')[1] })));
    });
  }, [repo, id, academyId]);

  // 최신 비용 조건이 바뀌면 폼에 채움 (null = 아직 한 번도 보지 않음)
  const latestCost = myCosts[0];
  const [prevCostId, setPrevCostId] = useState<string | undefined | null>(null);
  if (latestCost?.id !== prevCostId) {
    setPrevCostId(latestCost?.id);
    if (latestCost) {
      setCostAmount(latestCost.amount);
      setPayDay(String(latestCost.payDay));
      setTiming(latestCost.timing);
      setCycle(latestCost.cycle);
    }
  }

  const setGroup = (i: number, patch: Partial<(typeof groups)[number]>) =>
    setGroups((g) => g.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function save() {
    if (!repo || !academy) return;
    const slots: TimeSlot[] = groups.flatMap((g) => g.weekdays.map((weekday) => ({ weekday, start: g.start, end: g.end })));
    if (slots.length === 0) return setError('요일을 하나 이상 골라 주세요.');
    if (groups.some((g) => g.weekdays.length && g.end <= g.start)) return setError('끝나는 시각이 시작보다 늦어야 합니다.');
    const data: Enrollment = {
      childId,
      academyId: academy.id,
      course: course.trim(),
      slots,
      startDate,
      endDate,
      status,
    };
    const enrollmentId = existing?.id ?? ulid();
    const ops: Op[] = [
      existing
        ? { type: 'update', col: 'enrollments', id: enrollmentId, patch: data as unknown as Record<string, unknown>, expectVersion: existing.version }
        : { type: 'create', col: 'enrollments', id: enrollmentId, data: data as unknown as Record<string, unknown> },
    ];
    // 비용 조건: 값이 바뀌었을 때만 적용 시작일 기준으로 새로 저장 (이미 만든 청구 금액은 그대로, A-08)
    const day = Math.min(31, Math.max(1, Number(payDay) || 1));
    const cur = myCosts[0];
    const changed = !cur || cur.amount !== costAmount || cur.payDay !== day || cur.timing !== timing || cur.cycle !== cycle;
    if (!isChild && costAmount > 0 && changed) {
      const from = effectiveFrom || (cur ? `${today().slice(0, 7)}-01` : startDate);
      const costId = `${enrollmentId}:${from}`;
      const cost: EnrollmentCost = { enrollmentId, effectiveFrom: from, amount: costAmount, payDay: day, timing, cycle };
      const same = myCosts.find((c) => c.id === costId);
      ops.push(
        same
          ? { type: 'update', col: 'enrollmentCosts', id: costId, patch: cost as unknown as Record<string, unknown>, expectVersion: same.version }
          : { type: 'create', col: 'enrollmentCosts', id: costId, data: cost as unknown as Record<string, unknown> },
      );
    }
    const r = await repo.applyBatch(ops, writeContext(`수강 ${existing ? '수정' : '등록'}: ${academy.name}`));
    if (!r.ok) return setError('다른 기기에서 먼저 수정했습니다. 다시 열어 주세요.');
    goBack('/academies');
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: `${academy?.name ?? ''} 수강` }} />
      <Label>아이</Label>
      <ChipSelect options={CHILDREN.map((c) => ({ value: c.id, label: c.name }))} value={childId} onChange={setChildId} />
      <TextInput mode="outlined" dense label="반·과정 (예: 고1 정규반)" value={course} onChangeText={setCourse} />

      <Label>요일·시간</Label>
      {groups.map((g, i) => (
        <Card key={i} mode="outlined" style={styles.card}>
          <Card.Content>
            <WeekdayChips value={g.weekdays} onChange={(w) => setGroup(i, { weekdays: w })} />
            <View style={styles.row}>
              <TimeField label="시작" value={g.start} onChange={(v) => setGroup(i, { start: v })} />
              <TimeField label="끝" value={g.end} onChange={(v) => setGroup(i, { end: v })} />
              {groups.length > 1 && <IconButton icon="close" accessibilityLabel="시간 묶음 빼기" onPress={() => setGroups((x) => x.filter((_, j) => j !== i))} />}
            </View>
          </Card.Content>
        </Card>
      ))}
      <Button icon="plus" onPress={() => setGroups((g) => [...g, { weekdays: [], start: g.at(-1)?.start ?? '18:00', end: g.at(-1)?.end ?? '20:00' }])}>
        요일마다 시간이 다르면 줄 추가
      </Button>

      <Label>기간</Label>
      <View style={styles.row}>
        <DateField label="시작일" value={startDate} onChange={setStartDate} />
        <DateField label="종료일 (비우면 계속)" value={endDate} onChange={setEndDate} />
      </View>

      {existing && (
        <>
          <Label>상태</Label>
          <ChipSelect options={STATUS} value={status} onChange={setStatus} />
          <Text style={styles.hint}>휴원·종료로 바꾸면 이후 시간표에서 빠집니다. 지난 기록은 남습니다.</Text>
        </>
      )}

      {!isChild && (
        <Card mode="outlined" style={styles.costCard}>
          <Card.Title title="수강료 (부모만)" subtitle="입력하면 매달 청구가 자동으로 만들어집니다" titleVariant="titleMedium" />
          <Card.Content style={styles.gapCol}>
            <MoneyInput label="월 수강료" value={costAmount} onChange={setCostAmount} />
            <ChipSelect
              options={[
                { value: 'monthly' as PayCycle, label: '매월 자동 청구' },
                { value: 'manual' as PayCycle, label: '직접 입력 (회차제·특강)' },
              ]}
              value={cycle}
              onChange={setCycle}
            />
            {cycle === 'monthly' && (
              <>
                <View style={styles.row}>
                  <TextInput mode="outlined" dense label="결제일 (매월 N일)" value={payDay} onChangeText={setPayDay} keyboardType="number-pad" style={styles.flex} />
                  <View style={styles.flex}>
                    <ChipSelect
                      options={[
                        { value: 'prepaid' as PayTiming, label: '선납' },
                        { value: 'postpaid' as PayTiming, label: '후납' },
                      ]}
                      value={timing}
                      onChange={setTiming}
                    />
                  </View>
                </View>
                {existing && myCosts.length > 0 && (
                  <DateField label="변경 적용 시작일 (비우면 이번 달 1일)" value={effectiveFrom} onChange={setEffectiveFrom} />
                )}
              </>
            )}
            {myCosts.length > 0 && (
              <Text variant="bodySmall" style={styles.hint}>
                이력: {myCosts.map((c) => `${c.effectiveFrom}부터 ${won(c.amount)}(${c.payDay}일)`).join(' · ')}
              </Text>
            )}
          </Card.Content>
        </Card>
      )}

      {error && <HelperText type="error">{error}</HelperText>}
      <Button mode="contained" onPress={save} style={styles.save} disabled={!academy}>
        저장
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  hint: { opacity: 0.7, marginTop: 4 },
  save: { marginTop: 16 },
  costCard: { marginTop: 16 },
  gapCol: { gap: 8 },
  flex: { flex: 1 },
});
