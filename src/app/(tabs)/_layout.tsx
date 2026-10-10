import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { IconButton } from 'react-native-paper';

import { useLayout } from '@/lib/useLayout';
import { useRepository } from '@/state/RepositoryContext';
import { useReminders } from '@/state/useReminders';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

function icon(name: IconName) {
  return function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <MaterialCommunityIcons name={name} color={color as string} size={size} />;
  };
}

/**
 * 하단 탭 (X-01). 부모: 홈·일정·비용·입력·더보기 (+PC 는 알림) / 자녀: 홈·일정·알림·더보기
 * (자녀에게 비용은 보이지 않음 U-05). 부모 폰은 탭이 5개라 알림은 홈 머리말의 종 버튼으로.
 */
export default function TabsLayout() {
  const { isChild } = useRepository();
  const { wide } = useLayout();
  const { unread } = useReminders();
  const badge = unread.length ? (unread.length > 9 ? '9+' : unread.length) : undefined;
  const showInboxTab = isChild || wide;
  return (
    <Tabs
      screenOptions={{
        headerTitleAlign: wide ? 'left' : 'center',
        // PC: 왼쪽 세로 메뉴 (X-16), 폰: 하단 탭
        tabBarPosition: wide ? 'left' : 'bottom',
        tabBarVariant: wide ? 'material' : 'uikit',
        tabBarLabelPosition: wide ? 'beside-icon' : 'below-icon',
        // 기본 사이드바 최소 폭(약 360px)이 본문을 좁히므로 180px 로
        tabBarStyle: wide ? { width: 180, minWidth: 180 } : undefined,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '홈',
          tabBarIcon: icon('home-variant'),
          headerRight: showInboxTab
            ? undefined
            : () => (
                <IconButton
                  icon={unread.length ? 'bell-badge-outline' : 'bell-outline'}
                  accessibilityLabel={`알림 ${unread.length}건`}
                  onPress={() => router.push('/inbox')}
                />
              ),
        }}
      />
      <Tabs.Screen name="schedule" options={{ title: '일정', tabBarIcon: icon('calendar-week') }} />
      <Tabs.Screen name="cost" options={{ title: '비용', tabBarIcon: icon('cash-multiple'), href: isChild ? null : undefined }} />
      <Tabs.Screen name="input" options={{ title: '입력', tabBarIcon: icon('message-text-outline'), href: isChild ? null : undefined }} />
      <Tabs.Screen
        name="inbox"
        options={{ title: '알림', tabBarIcon: icon('bell-outline'), tabBarBadge: badge, href: showInboxTab ? undefined : null }}
      />
      <Tabs.Screen name="more" options={{ title: '더보기', tabBarIcon: icon('dots-horizontal') }} />
    </Tabs>
  );
}
