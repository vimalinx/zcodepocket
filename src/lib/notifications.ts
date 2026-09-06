import { AppState, Platform } from 'react-native';
import { router } from 'expo-router';

const CHANNEL_ID = 'zcode-replies';
let initialized = false;
let appIsActive = true;
let notifications: typeof import('expo-notifications') | null = null;

export async function initializeNotifications() {
  if (initialized || Platform.OS === 'web') return;
  initialized = true;
  const Notifications = await import('expo-notifications');
  notifications = Notifications;
  appIsActive = AppState.currentState === 'active';

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });

  AppState.addEventListener('change', (state) => {
    appIsActive = state === 'active';
  });
  Notifications.addNotificationResponseReceivedListener((response) => {
    const sessionId = response.notification.request.content.data?.sessionId;
    if (typeof sessionId === 'string' && sessionId) {
      router.push({ pathname: '/chat/[id]', params: { id: sessionId } });
    }
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'AI 回复完成',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (!current.granted && current.canAskAgain) await Notifications.requestPermissionsAsync();
}

export async function notifySessionComplete(sessionId: string, title: string) {
  if (Platform.OS === 'web' || appIsActive) return;
  const Notifications = notifications ?? await import('expo-notifications');
  await Notifications.scheduleNotificationAsync({
    content: {
      title: title || 'ZCode 回复完成',
      body: 'AI 已完成回复，点此查看。',
      data: { sessionId },
    },
    trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
  });
}
