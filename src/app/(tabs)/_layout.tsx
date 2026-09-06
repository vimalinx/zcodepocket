import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { spacing, type ThemeColors, useTheme, useThemeStyles } from '@/lib/theme';
import { useApp } from '@/store/app';
import { useAppUpdates } from '@/lib/app-updates';

function ConnBar() {
  const styles = useThemeStyles(createStyles);
  const status = useApp((s) => s.status);
  if (status === 'online' || status === 'idle') return null;
  return (
    <View style={styles.conn}>
      <Text variant="muted" style={styles.connText}>
        {status === 'connecting' ? '连接电脑中…' : '与电脑断开，重连中…'}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  const hasUpdate = useAppUpdates((state) => Boolean(state.release));
  const { colors } = useTheme();
  const styles = useThemeStyles(createStyles);
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ConnBar />
      <Tabs
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: colors.background },
          tabBarActiveTintColor: colors.foreground,
          tabBarInactiveTintColor: colors.dim,
          tabBarStyle: {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            borderTopWidth: StyleSheet.hairlineWidth,
          },
          tabBarLabelStyle: { fontSize: 12 },
        }}
      >
        <Tabs.Screen
          name="latest"
          options={{
            title: '最新',
            tabBarIcon: ({ color, size }) => <Ionicons name="time-outline" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="sessions"
          options={{
            title: '会话',
            tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles-outline" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="workspaces"
          options={{
            href: null,
          }}
        />
        <Tabs.Screen
          name="account"
          options={{
            title: '账号',
            tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: '设置',
            tabBarBadge: hasUpdate ? '新' : undefined,
            tabBarAccessibilityLabel: hasUpdate ? '设置，有应用更新' : '设置',
            tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={color} size={size} />,
          }}
        />
      </Tabs>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  conn: {
    backgroundColor: colors.muted,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  connText: { fontSize: 12 },
});
