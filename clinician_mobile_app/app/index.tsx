/**
 * Start route ("/"). Shows a spinner while the saved session is read, then
 * redirects: signed in -> /home, signed out -> /sign-in.
 */
import { Redirect } from 'expo-router';
import { Loading, Screen } from '@/ui_components/ui';
import { useAuth } from '@/auth_session/AuthContext';

export default function Index() {
  const { session, role, initializing } = useAuth();
  if (initializing || (session && !role)) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }
  return <Redirect href={session ? '/home' : '/sign-in'} />;
}
