import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { AppThemeProvider, useAppTheme } from '@/lib/app-theme';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  return (
    <AppThemeProvider>
      <RootNavigator />
    </AppThemeProvider>
  );
}

function RootNavigator() {
  const { isMoonlighter, palette } = useAppTheme();
  const navigationTheme = {
    ...(isMoonlighter ? DarkTheme : DefaultTheme),
    colors: {
      ...(isMoonlighter ? DarkTheme.colors : DefaultTheme.colors),
      background: palette.canvas,
      border: palette.border,
      card: palette.surface,
      primary: palette.accent,
      text: palette.text,
    },
  };

  return (
    <ThemeProvider value={navigationTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="flashcard-converter" options={{ headerShown: false }} />
        <Stack.Screen name="flashcard-result" options={{ headerShown: false }} />
        <Stack.Screen name="mock-test-converter" options={{ headerShown: false }} />
        <Stack.Screen name="mock-test-result" options={{ headerShown: false }} />
        <Stack.Screen name="reviewer-converter" options={{ headerShown: false }} />
        <Stack.Screen name="reviewer-result" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar backgroundColor={palette.canvas} style={isMoonlighter ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}
