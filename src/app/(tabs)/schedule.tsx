import { Card, Text } from 'react-native-paper';

import { Screen } from '@/components/Screen';

export default function ScheduleScreen() {
  return (
    <Screen>
      <Card mode="outlined">
        <Card.Title title="일정" titleVariant="titleMedium" />
        <Card.Content>
          <Text variant="bodyMedium">오늘 / 주간 시간표 (Sprint 1)</Text>
        </Card.Content>
      </Card>
    </Screen>
  );
}