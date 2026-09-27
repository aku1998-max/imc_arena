import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { IconName } from '../../../src/components/ui';
import { colors, fonts } from '../../../src/theme';

const TABS: Array<{ name: string; title: string; icon: IconName }> = [
  { name: 'home', title: 'Home', icon: 'home' },
  { name: 'practice', title: 'Practice', icon: 'book-open' },
  { name: 'mistakes', title: 'Retry', icon: 'rotate-ccw' },
  { name: 'progress', title: 'Progress', icon: 'bar-chart-2' },
  { name: 'profile', title: 'Me', icon: 'user' },
];

export default function ChildTabs() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 12 },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.ink,
          borderTopWidth: 1.5,
          minHeight: 64,
        },
        tabBarItemStyle: { paddingTop: 6 },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarAccessibilityLabel: t.title,
            tabBarIcon: ({ color, size }) => <Feather name={t.icon} size={size} color={color} />,
          }}
        />
      ))}
    </Tabs>
  );
}
