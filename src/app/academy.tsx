import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, HelperText, List, Text, TextInput } from 'react-native-paper';
import { ulid } from 'ulid';

import { ChipSelect, Label } from '@/components/FormFields';
import { Screen } from '@/components/Screen';
import type { StoredDoc } from '@/data/repository';
import {
  type Academy,
  type Enrollment,
  memberById,
  PARENTS,
  PAY_TYPE_LABELS,
  type PaymentInfo,
  type PayType,
  WEEKDAY_LABELS,
} from '@/domain/types';
import { useRepository } from '@/state/RepositoryContext';
import { useCollection } from '@/state/useCollection';

const PAY_TYPES = Object.keys(PAY_TYPE_LABELS) as PayType[];

/** 학원 추가·수정 (A-01, A-04) + 납부 정보 (A-10~A-12, 부모 전용) + 수강 목록 */
export default function AcademyScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { repo, writeContext, isChild, readOnly } = useRepository();
  const locked = isChild || readOnly;
  const enrollments = useCollection<Enrollment>('enrollments');

  const [academy, setAcademy] = useState<StoredDoc<Academy> | null>(null);
  const [pay, setPay] = useState<StoredDoc<PaymentInfo> | null>(null);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [teacher, setTeacher] = useState('');
  const [memo, setMemo] = useState('');
  const [payType, setPayType] = useState<PayType>('monthlyLink');
  const [payer, setPayer] = useState<'dad' | 'mom'>('dad');
  const [url, setUrl] = useState('');
  const [bank, setBank] = useState('');
  const [account, setAccount] = useState('');
  const [holder, setHolder] = useState('');
  const [appName, setAppName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repo || !id) return;
    void repo.get<Academy>('academies', id).then((a) => {
      if (!a) return;
      setAcademy(a);
      setName(a.name);
      setSubject(a.subject);
      setAddress(a.address ?? '');
      setPhone(a.phone ?? '');
      setTeacher(a.teacher ?? '');
      setMemo(a.memo ?? '');
    });
    // 납부 정보는 부모 전용 (U-05) — 자녀 기기에서는 읽지 않음
    if (!isChild) void repo.get<PaymentInfo>('paymentInfos', id).then((p) => {
      if (!p) return;
      setPay(p);
      setPayType(p.payType);
      setPayer(p.payer === 'mom' ? 'mom' : 'dad');
      setUrl(p.url ?? '');
      setBank(p.bank ?? '');
      setAccount(p.account ?? '');
      setHolder(p.holder ?? '');
      setAppName(p.appName ?? '');
    });
  }, [repo, id, isChild]);

  async function save(statusOverride?: Academy['status']) {
    if (!repo) return;
    if (!name.trim()) return setError('학원 이름을 입력해 주세요.');
    const academyId = academy?.id ?? ulid();
    const data: Academy = {
      name: name.trim(),
      subject: subject.trim(),
      address: address.trim(),
      phone: phone.trim(),
      teacher: teacher.trim(),
      memo: memo.trim(),
      status: statusOverride ?? academy?.status ?? 'active',
    };
    const payData: PaymentInfo = {
      academyId,
      payType,
      payer,
      url: url.trim(),
      bank: bank.trim(),
      account: account.trim(),
      holder: holder.trim(),
      appName: appName.trim(),
    };
    const ops = [
      academy
        ? { type: 'update' as const, col: 'academies' as const, id: academyId, patch: data as unknown as Record<string, unknown>, expectVersion: academy.version }
        : { type: 'create' as const, col: 'academies' as const, id: academyId, data: data as unknown as Record<string, unknown> },
      pay
        ? { type: 'update' as const, col: 'paymentInfos' as const, id: academyId, patch: payData as unknown as Record<string, unknown>, expectVersion: pay.version }
        : { type: 'create' as const, col: 'paymentInfos' as const, id: academyId, data: payData as unknown as Record<string, unknown> },
    ];
    const r = await repo.applyBatch(ops, writeContext(`학원 ${academy ? '수정' : '추가'}: ${data.name}`));
    if (!r.ok) return setError('다른 기기에서 먼저 수정했습니다. 다시 열어 주세요.');
    if (!academy) router.replace({ pathname: '/academy', params: { id: academyId } });
    else router.back();
  }

  const mine = academy ? enrollments.docs.filter((e) => e.academyId === academy.id) : [];
  const link = payType === 'fixedLink';
  const transfer = payType === 'transfer';
  const app = payType === 'app';

  return (
    <Screen>
      <Stack.Screen options={{ title: academy ? academy.name : '학원 추가' }} />
      <TextInput mode="outlined" editable={!locked} label="학원 이름 *" value={name} onChangeText={setName} style={styles.gap} />
      <TextInput mode="outlined" dense label="과목 (예: 수학, 영어)" value={subject} onChangeText={setSubject} style={styles.gap} />
      <TextInput mode="outlined" dense label="주소 (지도 연결용)" value={address} onChangeText={setAddress} style={styles.gap} />
      <View style={styles.row}>
        <TextInput mode="outlined" dense label="전화" value={phone} onChangeText={setPhone} keyboardType="phone-pad" style={styles.flex} />
        <TextInput mode="outlined" dense label="선생님" value={teacher} onChangeText={setTeacher} style={styles.flex} />
      </View>
      <TextInput mode="outlined" dense label="메모 (차량 시간 등)" value={memo} onChangeText={setMemo} multiline style={styles.gap} />

      {!isChild && (
      <Card mode="outlined" style={styles.card}>
        <Card.Title title="납부 정보" subtitle="부모만 볼 수 있음" titleVariant="titleMedium" />
        <Card.Content>
          <Label>납부 방법</Label>
          <ChipSelect options={PAY_TYPES.map((t) => ({ value: t, label: PAY_TYPE_LABELS[t] }))} value={payType} onChange={setPayType} />
          {payType === 'monthlyLink' && (
            <HelperText type="info">매달 카톡·문자로 오는 링크는 그달 청구서에 붙여넣습니다 (Sprint 2·3).</HelperText>
          )}
          {link && <TextInput mode="outlined" dense label="결제 링크 URL" value={url} onChangeText={setUrl} autoCapitalize="none" style={styles.gap} />}
          {app && <TextInput mode="outlined" dense label="앱 이름" value={appName} onChangeText={setAppName} style={styles.gap} />}
          {transfer && (
            <>
              <View style={styles.row}>
                <TextInput mode="outlined" dense label="은행" value={bank} onChangeText={setBank} style={styles.flex} />
                <TextInput mode="outlined" dense label="예금주" value={holder} onChangeText={setHolder} style={styles.flex} />
              </View>
              <TextInput mode="outlined" dense label="계좌번호" value={account} onChangeText={setAccount} keyboardType="numbers-and-punctuation" style={styles.gap} />
            </>
          )}
          <Label>납부 담당</Label>
          <ChipSelect options={PARENTS.map((p) => ({ value: p.id as 'dad' | 'mom', label: p.name }))} value={payer} onChange={setPayer} />
        </Card.Content>
      </Card>
      )}

      {error && <HelperText type="error">{error}</HelperText>}
      {!locked && (<Button mode="contained" onPress={() => void save()} style={styles.gap}>
        {academy ? '저장' : '저장하고 수강 등록하기'}
      </Button>)}

      {academy && (
        <Card mode="outlined" style={styles.card}>
          <Card.Title title="수강" subtitle="아이·요일·시간 → 시간표 자동 생성" titleVariant="titleMedium" />
          {mine.length === 0 && (
            <Card.Content>
              <Text style={{ opacity: 0.6 }}>아직 수강 등록이 없습니다.</Text>
            </Card.Content>
          )}
          {mine.map((e) => (
            <List.Item
              key={e.id}
              title={`${memberById(e.childId)?.name} ${e.course || ''}${e.status === 'paused' ? ' (휴원)' : e.status === 'ended' ? ' (종료)' : ''}`}
              description={e.slots.map((s) => `${WEEKDAY_LABELS[s.weekday]} ${s.start}~${s.end}`).join(', ')}
              left={(p) => <List.Icon {...p} icon="account-school-outline" />}
              onPress={locked ? undefined : () => router.push({ pathname: '/enrollment', params: { id: e.id, academyId: academy.id } })}
            />
          ))}
          {!locked && <Card.Actions>
            <Button icon="plus" mode="contained-tonal" onPress={() => router.push({ pathname: '/enrollment', params: { academyId: academy.id } })}>
              수강 추가
            </Button>
          </Card.Actions>}
        </Card>
      )}

      {academy && !locked && (
        <Button textColor={academy.status === 'active' ? '#DC2626' : undefined} onPress={() => void save(academy.status === 'active' ? 'closed' : 'active')}>
          {academy.status === 'active' ? '이 학원 그만둠 (기록은 보존)' : '다시 다니기'}
        </Button>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  flex: { flex: 1 },
  card: { marginVertical: 12 },
});
