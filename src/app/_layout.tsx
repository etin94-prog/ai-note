import { Stack } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { theme } from '@/lib/theme';
import { RepositoryProvider } from '@/state/RepositoryContext';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <RepositoryProvider>
          <Stack screenOptions={{ headerShown: true, headerBackTitle: '뒤로' }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="settings/storage" options={{ title: '저장 모드' }} />
            <Stack.Screen name="academies" options={{ title: '학원' }} />
            <Stack.Screen name="academy" options={{ title: '학원' }} />
            <Stack.Screen name="enrollment" options={{ title: '수강' }} />
            <Stack.Screen name="event" options={{ title: '일정' }} />
            <Stack.Screen name="occurrence" options={{ title: '일정' }} />
          </Stack>
        </RepositoryProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
