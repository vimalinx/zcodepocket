import { useEffect } from 'react';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { replaceWithSession, sessionList, type RootSessionNavigation } from '@/lib/session-routes';

// Compatibility for old links. Settings is a child of chat on one visual track;
// returning closes that child first instead of popping directly to the list.
export default function LegacySessionSettings() {
  const params = useLocalSearchParams<{ id: string; title?: string; workspacePath?: string; returnTo?: string }>();
  const navigation = useNavigation<RootSessionNavigation>('/');
  useEffect(() => {
    replaceWithSession(navigation, { id: params.id, title: params.title ?? '', workspacePath: params.workspacePath ?? '', returnTo: sessionList(params.returnTo) }, 'settings');
  }, [navigation, params.id, params.title, params.workspacePath, params.returnTo]);
  return null;
}
