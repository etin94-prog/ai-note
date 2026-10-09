import { useLocalSearchParams } from 'expo-router';

import { BillDetail } from '@/components/BillDetail';

/** 청구 화면 (폰, 또는 PC 에서 주소로 직접 열 때) */
export default function BillScreen() {
  const { id, period } = useLocalSearchParams<{ id?: string; period?: string }>();
  return <BillDetail id={id} period={period} />;
}