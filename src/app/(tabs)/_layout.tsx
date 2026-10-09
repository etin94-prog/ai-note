import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

function icon(name: IconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <MaterialCommunityIcons name={name} color={color as string} size={size} />
  );
}

/** 부모 하단 탭 (X-01). 자녀 탭 구성은 Sprint 1에서 역할에 따라 분기. */
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerTitleAlign: 'center' }}>
      <Tabs.Screen name="index" options={{ title: '홈', tabBarIcon: icon('home-variant') }} />
      <Tabs.Screen name="schedule" options={{ title: '일정', tabBarIcon: icon('calendar-week') }} />
      <Tabs.Screen name="cost" options={{ title: '비용', tabBarIcon: icon('cash-multiple') }} />
      <Tabs.Screen name="input" options={{ title: '입력', tabBarIcon: icon('message-text-outline') }} />
      <Tabs.Screen name="more" options={{ title: '더보기', tabBarIcon: icon('dots-horizontal') }} />
    </Tabs>
  );
}
