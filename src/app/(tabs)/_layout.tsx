import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { useRepository } from '@/state/RepositoryContext';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

function icon(name: IconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <MaterialCommunityIcons name={name} color={color as string} size={size} />
  );
}

/**
 * 하단 탭 (X-01). 부모: 홈·일정·비용·입력·더보기 / 자녀: 홈·일정·더보기
 * (자녀에게 비용은 보이지 않음 U-05. 숙제·알림 탭은 R2)
 */
export default function TabsLayout() {
  const { isChild } = useRepository();
  return (
    <Tabs screenOptions={{ headerTitleAlign: 'center' }}>
      <Tabs.Screen name="index" options={{ title: '홈', tabBarIcon: icon('home-variant') }} />
      <Tabs.Screen name="schedule" options={{ title: '일정', tabBarIcon: icon('calendar-week') }} />
      <Tabs.Screen name="cost" options={{ title: '비용', tabBarIcon: icon('cash-multiple'), href: isChild ? null : undefined }} />
      <Tabs.Screen name="input" options={{ title: '입력', tabBarIcon: icon('message-text-outline'), href: isChild ? null : undefined }} />
      <Tabs.Screen name="more" options={{ title: '더보기', tabBarIcon: icon('dots-horizontal') }} />
    </Tabs>
  );
}
