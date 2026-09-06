import { useCallback, useLayoutEffect, useMemo } from 'react';
import { Animated, FlatList, Pressable, RefreshControl, StyleSheet, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { useSessionNavigation, useSessionSwipe } from '@/lib/session-navigation';
import { Ionicons } from '@expo/vector-icons';
import { SessionRow } from '@/components/session/session-row';
import { beginReopenSessionEntry, invalidateSessionLayout, moveSessionEntry, releaseReopenSessionEntry, useSessionListHandoff } from '@/components/session/session-entry';
import { Text } from '@/components/ui/text';
import { radius, spacing, useTheme, type ThemeColors } from '@/lib/theme';
import { useApp, type SessionInfo } from '@/store/app';

export default function LatestScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const sessions = useApp((s) => s.sessions);
  const running = useApp((s) => s.running);
  const pendingInteractions = useApp((s) => s.pendingInteractions);
  const pinnedSessionIds = useApp((s) => s.pinnedSessionIds);
  const togglePinnedSession = useApp((s) => s.togglePinnedSession);
  const status = useApp((s) => s.status);
  const connectionDetail = useApp((s) => s.connectionDetail);
  const syncError = useApp((s) => s.syncError);
  const refresh = useApp((s) => s.refresh);
  const pinned = useMemo(() => new Set(pinnedSessionIds), [pinnedSessionIds]);
  const recent = useMemo(() => [...sessions].sort((a, b) => Number(pinned.has(b.sessionId)) - Number(pinned.has(a.sessionId)) || b.updatedAt - a.updatedAt).slice(0, 30), [pinned, sessions]);
  const current = useSessionNavigation((s) => s.current);
  const { width, height } = useWindowDimensions();
  useLayoutEffect(() => { invalidateSessionLayout('/latest'); }, [recent, width, height]);
  const handoff = useSessionListHandoff('/latest');
  const returnToChat = useCallback(() => {
    if (current && sessions.some((s) => s.sessionId === current.id)) router.push({ pathname: '/chat/[id]', params: { ...current, returnTo: 'latest' } });
  }, [current, sessions]);
  const canReturn = !!current && sessions.some((s) => s.sessionId === current.id);
  const swipeBackToChat = useSessionSwipe(canReturn ? returnToChat : undefined, undefined, { leftDrag: {
    begin: () => !!current && beginReopenSessionEntry(current.id, '/latest', returnToChat),
    move: moveSessionEntry,
    release: releaseReopenSessionEntry,
  } });

  const openSession = useCallback((session: SessionInfo) => {
    router.push({
      pathname: '/chat/[id]',
      params: {
        id: session.sessionId,
        title: session.title ?? '',
        workspacePath: session.workspace?.workspacePath ?? '',
        returnTo: 'latest',
      },
    });
  }, []);

  return (
    <Animated.View {...handoff} collapsable={false} style={[styles.screen, swipeBackToChat.animatedStyle]} {...swipeBackToChat.panHandlers}>
      <View style={styles.header}>
        {canReturn ? <Pressable accessibilityRole="button" accessibilityLabel="返回刚才的对话" accessibilityHint="也可以向左滑返回刚才的对话" onPress={swipeBackToChat.left} style={styles.returnButton}><Ionicons name="chevron-forward" color={colors.foreground} size={24} /></Pressable> : null}
        <View>
          <Text variant="primary" style={styles.title}>最新</Text>
          <Text variant="muted" style={styles.subtitle}>最近活跃的 ZCode 会话</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="新建会话" onPress={() => router.push('/new-session')} style={({ pressed }) => [styles.newButton, pressed && styles.pressed]}>
          <Ionicons name="add" color={colors.primaryForeground} size={20} />
          <Text style={styles.newButtonText}>新会话</Text>
        </Pressable>
      </View>
      <FlatList
        // Split-row transforms leave the viewport; keep those native views attached
        // so their reverse animation can bring them back. Virtualization stays on.
        removeClippedSubviews={false}
        onScroll={() => invalidateSessionLayout('/latest')}
        data={recent}
        keyExtractor={(item) => item.sessionId}
        renderItem={({ item }) => (
          <SessionRow
            source="/latest"
            item={item}
            running={!!running[item.sessionId]}
            pending={pendingInteractions.some((request) => request.params.sessionId === item.sessionId)}
            pinned={pinned.has(item.sessionId)}
            onPress={openSession}
            onTogglePin={(session) => void togglePinnedSession(session.sessionId)}
          />
        )}
        contentContainerStyle={[styles.list, recent.length === 0 && styles.emptyList]}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refresh()} tintColor="#ffffff" colors={['#ffffff']} progressBackgroundColor="#27272a" />}
        ListHeaderComponent={recent.length > 0 && syncError ? <Text variant="destructive" accessibilityLiveRegion="polite" style={styles.empty}>{syncError}，请下拉重试</Text> : null}
        ListEmptyComponent={<Text variant="muted" accessibilityLiveRegion="polite" style={styles.empty}>{syncError || (status === 'online' ? '还没有会话' : connectionDetail)}</Text>}
        windowSize={5}
      />
    </Animated.View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    returnButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
    title: { fontSize: 26 },
    subtitle: { fontSize: 12, marginTop: 2 },
    newButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: radius.md, backgroundColor: colors.primary, paddingHorizontal: 13 },
    newButtonText: { color: colors.primaryForeground, fontSize: 14, fontWeight: '600' },
    list: { paddingHorizontal: spacing.lg, paddingBottom: 40 },
    emptyList: { flexGrow: 1, justifyContent: 'center' },
    empty: { textAlign: 'center' },
    pressed: { opacity: 0.78 },
  });
}
