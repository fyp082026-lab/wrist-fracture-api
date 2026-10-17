import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { Loading, Screen } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';

/** Landing route for email-confirmation links. AuthContext redeems the code. */
export default function AuthCallback() {
  const { session, linkMessage } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (session) return; // AuthGate moves on to the app
    if (linkMessage) {
      router.replace('/sign-in');
      return;
    }
    const t = setTimeout(() => router.replace('/sign-in'), 10000);
    return () => clearTimeout(t);
  }, [session, linkMessage, router]);

  return (
    <Screen scroll={false}>
      <Loading label="Confirming your email…" />
    </Screen>
  );
}
