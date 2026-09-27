import { Stack } from 'expo-router';

/** Tabs for the child's main areas; a practice session opens full screen over them. */
export default function ChildLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="session/[id]" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
