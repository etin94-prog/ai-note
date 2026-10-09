import { Card, Text } from 'react-native-paper';

import { Screen } from '@/components/Screen';

export default function CostScreen() {
  return (
    <Screen>
      <Card mode="outlined">
        <Card.Title title="비용" titleVariant="titleMedium" />
        <Card.Content>
          <Text variant="bodyMedium">학원비 청구·납부·환불 기록 (Sprint 2)</Text>
        </Card.Content>
      </Card>
    </Screen>
  );
}