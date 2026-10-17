import { useRouter } from 'expo-router';
import { Button, EmptyState, Screen } from '@/components/ui';

export default function NotFound() {
  const router = useRouter();
  return (
    <Screen>
      <EmptyState
        icon="help-circle-outline"
        title="Page not found"
        body="This link does not lead anywhere in the app."
        action={<Button title="Go home" onPress={() => router.replace('/')} style={{ marginTop: 16, alignSelf: 'stretch' }} />}
      />
    </Screen>
  );
}
