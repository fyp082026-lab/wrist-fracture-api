import { Redirect } from 'expo-router';
import { Loading, Screen } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';

export default function Index() {
  const { session, initializing } = useAuth();
  if (initializing) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }
  return <Redirect href={session ? '/home' : '/sign-in'} />;
}
