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
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="settings/storage" options={{ headerShown: true, title: '저장 모드' }} />
          </Stack>
        </RepositoryProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
