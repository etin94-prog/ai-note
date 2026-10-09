import { router, Stack } from 'expo-router';
import { Button, PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { theme } from '@/lib/theme';
import { RepositoryProvider } from '@/state/RepositoryContext';

/** 돌아갈 화면 기록이 없을 때(주소로 바로 열기·새로고침) 머리말 왼쪽에 [홈] — 메뉴로 돌아갈 길 확보 */
function HomeButton() {
  return (
    <Button icon="home-variant" compact onPress={() => router.replace('/')}>
      홈
    </Button>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <RepositoryProvider>
          <Stack
            screenOptions={({ navigation }) => ({
              headerShown: true,
              headerBackTitle: '뒤로',
              // 뒤로 갈 곳이 있으면 기본 [뒤로], 없으면 [홈]
              ...(navigation.canGoBack() ? {} : { headerLeft: () => <HomeButton /> }),
            })}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="settings/storage" options={{ title: '저장 모드' }} />
            <Stack.Screen name="academies" options={{ title: '학원' }} />
            <Stack.Screen name="academy" options={{ title: '학원' }} />
            <Stack.Screen name="enrollment" options={{ title: '수강' }} />
            <Stack.Screen name="event" options={{ title: '일정' }} />
            <Stack.Screen name="occurrence" options={{ title: '일정' }} />
            <Stack.Screen name="places" options={{ title: '장소' }} />
            <Stack.Screen name="holidays" options={{ title: '방학·휴일' }} />
            <Stack.Screen name="bill" options={{ title: '청구' }} />
            <Stack.Screen name="expense" options={{ title: '기타 지출' }} />
          </Stack>
        </RepositoryProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
