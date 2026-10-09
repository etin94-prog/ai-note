import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Chip, HelperText, IconButton, List, ProgressBar, Text, TextInput } from 'react-native-paper';
import { ulid } from 'ulid';

import { ChipSelect, DateField, Label, TimeField, WeekdayChips } from '@/components/FormFields';
import { MoneyInput } from '@/components/MoneyInput';
import { Screen } from '@/components/Screen';
import { today } from '@/domain/dates';
import { won } from '@/domain/money';
import { buildSetupOps, type DraftAcademy, type DraftEnrollment, emptyDraft, enrollmentProblem, type SetupDraft } from '@/domain/setup';
import { CHILDREN, memberById, type MemberId, PARENTS, PAY_TYPE_LABELS, type PayType, type Place, WEEKDAY_LABELS } from '@/domain/types';
import { useRepository } from '@/state/RepositoryContext';
import { useCollection } from '@/state/useCollection';

const STEPS = ['시작', '장소', '학원', '수강', '확인'] as const;

const newAcademy = (): DraftAcademy => ({ key: ulid(), name: '', subject: '', phone: '', payType: 'monthlyLink', url: '', payer: 'dad' });
const newEnrollment = (academyKey = ''): DraftEnrollment => ({
  key: ulid(),
  academyKey,
  childId: 'son',
  course: '',
  weekdays: [],
  start: '19:00',
  end: '21:00',
  fee: 0,
  payDay: 1,
  startDate: today(),
});

