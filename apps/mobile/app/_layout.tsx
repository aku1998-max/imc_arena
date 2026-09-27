import {
  Lexend_400Regular,
  Lexend_500Medium,
  Lexend_600SemiBold,
  Lexend_700Bold,
  useFonts,
} from '@expo-google-fonts/lexend';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '../src/session';
import { colors } from '../src/theme';

// Keep the native splash (brand logo) up until the fonts are ready.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Lexend_400Regular,
    Lexend_500Medium,
    Lexend_600SemiBold,
    Lexend_700Bold,
  });
  const ready = loaded || !!error;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);
  // If the font fails to load the app still works with the system font.
  if (!ready) return null;
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}
        />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
