import { router } from 'expo-router';
import { View } from 'react-native';
import { Button } from '../components/ui';

export function ChildNav() {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="menubar">
      {[
        ['Home', '/child/home'],
        ['Practice', '/child/practice'],
        ['Mistakes', '/child/mistakes'],
        ['Progress', '/child/progress'],
        ['Profile', '/child/profile'],
      ].map(([label, href]) => (
        <View key={href} style={{ flexGrow: 1 }}>
          <Button label={label!} kind="secondary" onPress={() => router.replace(href as never)} />
        </View>
      ))}
    </View>
  );
}
