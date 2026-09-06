import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { invalidateSessionLayout, useSessionListHandoff } from '@/components/session/session-entry';
import { Ionicons } from '@expo/vector-icons';
import { SessionRow } from '@/components/session/session-row';
import { Text } from '@/components/ui/text';
import { Input } from '@/components/ui/input';
import { radius, spacing, type ThemeColors, useTheme, useThemeStyles } from '@/lib/theme';
import { baseName } from '@/lib/util';
import { useApp, type SessionInfo } from '@/store/app';

export default function SessionsScreen() {
  const handoff = useSessionListHandoff('/sessions');
  const { width, height } = useWindowDimensions();
  const { colors, isDark } = useTheme();
  const styles = useThemeStyles(createStyles);
  const sessions = useApp((s) => s.sessions);
  const workspaces = useApp((s) => s.workspaces);
  const running = useApp((s) => s.running);
  const pendingInteractions = useApp((s) => s.pendingInteractions);
  const pinnedSessionIds = useApp((s) => s.pinnedSessionIds);
  const togglePinnedSession = useApp((s) => s.togglePinnedSession);
  const status = useApp((s) => s.status);
  const refresh = useApp((s) => s.refresh);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const pinned = useMemo(() => new Set(pinnedSessionIds), [pinnedSessionIds]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byPath = new Map<string, SessionInfo[]>();
    for (const session of sessions) {
      const path = session.workspace?.workspacePath ?? '(未知工作区)';
      if (q && !(session.title ?? '').toLowerCase().includes(q) && !path.toLowerCase().includes(q)) continue;
      const list = byPath.get(path) ?? [];
      list.push(session);
      byPath.set(path, list);
    }
    for (const workspace of workspaces) {
      if ((!q || workspace.workspacePath.toLowerCase().includes(q)) && !byPath.has(workspace.workspacePath)) byPath.set(workspace.workspacePath, []);
    }
    return [...byPath.entries()]
      .map(([path, items]) => ({ path, title: baseName(path), sessions: items.sort((a, b) => Number(pinned.has(b.sessionId)) - Number(pinned.has(a.sessionId)) || b.updatedAt - a.updatedAt), pinned: items.some((session) => pinned.has(session.sessionId)), lastActive: items[0]?.updatedAt ?? 0 }))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastActive - a.lastActive || a.title.localeCompare(b.title));
  }, [pinned, query, sessions, workspaces]);
  useLayoutEffect(() => { invalidateSessionLayout('/sessions'); }, [groups, collapsed, width, height]);

  const openSession = useCallback((session: SessionInfo) => {
    router.push({ pathname: '/chat/[id]', params: { id: session.sessionId, title: session.title ?? '', workspacePath: session.workspace?.workspacePath ?? '', returnTo: 'sessions' } });
  }, []);

  return (
    <View {...handoff} collapsable={false} style={styles.screen}>
      <View style={styles.header}>
        <View><Text variant="primary" style={styles.headerTitle}>会话</Text><Text variant="muted" style={styles.headerSubtitle}>{workspaces.length} 个工作区 · {sessions.length} 个会话</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="新建会话" onPress={() => router.push({ pathname: '/new-session', params: { returnTo: 'sessions' } })} style={({ pressed }) => [styles.newBtn, pressed && styles.pressed]}>
          <Ionicons name="add" color={colors.primaryForeground} size={20} /><Text style={styles.newBtnText}>新会话</Text>
        </Pressable>
      </View>
      <View style={styles.searchWrap}>
        <Ionicons name="search" color={colors.dim} size={18} style={styles.searchIcon} />
        <Input accessibilityLabel="搜索会话或工作区" value={query} onChangeText={setQuery} placeholder="搜索会话或工作区" clearButtonMode="while-editing" style={styles.search} />
        {query && Platform.OS !== 'ios' ? <Pressable accessibilityLabel="清除搜索" onPress={() => setQuery('')} style={styles.clearSearch}><Ionicons name="close-circle" color={colors.dim} size={20} /></Pressable> : null}
      </View>
      <ScrollView onScroll={() => invalidateSessionLayout('/sessions')} contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refresh()} tintColor={isDark ? '#ffffff' : colors.foreground} colors={[isDark ? '#ffffff' : colors.foreground]} progressBackgroundColor={isDark ? colors.surfaceRaised : colors.card} />}>
        {groups.map((group) => {
          const isCollapsed = !query && !!collapsed[group.path];
          return <View key={group.path} style={styles.group}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: !isCollapsed }} accessibilityLabel={`${group.title} 工作区，${group.sessions.length} 个会话`} onPress={() => setCollapsed((value) => ({ ...value, [group.path]: !value[group.path] }))} style={({ pressed }) => [styles.groupHead, pressed && styles.pressed]}>
              <View style={styles.folderIcon}><Ionicons name={isCollapsed ? 'folder-outline' : 'folder-open-outline'} color={colors.foreground} size={19} /></View>
              <View style={styles.groupMain}><Text style={styles.groupTitle} numberOfLines={1}>{group.title}</Text><Text variant="muted" style={styles.groupPath} numberOfLines={1}>{group.path}</Text></View>
              <View style={styles.count}><Text variant="muted" style={styles.countText}>{group.sessions.length}</Text></View>
              <Ionicons name={isCollapsed ? 'chevron-down' : 'chevron-up'} color={colors.dim} size={17} />
            </Pressable>
            {!isCollapsed ? <View style={styles.groupBody}>
              {group.sessions.map((session) => <SessionRow key={session.sessionId} source="/sessions" item={session} running={!!running[session.sessionId]} pending={pendingInteractions.some((item) => item.params.sessionId === session.sessionId)} pinned={pinned.has(session.sessionId)} onPress={openSession} onTogglePin={(item) => void togglePinnedSession(item.sessionId)} />)}
              {group.sessions.length === 0 ? <Text variant="muted" style={styles.noSessions}>这个工作区还没有会话</Text> : null}
              <Pressable accessibilityLabel={`在 ${group.title} 新建会话`} onPress={() => router.push({ pathname: '/new-session', params: { workspace: group.path, returnTo: 'sessions' } })} style={({ pressed }) => [styles.groupNew, pressed && styles.pressed]}><Ionicons name="add-circle-outline" color={colors.mutedForeground} size={18} /><Text variant="muted" style={styles.groupNewText}>在此工作区新建会话</Text></Pressable>
            </View> : null}
          </View>;
        })}
        {groups.length === 0 ? <Text variant="muted" style={styles.empty}>{status !== 'online' ? '尚未连接到电脑' : query ? '没有匹配的会话或工作区' : 'ZCode 还没有可见工作区\n先在电脑端打开一个项目，手机会自动发现'}</Text> : null}
        {groups.length > 0 && !query ? <Text variant="muted" style={styles.workspaceHint}>这里显示 ZCode 会话已经使用过的工作区</Text> : null}
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  headerTitle: { fontSize: 26 }, headerSubtitle: { fontSize: 12, marginTop: 2 },
  newBtn: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: radius.md, backgroundColor: colors.primary, paddingHorizontal: 13 },
  newBtnText: { color: colors.primaryForeground, fontSize: 14, fontWeight: '600' }, pressed: { opacity: 0.78 },
  searchWrap: { marginHorizontal: spacing.lg, position: 'relative', justifyContent: 'center' }, searchIcon: { position: 'absolute', left: 13, zIndex: 1 }, search: { paddingLeft: 40, paddingRight: 40, backgroundColor: colors.surface }, clearSearch: { position: 'absolute', right: 2, width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 40 }, group: { marginBottom: spacing.sm },
  groupHead: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs },
  folderIcon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }, groupMain: { flex: 1, minWidth: 0 }, groupTitle: { fontSize: 15, fontWeight: '700' }, groupPath: { fontSize: 11, marginTop: 2 },
  count: { minWidth: 24, height: 24, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }, countText: { fontSize: 11, fontWeight: '600' },
  groupBody: { paddingLeft: 36 }, noSessions: { fontSize: 13, paddingVertical: spacing.md, textAlign: 'center' },
  groupNew: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: spacing.xs }, groupNewText: { fontSize: 13 }, empty: { textAlign: 'center', lineHeight: 21, marginTop: 80 }, workspaceHint: { fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: spacing.sm },
});
