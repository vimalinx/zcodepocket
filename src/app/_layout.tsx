import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useApp } from '@/store/app';
import { getThemeColors, ThemeProvider } from '@/lib/theme';
import { initializeNotifications } from '@/lib/notifications';
import { SessionEntryOverlay } from '@/components/session/session-entry';
import { initializeAppUpdates } from '@/lib/app-updates';

export default function RootLayout() {
  const hydrate = useApp((s) => s.hydrate);
  const hydrated = useApp((s) => s.hydrated);
  const paired = useApp((s) => s.paired);
  const appearanceMode = useApp((s) => s.appearanceMode);
  const colors = getThemeColors(appearanceMode);

  useEffect(() => {
    void hydrate();
    void initializeNotifications();
    return initializeAppUpdates();
  }, [hydrate]);

  // Do not build a logged-out stack while SecureStore hydration is pending.
  if (!hydrated) return null;

  return (
    <ThemeProvider mode={appearanceMode}>
      <SafeAreaProvider>
        <StatusBar style={appearanceMode === 'dark' ? 'light' : 'dark'} />
        <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Protected guard={!paired}>
              <Stack.Screen name="pair" options={{ gestureEnabled: false }} />
              <Stack.Screen name="scanner" options={{ presentation: 'modal' }} />
            </Stack.Protected>
            <Stack.Protected guard={paired}>
              <Stack.Screen name="settings/[section]" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="chat/[id]" options={{ presentation: 'transparentModal', contentStyle: { backgroundColor: 'transparent' }, animation: 'none', gestureEnabled: false }} />
              <Stack.Screen name="session-settings/[id]" options={{ presentation: 'card', animation: 'none', gestureEnabled: false }} />
              <Stack.Screen name="new-session" options={{ presentation: 'modal' }} />
            </Stack.Protected>
          </Stack>
          <SessionEntryOverlay />
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
