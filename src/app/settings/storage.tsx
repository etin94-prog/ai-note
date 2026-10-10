import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Chip, HelperText, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { ulid } from 'ulid';

import { Screen } from '@/components/Screen';
import { FetchGitHubApi, GitHubApiError } from '@/data/github/GitHubApi';
import { cleanToken, looksLikeToken } from '@/data/github/token';
import type { StoredDoc } from '@/data/repository';
import { BUILD_VERSION } from '@/lib/config';
import { firebaseConfigFromEnv } from '@/lib/firebase';
import { useRepository } from '@/state/RepositoryContext';
import type { DeviceSettings, StorageMode } from '@/state/settings';
import { MIRROR_REPOS } from '@/domain/childMirror';
import { memberById, type MemberId } from '@/domain/types';
import { FirebaseAccountPanel } from '@/components/FirebaseAccountPanel';

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
  const { settings, updateSettings, repo, writeContext, refresh, lastSyncAt, syncError, mirror, syncMirrors } = useRepository();
  const [draft, setDraft] = useState<DeviceSettings>(settings);
  // 저장된 설정을 늦게 읽어오므로 반영
  const [prevSettings, setPrevSettings] = useState(settings);
  if (settings !== prevSettings) {
    setPrevSettings(settings);
    setDraft(settings);
  }
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

  /** 사용자 선택 시 GitHub 저장소 기본값: 부모 = ai-note-data, 아이 = 본인 읽기 전용 사본 (D-14) */
  const chooseMember = (memberId: string) =>
    setDraft((d) => {
      const mirrorRepo = MIRROR_REPOS[memberId as MemberId];
      const known = ['ai-note-data', ...Object.values(MIRROR_REPOS)];
      const repoName = known.includes(d.github.repo) ? (mirrorRepo ?? 'ai-note-data') : d.github.repo;
      return { ...d, memberId, github: { ...d.github, repo: repoName } };
    });
  const draftIsChild = memberById(draft.memberId)?.role === 'child';

  async function checkGitHub() {
    setCheck(null);
    setCheckError(null);
    const token = tokenInput ? cleanToken(tokenInput) : draft.github.token;
    if (!token) return setCheckError('토큰을 입력해 주세요.');
    if (!looksLikeToken(token)) return setCheckError('토큰 형식이 아닙니다. github_pat_ 로 시작하는 값 전체를 붙여넣어 주세요.');
    try {
      const api = new FetchGitHubApi({ owner: draft.github.owner.trim(), repo: draft.github.repo.trim() }, token);
      const tree = await api.readTree();
      const files = tree.notModified ? 0 : tree.entries.filter((e) => e.path.startsWith('data/')).length;
      const exp = api.tokenExpiresAt ? ` · 토큰 만료 ${api.tokenExpiresAt.slice(0, 10)}` : '';
      setCheck(`연결됨 · ${draft.github.owner}/${draft.github.repo} · 데이터 파일 ${files}개${exp}`);
    } catch (e) {
      const status = e instanceof GitHubApiError ? e.status : null;
      const msg = e instanceof Error ? e.message : String(e);
      setCheckError(
        status === 401
          ? '토큰이 올바르지 않거나 만료·폐기되었습니다. (401)'
          : status === 403
            ? '토큰에 이 저장소의 Contents 권한이 없거나 요청 한도를 넘었습니다. (403)'
            : status === 404
              ? `저장소 ${draft.github.owner}/${draft.github.repo} 를 찾을 수 없거나, 토큰의 Repository access 에 이 저장소가 없습니다. (404)`
              : status === 409
                ? '저장소가 비어 있습니다. README 를 하나 만들어 주세요. (409)'
                : `연결 실패: ${msg} — 인터넷 연결을 확인해 주세요.`,
      );
    }
  }

  function save() {
    const next: DeviceSettings = {
      ...draft,
      github: {
        owner: draft.github.owner.trim(),
        repo: draft.github.repo.trim(),
        token: tokenInput ? cleanToken(tokenInput) : draft.github.token,
      },
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
              <Chip key={m.id} selected={draft.memberId === m.id} showSelectedOverlay onPress={() => chooseMember(m.id)}>
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
              { value: 'demo', label: '체험', icon: 'flask-outline' },
            ]}
          />
          {draft.mode === 'demo' && (
            <HelperText type="info">
              체험 모드는 이 기기 브라우저에만 보관되고 가족과 공유되지 않습니다. 써 보기·시연용입니다.
            </HelperText>
          )}
          {!firebaseReady && <HelperText type="info">Firebase 설정값이 아직 없습니다 (가이드 2단계 후 사용 가능).</HelperText>}

          {draft.mode === 'github' && (
            <View style={styles.gap}>
              <TextInput mode="outlined" label="소유자" value={draft.github.owner} onChangeText={(owner) => set({ github: { ...draft.github, owner } })} />
              <TextInput mode="outlined" label="데이터 저장소" value={draft.github.repo} onChangeText={(repo) => set({ github: { ...draft.github, repo } })} />
              {draftIsChild && (
                <HelperText type="info">
                  아이 폰은 본인 사본 저장소({draft.github.repo})를 읽기 전용 토큰으로 연결합니다. 부모 폰이 저장할 때 자동으로 갱신됩니다.
                </HelperText>
              )}
              <TextInput
                mode="outlined"
                label={draft.github.token ? '토큰 저장됨 — 바꿀 때만 입력' : 'GitHub 토큰 (github_pat_…)'}
                value={tokenInput}
                onChangeText={setTokenInput}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              <HelperText type="info">
                토큰은 이 기기에만 저장되고 다시 표시되지 않습니다. 채팅·메신저로 보내지 마세요. (앱 버전 {BUILD_VERSION})
              </HelperText>
              <Button mode="outlined" icon="lan-connect" onPress={checkGitHub}>
                연결 확인
              </Button>
              {check && <HelperText type="info">{check}</HelperText>}
              {checkError && <HelperText type="error">{checkError}</HelperText>}
            </View>
          )}

          {draft.mode === 'firebase' && <FirebaseAccountPanel />}
        </Card.Content>
        <Card.Actions>
          <Button mode="contained" disabled={!canSave} onPress={save}>
            저장
          </Button>
        </Card.Actions>
      </Card>

      {repo && (
        <Card style={styles.card} mode="outlined">
          <Card.Title title="기기 간 동기화 확인" titleVariant="titleMedium" />
          <Card.Content>
            <Text variant="bodyMedium">
              한 기기에서 [테스트 기록 쓰기] → 다른 기기에서 목록에 나타나는지 확인합니다. GitHub 모드는 최대 1분 또는 [지금 가져오기].
            </Text>
            <Text variant="bodySmall" style={styles.meta}>
              {settings.mode === 'github' ? `마지막 가져오기: ${lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString('ko-KR') : '-'}` : '실시간 연결'}
              {syncError ? ` · 오류: ${syncError}` : ''}
            </Text>
            {tests.map((t) => (
              <Text key={t.id} variant="bodySmall">
                • {t.name} (v{t.version}, {t.updatedBy})
              </Text>
            ))}
          </Card.Content>
          <Card.Actions style={styles.wrapActions}>
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

      {settings.mode === 'github' && memberById(settings.memberId)?.role === 'parent' && repo && (
        <Card style={styles.card} mode="outlined">
          <Card.Title title="아이 폰용 사본" subtitle="아이별 읽기 전용 저장소 (본인 일정만, 비용 없음)" titleVariant="titleMedium" />
          <Card.Content>
            {!mirror ? (
              <Text variant="bodySmall">데이터가 바뀌면 몇 초 뒤 자동으로 갱신합니다.</Text>
            ) : (
              <>
                <Text variant="bodySmall" style={styles.meta}>
                  마지막 갱신 {new Date(mirror.at).toLocaleTimeString('ko-KR')}
                </Text>
                {mirror.results.map((r) => (
                  <Text key={r.child} variant="bodySmall" style={r.error ? styles.err : undefined}>
                    • {memberById(r.child)?.name}: {r.error ?? (r.changed ? `${r.changed}개 파일 갱신` : '변경 없음')}
                  </Text>
                ))}
              </>
            )}
          </Card.Content>
          <Card.Actions>
            <Button icon="sync" onPress={() => void syncMirrors()}>
              지금 갱신
            </Button>
          </Card.Actions>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  err: { color: '#DC2626' },
  // 폰 폭에서 버튼이 화면 밖으로 밀리지 않게 줄바꿈
  wrapActions: { flexWrap: 'wrap', rowGap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 },
  gap: { gap: 8, marginTop: 12 },
  meta: { marginVertical: 8, opacity: 0.7 },
});