/** 처음 설정 마법사 (I-03): 장소 → 학원 → 수강 → 확인 후 한 번에 저장. 부모 전용. */
export default function SetupScreen() {
  const { repo, isChild, writeContext } = useRepository();
  const places = useCollection<Place>('places');
  const [step, setStep] = useState(0);
  const [d, setD] = useState<SetupDraft>(emptyDraft);
  const [ac, setAc] = useState<DraftAcademy>(newAcademy);
  const [en, setEn] = useState<DraftEnrollment>(() => newEnrollment());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  if (isChild)
    return (
      <Screen>
        <Text>부모만 사용할 수 있습니다.</Text>
      </Screen>
    );
  if (!repo)
    return (
      <Screen>
        <Text>더보기 → 저장 모드 연결 후 사용할 수 있습니다.</Text>
      </Screen>
    );

  const acName = (key: string) => d.academies.find((a) => a.key === key)?.name ?? '';
  const addAcademy = () => {
    if (!ac.name.trim()) return setError('학원 이름을 입력해 주세요');
    if (d.academies.some((a) => a.name.trim() === ac.name.trim())) return setError('이미 추가한 학원입니다');
    setD({ ...d, academies: [...d.academies, ac] });
    setAc(newAcademy());
    setError('');
  };
  const addEnrollment = () => {
    const p = enrollmentProblem(en);
    if (p) return setError(p);
    setD({ ...d, enrollments: [...d.enrollments, en] });
    setEn({ ...newEnrollment(en.academyKey), childId: en.childId });
    setError('');
  };
  const next = () => {
    // 쓰다 만 입력이 있으면 함께 넣는다
    if (step === 2 && ac.name.trim()) {
      if (d.academies.some((a) => a.name.trim() === ac.name.trim())) setAc(newAcademy());
      else return addAcademy();
    }
    if (step === 3 && en.weekdays.length > 0) {
      const p = enrollmentProblem(en);
      if (p) return setError(p);
      setD({ ...d, enrollments: [...d.enrollments, en] });
      setEn(newEnrollment(en.academyKey));
    }
    setError('');
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const ops = buildSetupOps(d, { newId: ulid, existingPlaces: places.docs.map((p) => p.name) });
      if (ops.length === 0) throw new Error('저장할 내용이 없습니다');
      const r = await repo.applyBatch(ops, writeContext(`처음 설정: 학원 ${d.academies.length} · 수강 ${d.enrollments.length}`));
      if (!r.ok) throw new Error('다른 기기에서 먼저 저장했습니다. 다시 시도해 주세요.');
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Text variant="labelLarge" style={styles.dim}>
        {step + 1}/{STEPS.length} {STEPS[step]}
      </Text>
      <ProgressBar progress={(step + 1) / STEPS.length} style={styles.progress} />

      {step === 0 && (
        <Card mode="outlined" style={styles.card}>
          <Card.Title title="처음 설정" titleVariant="titleMedium" />
          <Card.Content style={styles.gap}>
            <Text>집·학교 → 학원 → 수강(요일·시간·수강료) 순서로 한 번에 입력합니다. 마지막에 확인하고 저장합니다.</Text>
            <Text style={styles.dim}>가족: 아빠 · 엄마 · 아들 · 딸 (정해져 있음)</Text>
            <Text style={styles.dim}>학원이 많으면 PC에서 엑셀 빈 양식에 한꺼번에 적어 가져오는 방법도 있습니다.</Text>
          </Card.Content>
          <Card.Actions style={styles.wrap}>
            <Button icon="microsoft-excel" onPress={() => router.push('/excel')}>
              엑셀로 한 번에
            </Button>
            <Button mode="contained" onPress={next}>
              시작
            </Button>
          </Card.Actions>
        </Card>
      )}

      {step === 1 && (
        <Card mode="outlined" style={styles.card}>
          <Card.Title title="집 · 학교" subtitle="등하교·이동 안내에 씁니다. 비워도 됩니다" titleVariant="titleMedium" />
          <Card.Content style={styles.gap}>
            <TextInput
              mode="outlined"
              dense
              label="집 주소 (선택)"
              value={d.homeAddress}
              onChangeText={(v) => setD({ ...d, homeAddress: v })}
            />
            {CHILDREN.map((c) => (
              <TextInput
                key={c.id}
                mode="outlined"
                dense
                label={`${c.name} 학교 이름 (예: 가상중학교)`}
                value={d.schools[c.id as 'son' | 'daughter'] ?? ''}
                onChangeText={(v) => setD({ ...d, schools: { ...d.schools, [c.id]: v } })}
              />
            ))}
          </Card.Content>
        </Card>
      )}

      {step === 2 && (
        <>
          <Card mode="outlined" style={styles.card}>
            <Card.Title title="학원 추가" subtitle="다니는 학원을 하나씩 추가하세요" titleVariant="titleMedium" />
            <Card.Content style={styles.gap}>
              <TextInput mode="outlined" dense label="학원 이름" value={ac.name} onChangeText={(v) => setAc({ ...ac, name: v })} />
              <View style={styles.row}>
                <TextInput
                  mode="outlined"
                  dense
                  style={styles.flex}
                  label="과목"
                  value={ac.subject}
                  onChangeText={(v) => setAc({ ...ac, subject: v })}
                />
                <TextInput
                  mode="outlined"
                  dense
                  style={styles.flex}
                  label="전화"
                  keyboardType="phone-pad"
                  value={ac.phone}
                  onChangeText={(v) => setAc({ ...ac, phone: v })}
                />
              </View>
              <Label>학원비 내는 방법</Label>
              <ChipSelect<PayType>
                options={(Object.entries(PAY_TYPE_LABELS) as [PayType, string][]).map(([value, label]) => ({ value, label }))}
                value={ac.payType}
                onChange={(v) => setAc({ ...ac, payType: v })}
              />
              {ac.payType === 'fixedLink' && (
                <TextInput
                  mode="outlined"
                  dense
                  label="결제 링크"
                  value={ac.url}
                  onChangeText={(v) => setAc({ ...ac, url: v })}
                  autoCapitalize="none"
                />
              )}
              <Label>납부 담당</Label>
              <ChipSelect<MemberId>
                options={PARENTS.map((p) => ({ value: p.id, label: p.name }))}
                value={ac.payer}
                onChange={(v) => setAc({ ...ac, payer: v })}
              />
              <Button mode="contained-tonal" icon="plus" onPress={addAcademy} style={styles.start}>
                학원 추가
              </Button>
            </Card.Content>
          </Card>
          {d.academies.map((a) => (
            <List.Item
              key={a.key}
              title={a.name}
              description={`${a.subject || '과목 없음'} · ${PAY_TYPE_LABELS[a.payType]} · ${memberById(a.payer)?.name}`}
              left={(p) => <List.Icon {...p} icon="school-outline" />}
              right={() => (
                <IconButton
                  icon="close"
                  accessibilityLabel="빼기"
                  onPress={() =>
                    setD({
                      ...d,
                      academies: d.academies.filter((x) => x.key !== a.key),
                      enrollments: d.enrollments.filter((e) => e.academyKey !== a.key),
                    })
                  }
                />
              )}
            />
          ))}
        </>
      )}

      {step === 3 && (
        <>
          {d.academies.length === 0 ? (
            <Text style={styles.dim}>추가한 학원이 없습니다. 이전 단계에서 학원을 먼저 추가하세요.</Text>
          ) : (
            <Card mode="outlined" style={styles.card}>
              <Card.Title title="수강 추가" subtitle="누가 · 어느 학원 · 무슨 요일 몇 시" titleVariant="titleMedium" />
              <Card.Content style={styles.gap}>
                <Label>학원</Label>
                <View style={styles.chips}>
                  {d.academies.map((a) => (
                    <Chip
                      key={a.key}
                      compact
                      selected={en.academyKey === a.key}
                      showSelectedOverlay
                      onPress={() => setEn({ ...en, academyKey: a.key })}>
                      {a.name}
                    </Chip>
                  ))}
                </View>
                <Label>자녀</Label>
                <ChipSelect<MemberId>
                  options={CHILDREN.map((c) => ({ value: c.id, label: c.name }))}
                  value={en.childId}
                  onChange={(v) => setEn({ ...en, childId: v })}
                />
                <Label>요일</Label>
                <WeekdayChips value={en.weekdays} onChange={(w) => setEn({ ...en, weekdays: w })} />
                <View style={styles.row}>
                  <TimeField label="시작" value={en.start} onChange={(v) => setEn({ ...en, start: v })} />
                  <TimeField label="끝" value={en.end} onChange={(v) => setEn({ ...en, end: v })} />
                </View>
                <TextInput
                  mode="outlined"
                  dense
                  label="과정 (선택, 예: 정규반)"
                  value={en.course}
                  onChangeText={(v) => setEn({ ...en, course: v })}
                />
                <MoneyInput label="한 달 수강료 (선택)" value={en.fee} onChange={(v) => setEn({ ...en, fee: v })} quick={false} />
                {en.fee > 0 && (
                  <View style={styles.row}>
                    <TextInput
                      mode="outlined"
                      dense
                      style={styles.flex}
                      label="매달 결제일"
                      keyboardType="number-pad"
                      value={String(en.payDay)}
                      onChangeText={(v) => setEn({ ...en, payDay: Number(v.replace(/\D/g, '')) || 1 })}
                    />
                    <DateField label="다니기 시작한 날" value={en.startDate} onChange={(v) => setEn({ ...en, startDate: v })} />
                  </View>
                )}
                <Button mode="contained-tonal" icon="plus" onPress={addEnrollment} style={styles.start}>
                  수강 추가
                </Button>
              </Card.Content>
            </Card>
          )}
          {d.enrollments.map((e) => (
            <List.Item
              key={e.key}
              title={`${memberById(e.childId)?.name} · ${acName(e.academyKey)}${e.course ? ` ${e.course}` : ''}`}
              description={`${e.weekdays.map((w) => WEEKDAY_LABELS[w]).join(',')} ${e.start}-${e.end}${e.fee ? ` · ${won(e.fee)} (매달 ${e.payDay}일)` : ''}`}
              left={(p) => <List.Icon {...p} icon="calendar-clock" />}
              right={() => (
                <IconButton
                  icon="close"
                  accessibilityLabel="빼기"
                  onPress={() => setD({ ...d, enrollments: d.enrollments.filter((x) => x.key !== e.key) })}
                />
              )}
            />
          ))}
        </>
      )}

      {step === 4 && (
        <Card mode="outlined" style={styles.card}>
          <Card.Title title="이렇게 저장할까요?" titleVariant="titleMedium" />
          <Card.Content style={styles.gap}>
            <Text>
              장소: 집{d.schools.son ? `, ${d.schools.son}` : ''}
              {d.schools.daughter ? `, ${d.schools.daughter}` : ''}
            </Text>
            <Text>
              학원 {d.academies.length}곳: {d.academies.map((a) => a.name).join(', ') || '없음'}
            </Text>
            <Text>수강 {d.enrollments.length}건</Text>
            {d.enrollments.map((e) => (
              <Text key={e.key} style={styles.dim}>
                · {memberById(e.childId)?.name} {acName(e.academyKey)} {e.weekdays.map((w) => WEEKDAY_LABELS[w]).join(',')} {e.start}-
                {e.end}
                {e.fee ? ` ${won(e.fee)}` : ''}
              </Text>
            ))}
            <Text variant="bodySmall" style={styles.dim}>
              저장 후 학원·수강 화면에서 언제든 고칠 수 있습니다. 수강료를 넣은 수강은 비용 탭에서 매달 청구가 자동으로 만들어집니다.
            </Text>
          </Card.Content>
          <Card.Actions>
            <Button mode="contained" icon="check" loading={saving} disabled={saving} onPress={() => void save()}>
              저장
            </Button>
          </Card.Actions>
        </Card>
      )}

      {error ? <HelperText type="error">{error}</HelperText> : null}
      {step > 0 && (
        <View style={styles.nav}>
          <Button onPress={() => setStep((s) => s - 1)} disabled={saving}>
            이전
          </Button>
          {step < STEPS.length - 1 && (
            <Button mode="contained" onPress={next}>
              다음
            </Button>
          )}
        </View>
      )}
      <View style={{ height: 40 }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  dim: { opacity: 0.7 },
  progress: { marginVertical: 8 },
  card: { marginVertical: 8 },
  gap: { gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  start: { alignSelf: 'flex-start' },
  wrap: { flexWrap: 'wrap' },
  nav: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
});
