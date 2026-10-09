import { router } from 'expo-router';
import { Button, Card, Text } from 'react-native-paper';

import { InstallPrompt } from '@/components/InstallPrompt';
import { Screen } from '@/components/Screen';
import { SyncIndicator } from '@/components/SyncIndicator';
import { useRepository } from '@/state/RepositoryContext';

/** 홈 (S-V1, 4.3). Sprint 0: 설치 안내·동기화 상태·저장 모드 연결 진입. */
export default function HomeScreen() {
  const { repo } = useRepository();
  return (
    <Screen>
      <SyncIndicator />
      <InstallPrompt />
      {!repo && (
        <Card style={{ marginBottom: 12 }}>
          <Card.Title title="처음 설정" titleVariant="titleMedium" />
          <Card.Content>
            <Text variant="bodyMedium">가족 데이터를 저장할 곳(GitHub 또는 Firebase)을 연결해 주세요.</Text>
          </Card.Content>
          <Card.Actions>
            <Button mode="contained" onPress={() => router.push('/settings/storage')}>
              저장 모드 연결
            </Button>
          </Card.Actions>
        </Card>
      )}
      <Card mode="outlined">
        <Card.Title title="오늘" titleVariant="titleMedium" />
        <Card.Content>
          <Text variant="bodyMedium">일정·처리 필요 목록은 Sprint 1~2에서 채워집니다.</Text>
        </Card.Content>
      </Card>
    </Screen>
  );
}
