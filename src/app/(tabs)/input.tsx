import { Card, Text } from 'react-native-paper';

import { Screen } from '@/components/Screen';

export default function InputScreen() {
  return (
    <Screen>
      <Card mode="outlined">
        <Card.Title title="입력" titleVariant="titleMedium" />
        <Card.Content>
          <Text variant="bodyMedium">채팅·붙여넣기·카톡 가져오기 (Sprint 3)</Text>
        </Card.Content>
      </Card>
    </Screen>
  );
}