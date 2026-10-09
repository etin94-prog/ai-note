import { useLocalSearchParams } from 'expo-router';

import { OccurrenceDetail } from '@/components/OccurrenceDetail';

/** 회차 상세 화면 (폰, 또는 PC 에서 주소로 직접 열 때) */
export default function OccurrenceScreen() {
  const { key = '' } = useLocalSearchParams<{ key: string }>();
  return <OccurrenceDetail occKey={key} />;
}