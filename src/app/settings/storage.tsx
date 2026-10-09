import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Chip, HelperText, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { ulid } from 'ulid';

import { Screen } from '@/components/Screen';
import { FetchGitHubApi } from '@/data/github/GitHubApi';
import type { StoredDoc } from '@/data/repository';
import { firebaseConfigFromEnv } from '@/lib/firebase';
import { useRepository } from '@/state/RepositoryContext';
import type { DeviceSettings, StorageMode } from '@/state/settings';

const MEMBERS = [
  { id: 'dad', label: '아빠' },
  { id: 'mom', label: '엄마' },
  { id: 'son', label: '아들' },
  { id: 'daughter', label: '딸' },
];

type TestDoc = StoredDoc<{ name: string; spikeTest: boolean; device: string }>;

/**
 * 저장 모드 연결 (D-13) + Sprint 0 기기 간 동기화 확인(S0-4, S0-5, S0-6).
 * 토큰은 이 화면에 직접 입력하고, 저장 후에는 다시 보여주지 않는다 (G-08).
 */
export default function StorageSettingsScreen() {
  const { settings, updateSettings, repo, writeContext, refresh, lastSyncAt, syncError } = useRepository();
  const [draft, setDraft] = useState<DeviceSettings>(settings);
  // 저장된 설정을 늦게 읽어오므로 반영
  useEffect(() => setDraft(settings), [settings]);
  const [tokenInput, setTokenInput] = useState('');
  const [check, setCheck] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [tests, setTests] = useState<TestDoc[]>([]);
  const firebaseReady = firebaseConfigFromEnv() !== null;

  useEffect(() => {
    if (!repo) return;
    return repo.watch<TestDoc>('places', (docs) => setTests((docs as TestDoc[]).filter((d) => d.spikeTest)));
  }, [repo]);

  const set = (patch: Partial<DeviceSettings>) => setDraft((d) => ({ ...d, ...patch }));

  async function checkGitHub() {
    setCheck(null);
    setCheckError(null);
    const token = tokenInput || draft.github.token;
    if (!token) return setCheckError('토큰을 입력해 주세요.');
    try {
      const api = new FetchGitHubApi({ owner: draft.github.owner, repo: draft.github.repo }, token);
      const tree = await api.readTree();
      const files = tree.notModified ? 0 : tree.entries.filter((e) => e.path.startsWith('data/')).length;
      const exp = api.tokenExpiresAt ? ` · 토큰 만료 ${api.tokenExpiresAt.slice(0, 10)}` : '';
      setCheck(`연결됨 · 데이터 파일 ${files}개${exp}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCheckError(
        msg.includes('401') ? '토큰이 올바르지 않거나 만료되었습니다.' : msg.includes('404') ? '저장소를 찾을 수 없거나 토큰에 권한이 없습니다.' : msg,
      );
    }
  }

  function save() {
    const next: DeviceSettings = {
      ...draft,
      github: { ...draft.github, token: tokenInput || draft.github.token },
    };
    updateSettings(next);
    setTokenInput('');
  }

  const canSave = !!draft.mode && !!draft.memberId && !!draft.deviceName;

  return (
    <Screen>
      <Card style={styles.card}>
        <Card.Title title="이 기기" titleVariant="titleMedium" />
        <Card.Content>
          <Text variant="labelLarge">사용자</Text>
          <View style={styles.chips}>
            {MEMBERS.map((m) => (
              <Chip key={m.id} selected={draft.memberId === m.id} showSelectedOverlay onPress={() => set({ memberId: m.id })}>
                {m.label}
              </Chip>
            ))}
          </View>
          <TextInput
            mode="outlined"
            label="기기 이름 (예: 엄마 아이폰)"
            value={draft.deviceName}
            onChangeText={(deviceName) => set({ deviceName })}
          />
        </Card.Content>
      </Card>

      <Card style={styles.card}>
        <Card.Title title="저장 모드" titleVariant="titleMedium" />
        <Card.Content>
          <SegmentedButtons
            value={draft.mode ?? ''}
            onValueChange={(v) => set({ mode: v as StorageMode })}
            buttons={[
              { value: 'github', label: 'GitHub', icon: 'github' },
              { value: 'firebase', label: 'Firebase', icon: 'firebase', disabled: !firebaseReady },
            ]}
          />
          {!firebaseReady && <HelperText type="info">Firebase 설정값이 아직 없습니다 (가이드 2단계 후 사용 가능).</HelperText>}

          {draft.mode === 'github' && (
            <View style={styles.gap}>
              <TextInput mode="outlined" label="소유자" value={draft.github.owner} onChangeText={(owner) => set({ github: { ...draft.github, owner } })} />
              <TextInput mode="outlined" label="데이터 저장소" value={draft.github.repo} onChangeText={(repo) => set({ github: { ...draft.github, repo } })} />
              <TextInput
                mode="outlined"
                label={draft.github.token ? '토큰 저장됨 — 바꿀 때만 입력' : 'GitHub 토큰 (github_pat_…)'}
                value={tokenInput}
                onChangeText={setTokenInput}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              <HelperText type="info">토큰은 이 기기에만 저장되고 다시 표시되지 않습니다. 채팅·메신저로 보내지 마세요.</HelperText>
              <Button mode="outlined" icon="lan-connect" onPress={checkGitHub}>
                연결 확인
              </Button>
              {check && <HelperText type="info">{check}</HelperText>}
              {checkError && <HelperText type="error">{checkError}</HelperText>}
            </View>
          )}

          {draft.mode === 'firebase' && (
            <View style={styles.gap}>
              <TextInput
                mode="outlined"
                label="가족 ID"
                value={draft.firebase.familyId}
                onChangeText={(familyId) => set({ firebase: { familyId } })}
              />
              <HelperText type="info">로그인·가족 만들기 화면은 Firebase 설정 후 연결합니다.</HelperText>
            </View>
          )}
        </Card.Content>
        <Card.Actions>
          <Button mode="contained" disabled={!canSave} onPress={save}>
            저장
          </Button>
        </Card.Actions>
      </Card>

      {repo && (
        <Card style={styles.card} mode="outlined">
          <Card.Title title="기기 간 동기화 확인 (Sprint 0)" titleVariant="titleMedium" />
          <Card.Content>
            <Text variant="bodyMedium">
              한 기기에서 [테스트 기록 쓰기] → 다른 기기에서 목록에 나타나는지 확인합니다. GitHub 모드는 최대 1분 또는 [지금 가져오기].
            </Text>
            <Text variant="bodySmall" style={styles.meta}>
              {settings.mode === 'github' ? `마지막 가져오기: ${lastSyncAt ? lastSyncAt.slice(11, 19) : '-'}` : '실시간 연결'}
              {syncError ? ` · 오류: ${syncError}` : ''}
            </Text>
            {tests.map((t) => (
              <Text key={t.id} variant="bodySmall">
                • {t.name} (v{t.version}, {t.updatedBy})
              </Text>
            ))}
          </Card.Content>
          <Card.Actions>
            <Button onPress={() => void refresh()}>지금 가져오기</Button>
            <Button
              mode="contained-tonal"
              onPress={() =>
                void repo.create(
                  'places',
                  `spike-${ulid()}`,
                  { name: `연결 테스트 · ${settings.deviceName} · ${new Date().toLocaleTimeString('ko-KR')}`, spikeTest: true, device: settings.deviceName },
                  writeContext('연결 테스트 기록'),
                )
              }>
              테스트 기록 쓰기
            </Button>
            <Button
              disabled={tests.length === 0}
              onPress={() =>
                void repo.applyBatch(
                  tests.map((t) => ({ type: 'delete' as const, col: 'places' as const, id: t.id, expectVersion: t.version })),
                  writeContext('연결 테스트 기록 삭제'),
                )
              }>
              테스트 지우기
            </Button>
          </Card.Actions>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 },
  gap: { gap: 8, marginTop: 12 },
  meta: { marginVertical: 8, opacity: 0.7 },
});
