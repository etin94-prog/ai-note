import { DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import { Button, PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ReminderPump } from '@/components/ReminderPump';
import { SavingBar } from '@/components/SavingBar';
import { FONT_FAMILY, PALETTE, theme } from '@/lib/theme';
import { RepositoryProvider } from '@/state/RepositoryContext';

/** 내비게이션(머리말·화면 바탕) 색을 앱 테마와 맞춤 */
const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: PALETTE.bg,
    card: PALETTE.card,
    border: PALETTE.line,
    primary: theme.colors.primary,
    text: PALETTE.text,
  },
  fonts: {
    regular: { fontFamily: FONT_FAMILY, fontWeight: '400' as const },
    medium: { fontFamily: FONT_FAMILY, fontWeight: '500' as const },
    bold: { fontFamily: FONT_FAMILY, fontWeight: '600' as const },
    heavy: { fontFamily: FONT_FAMILY, fontWeight: '700' as const },
  },
};

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
        <ThemeProvider value={navTheme}>
          <RepositoryProvider>
            <ReminderPump />
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
              <Stack.Screen name="excel" options={{ title: '엑셀 동기화' }} />
              <Stack.Screen name="admin" options={{ title: '관리자' }} />
              <Stack.Screen name="setup" options={{ title: '처음 설정' }} />
              <Stack.Screen name="reminders" options={{ title: '알림 설정' }} />
            <Stack.Screen name="stats" options={{ title: '통계' }} />
            <Stack.Screen name="trash" options={{ title: '휴지통' }} />
            </Stack>
            <SavingBar />
          </RepositoryProvider>
        </ThemeProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
