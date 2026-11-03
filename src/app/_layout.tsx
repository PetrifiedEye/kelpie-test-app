import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { OperationProvider } from '@/features/operation/operation-provider';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <OperationProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </OperationProvider>
    </ThemeProvider>
  );
}
