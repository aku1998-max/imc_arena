import { Redirect } from 'expo-router';
import { Loading, Screen } from '../src/components/ui';
import { useSession } from '../src/session';

export default function Index() {
  const { mode } = useSession();
  if (mode === 'loading') {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  if (mode === 'child') return <Redirect href="/child/home" />;
  if (mode === 'adult') return <Redirect href="/parent" />;
  return <Redirect href="/welcome" />;
}
