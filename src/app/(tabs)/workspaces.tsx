import { memo, useCallback } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { radius, spacing, type ThemeColors, useTheme, useThemeStyles } from '@/lib/theme';
import { baseName, relTime } from '@/lib/util';
import { useApp, type WorkspaceInfo } from '@/store/app';

const WorkspaceRow = memo(function WorkspaceRow({
  item,
  onNew,
}: {
  item: WorkspaceInfo;
  onNew: (w: WorkspaceInfo) => void;
}) {
  const styles = useThemeStyles(createStyles);
  return (
    <Card style={styles.card}>
      <View style={styles.main}>
        <Text style={styles.name}>{baseName(item.workspacePath)}</Text>
        <Text variant="muted" style={styles.path} numberOfLines={1}>
          {item.workspacePath}
        </Text>
        <Text variant="muted" style={styles.meta}>
          {item.sessionCount} 个会话 · 最近活跃 {relTime(item.lastActive)}
        </Text>
      </View>
      <Pressable style={styles.newBtn} onPress={() => onNew(item)} hitSlop={4}>
        <Text style={styles.newBtnText}>＋ 新会话</Text>
      </Pressable>
    </Card>
  );
});

export default function WorkspacesScreen() {
  const { colors, isDark } = useTheme();
  const styles = useThemeStyles(createStyles);
  const workspaces = useApp((s) => s.workspaces);
  const refresh = useApp((s) => s.refresh);

  const onNew = useCallback((w: WorkspaceInfo) => {
    router.push({ pathname: '/new-session', params: { workspace: w.workspacePath } });
  }, []);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text variant="primary" style={styles.headerTitle}>
          工作区
        </Text>
      </View>
      <FlatList
        data={workspaces}
        keyExtractor={(w) => w.workspaceKey}
        renderItem={({ item }) => <WorkspaceRow item={item} onNew={onNew} />}
        ListEmptyComponent={
          <Text variant="muted" style={styles.empty}>
            暂无工作区
          </Text>
        }
        contentContainerStyle={styles.list}
        windowSize={5}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => void refresh()}
            tintColor={isDark ? '#ffffff' : colors.foreground}
            colors={[isDark ? '#ffffff' : colors.foreground]}
            progressBackgroundColor={isDark ? colors.surfaceRaised : colors.card}
          />
        }
      />
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  headerTitle: { fontSize: 26 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  main: { flex: 1 },
  name: { color: colors.foreground, fontSize: 15, fontWeight: '600' },
  path: { fontSize: 12, marginTop: 2 },
  meta: { fontSize: 12, marginTop: 2 },
  newBtn: {
    backgroundColor: colors.secondary,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newBtnText: { color: colors.foreground, fontSize: 13 },
  empty: { textAlign: 'center', marginTop: 80 },
});
