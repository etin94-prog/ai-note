import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, HelperText, List, Text } from 'react-native-paper';

import { ConfirmButton } from '@/components/ConfirmButton';
import { ChipSelect } from '@/components/FormFields';
import { Screen } from '@/components/Screen';
import { type AccountLink, approveJoin, authErrorMessage, type JoinRequest, rejectJoin, removeLink, watchFamilyAccounts } from '@/data/firebase/family';
import { memberById, type MemberId, MEMBERS } from '@/domain/types';
import { getFirebase } from '@/lib/firebase';
import { useRepository } from '@/state/RepositoryContext';

/** 가족 구성원 (Firebase 모드, 부모 전용): 가족 코드 안내, 가입 요청 승인, 연결된 계정 관리 */
export default function FamilyScreen() {
  const { settings, account, isChild } = useRepository();
  const fb = getFirebase();
  const fid = settings.firebase.familyId;
  const [data, setData] = useState<{ requests: JoinRequest[]; links: (AccountLink & { uid: string })[] }>({ requests: [], links: [] });
  const [pick, setPick] = useState<Record<string, MemberId>>({});
  const [error, setError] = useState('');
  const canManage = settings.mode === 'firebase' && !!fb && !!fid && account.link?.role === 'parent';

  useEffect(() => {
    if (!canManage || !fb) return;
    return watchFamilyAccounts(fb.db, fid, setData);
  }, [canManage, fb, fid]);

  if (settings.mode !== 'firebase') return <Screen><Text>Firebase 모드에서만 사용합니다. (GitHub 모드는 기기마다 토큰으로 연결)</Text></Screen>;
  if (isChild || !canManage || !fb) return <Screen><Text>부모 계정으로 로그인해 가족에 연결된 뒤 사용할 수 있습니다.</Text></Screen>;

  const guard = async (f: () => Promise<void>) => {
    setError('');
    try {
      await f();
    } catch (e) {
      setError(authErrorMessage(e));
    }
  };
  const taken = new Set(data.links.map((l) => l.memberId));

  return (
    <Screen>
      <Card mode="outlined" style={styles.card}>
        <Card.Content style={styles.gap}>
          <Text variant="labelLarge" style={styles.dim}>
            가족 코드
          </Text>
          <Text variant="headlineSmall" style={styles.code} selectable>
            {fid}
          </Text>
          <Text variant="bodySmall" style={styles.dim}>
            다른 가족은 각자 폰에서 더보기 → 저장 모드 → Firebase → 로그인 후 이 코드로 참여 요청을 보냅니다. 코드를 알아도 여기서 승인하기 전에는 아무것도 볼 수 없습니다.
          </Text>
        </Card.Content>
      </Card>

      <Card mode="outlined" style={[styles.card, data.requests.length > 0 && styles.warn]}>
        <Card.Title title={`가입 요청 ${data.requests.length}건`} titleVariant="titleMedium" />
        {data.requests.length === 0 && (
          <Card.Content>
            <Text style={styles.dim}>기다리는 요청이 없습니다.</Text>
          </Card.Content>
        )}
        {data.requests.map((r) => {
          const as = pick[r.uid] ?? r.memberId;
          return (
            <Card.Content key={r.uid} style={styles.req}>
              <Text style={styles.bold}>{r.email}</Text>
              <Text variant="bodySmall" style={styles.dim}>
                본인이 고른 구성원: {memberById(r.memberId)?.name ?? r.memberId} · 요청 {r.requestedAt.slice(0, 10)}
              </Text>
              <ChipSelect<MemberId> options={MEMBERS.map((m) => ({ value: m.id, label: m.name }))} value={as} onChange={(v) => setPick((p) => ({ ...p, [r.uid]: v }))} />
              {taken.has(as) && <HelperText type="info">{memberById(as)?.name} 은(는) 이미 연결된 계정이 있습니다. 기기를 바꾼 경우가 아니면 확인하세요.</HelperText>}
              <View style={styles.row}>
                <Button mode="contained" onPress={() => void guard(() => approveJoin(fb.db, fid, r, as))}>
                  {memberById(as)?.name}(으)로 승인
                </Button>
                <Button onPress={() => void guard(() => rejectJoin(fb.db, fid, r.uid))}>거절</Button>
              </View>
            </Card.Content>
          );
        })}
      </Card>

      <Card mode="outlined" style={styles.card}>
        <Card.Title title="연결된 계정" titleVariant="titleMedium" />
        {data.links.map((l) => (
          <List.Item
            key={l.uid}
            title={`${memberById(l.memberId)?.name ?? l.memberId} · ${l.role === 'parent' ? '부모' : '자녀'}`}
            description={l.email + (l.uid === account.user?.uid ? ' (나)' : '')}
            left={(p) => <List.Icon {...p} icon="account" color={memberById(l.memberId)?.color} />}
            right={() =>
              l.uid === account.user?.uid ? null : (
                <ConfirmButton label="연결 끊기" confirmText="이 계정은 가족 데이터를 볼 수 없게 됩니다" onConfirm={() => guard(() => removeLink(fb.db, fid, l.uid))} />
              )
            }
          />
        ))}
      </Card>
      {error ? <HelperText type="error">{error}</HelperText> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  warn: { borderColor: '#F59E0B' },
  gap: { gap: 4 },
  req: { gap: 4, paddingBottom: 12 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  code: { fontWeight: '700', letterSpacing: 2 },
  bold: { fontWeight: '700' },
  dim: { opacity: 0.7 },
});
