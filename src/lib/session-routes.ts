import type { NativeStackNavigationProp } from 'expo-router';

export type SessionList = 'latest' | 'sessions';
export type SessionTarget = { id: string; title: string; workspacePath: string; returnTo: SessionList };
export const sessionList = (value?: string): SessionList => value === 'sessions' ? 'sessions' : 'latest';
export const listHref = (source: SessionList) => source === 'sessions' ? '/(tabs)/sessions' : '/(tabs)/latest';

export type RootSessionNavigation = NativeStackNavigationProp<Record<string, object | undefined>>;
type RootNavigation = Pick<RootSessionNavigation, 'reset' | 'getState'>;

// Keep the existing tabs key/state (scroll, filters, other tabs), but never keep
// old chat/settings/new-session routes underneath a newly created conversation.
function listRoute(navigation: RootNavigation, source: SessionList) {
  const previous = navigation.getState()?.routes.find((route) => route.name === '(tabs)');
  const state = previous?.state;
  const index = state?.routes.findIndex((route) => route.name === source) ?? -1;
  return {
    ...previous,
    name: '(tabs)',
    state: state && index >= 0 ? {
      key: state.key, index,
      routes: state.routes.map(({ key, name, params, path }) => ({ key, name, params, path })),
    } : { index: 0, routes: [{ name: source }] },
  };
}

export function replaceWithSession(navigation: RootNavigation, target: SessionTarget, panel?: 'settings') {
  navigation.reset({ index: 1, routes: [listRoute(navigation, target.returnTo), {
    name: 'chat/[id]', params: { ...target, ...(panel ? { panel } : {}) },
  }] });
}

export function resetToSessionList(navigation: RootNavigation, source: SessionList) {
  navigation.reset({ index: 0, routes: [listRoute(navigation, source)] });
}
