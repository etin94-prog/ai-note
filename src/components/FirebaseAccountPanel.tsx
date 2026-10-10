import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';

import { ChipSelect, Label } from '@/components/FormFields';
import {
  authErrorMessage,
  cancelJoin,
  createFamily,
  familyExists,
  logIn,
  logOut,
  normalizeFamilyCode,
  requestJoin,
  resetPassword,
  signUp,
  watchUser,
} from '@/data/firebase/family';
import { memberById, type MemberId, MEMBERS } from '@/domain/types';
import { getFirebase } from '@/lib/firebase';
import { useBusy } from '@/lib/useBusy';
import { useRepository } from '@/state/RepositoryContext';

/**
 * Firebase 모드 연결 (가이드 7단계): 로그인 → 새 가족 만들기(부모) 또는 가족 코드로 참여 요청 → 부모 승인.
 * 비밀번호는 Firebase 로만 보내고 앱·기기 설정에는 저장하지 않는다.
 */
export function FirebaseAccountPanel() {
  const { settings, updateSettings, account } = useRepository();
  const fb = getFirebase();
  const [user, setUser] = useState<{ uid: string; email: string | null } | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [me, setMe] = useState<MemberId>((settings.memberId as MemberId) || 'mom');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, run] = useBusy();

  useEffect(() => {
    if (!fb) return;
    return watchUser(fb.auth, (u) => {
      setUser(u ? { uid: u.uid, email: u.email } : null);
      setReady(true);
    });
  }, [fb]);

  if (!fb) {
    return (
      <HelperText type="info">
        이 앱에는 아직 Firebase 설정값이 들어 있지 않습니다. Firebase 콘솔에서 프로젝트를 만들고 웹 앱 설정값을 넣어 다시 배포해야 합니다 (가이드 1~2단계).
      </HelperText>
    );
  }
  if (!ready) return <Text style={styles.dim}>로그인 상태 확인 중…</Text>;

  const act = (f: () => Promise<void>) =>
    run(async () => {
      setError('');
      setMsg('');
      try {
        await f();
      } catch (e) {
        setError(authErrorMessage(e));
      }
    });
  const familyId = settings.firebase.familyId;
  const switchToFirebase = (fid: string, memberId: string) => updateSettings({ ...settings, mode: 'firebase', memberId, firebase: { familyId: fid } });

  // 1) 로그인 전
  if (!user) {
    return (
      <View style={styles.gap}>
        <Text variant="bodySmall" style={styles.dim}>
          가족마다 각자 이메일로 가입합니다. 비밀번호는 직접 입력하세요 — 앱이나 다른 사람에게 알려 주지 않습니다.
        </Text>
        <TextInput mode="outlined" dense label="이메일" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <TextInput mode="outlined" dense label="비밀번호 (6자 이상)" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
        <View style={styles.row}>
          <Button mode="contained" loading={busy} disabled={busy || !email || !password} onPress={() => act(async () => void (await logIn(fb.auth, email, password)))}>
            로그인
          </Button>
          <Button mode="outlined" disabled={busy || !email || !password} onPress={() => act(async () => void (await signUp(fb.auth, email, password)))}>
            새 계정 만들기
          </Button>
          <Button
            compact
            disabled={busy || !email}
            onPress={() =>
              act(async () => {
                await resetPassword(fb.auth, email);
                setMsg('비밀번호 재설정 메일을 보냈습니다.');
              })
            }>
            비밀번호를 잊었어요
          </Button>
        </View>
        {msg ? <HelperText type="info">{msg}</HelperText> : null}
        {error ? <HelperText type="error">{error}</HelperText> : null}
      </View>
    );
  }

  const who = (
    <View style={styles.between}>
      <Text>
        로그인: <Text style={styles.bold}>{user.email}</Text>
      </Text>
      <Button compact onPress={() => act(() => logOut(fb.auth))}>
        로그아웃
      </Button>
    </View>
  );

  // 2) 연결됨
  if (settings.mode === 'firebase' && account.link) {
    return (
      <View style={styles.gap}>
        {who}
        <Text>
          가족 코드 <Text style={styles.bold}>{familyId}</Text> · {memberById(account.link.memberId)?.name} ({account.link.role === 'parent' ? '부모' : '자녀'})
        </Text>
        <HelperText type="info">연결됐습니다. 다른 가족은 각자 폰에서 로그인한 뒤 이 가족 코드로 참여 요청을 보내면 됩니다. 승인은 더보기 → 가족 구성원.</HelperText>
      </View>
    );
  }

  // 3) 승인 대기
  if (settings.mode === 'firebase' && familyId && account.pending) {
    return (
      <View style={styles.gap}>
        {who}
        <Text>
          가족 코드 <Text style={styles.bold}>{familyId}</Text> 에 참여 요청을 보냈습니다. 부모가 승인하면 자동으로 열립니다.
        </Text>
        <Button
          compact
          style={styles.start}
          onPress={() =>
            act(async () => {
              await cancelJoin(fb.db, familyId, user.uid);
              updateSettings({ ...settings, firebase: { familyId: '' } });
            })
          }>
          요청 취소
        </Button>
        {error ? <HelperText type="error">{error}</HelperText> : null}
      </View>
    );
  }

  // 4) 가족 만들기 또는 참여
  const isParent = memberById(me)?.role === 'parent';
  return (
    <View style={styles.gap}>
      {who}
      <Label>나는</Label>
      <ChipSelect<MemberId> options={MEMBERS.map((m) => ({ value: m.id, label: m.name }))} value={me} onChange={setMe} />
      <Text variant="labelLarge">이미 가족이 있으면 — 가족 코드로 참여</Text>
      <View style={styles.row}>
        <TextInput mode="outlined" dense style={styles.code} label="가족 코드 (예: ABCD-EFGH)" value={code} onChangeText={setCode} autoCapitalize="characters" />
        <Button
          mode="contained-tonal"
          loading={busy}
          disabled={busy || !code.trim()}
          onPress={() =>
            act(async () => {
              const fid = normalizeFamilyCode(code);
              if (!fid) throw new Error('가족 코드는 8자입니다 (예: ABCD-EFGH).');
              if (!(await familyExists(fb.db, fid))) throw new Error('그 가족 코드를 찾을 수 없습니다. 다시 확인해 주세요.');
              await requestJoin(fb.db, fid, user, me);
              switchToFirebase(fid, me);
            })
          }>
          참여 요청
        </Button>
      </View>
      <Text variant="labelLarge">처음이면 — 새 가족 만들기 (부모)</Text>
      <Button
        mode="outlined"
        style={styles.start}
        disabled={busy || !isParent}
        onPress={() =>
          act(async () => {
            const fid = await createFamily(fb.db, user, me);
            switchToFirebase(fid, me);
            setMsg(`가족을 만들었습니다. 가족 코드: ${fid}`);
          })
        }>
        새 가족 만들기
      </Button>
      {!isParent && <HelperText type="info">가족은 아빠나 엄마 계정으로 먼저 만들어야 합니다.</HelperText>}
      {msg ? <HelperText type="info">{msg}</HelperText> : null}
      {error ? <HelperText type="error">{error}</HelperText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  code: { flexGrow: 1, minWidth: 200 },
  start: { alignSelf: 'flex-start' },
  bold: { fontWeight: '700' },
  dim: { opacity: 0.7 },
});
