import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text } from '@/components/ui/text';
import { remoteClient as gateway } from '@/lib/remote-client';
import { useTheme } from '@/lib/theme';
import { parseCommands, type SlashCommand } from '@/lib/slash-commands';
import { useSessionEntry } from '@/components/session/session-entry';

export function ComposerMenu({ workspacePath, query, showUploads, uploadsDisabled, onPick, onSelect, onClose }: {
  workspacePath?: string; query: string; showUploads: boolean; uploadsDisabled: boolean;
  onPick: (images: boolean) => void; onSelect: (name: string) => void; onClose: () => void;
}) {
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const progress = useMemo(() => new Animated.Value(0), []);
  const reducedMotion = useSessionEntry((s) => s.reducedMotion);
  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: reducedMotion ? 0 : 130, useNativeDriver: true }).start();
    return () => progress.stopAnimation();
  }, [progress, reducedMotion]);
  useEffect(() => {
    let alive = true;
    gateway.request<{ commands?: unknown }>('gw.settingsSection', { section: 'commands', ...(workspacePath ? { workspacePath } : {}) })
      .then((result) => { if (alive) setCommands(parseCommands(result.commands)); })
      .catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : '命令加载失败'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [workspacePath, attempt]);
  const filtered = commands.filter((command) => `${command.name} ${command.description}`.toLowerCase().includes(query.toLowerCase()));
  const rowStyle = ({ pressed }: { pressed: boolean }) => [styles.row, pressed && { backgroundColor: colors.surfaceRaised }];
  return <Animated.View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.borderStrong, opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>
    <View style={styles.heading}><Text variant="muted" style={styles.headingText}>{showUploads ? '添加与命令' : '斜杠命令'}</Text><Pressable accessibilityRole="button" accessibilityLabel="关闭辅助菜单" onPress={onClose} style={styles.close}><Ionicons name="close" color={colors.mutedForeground} size={20} /></Pressable></View>
    <ScrollView keyboardShouldPersistTaps="always" style={{ maxHeight: Math.min(300, height * 0.34) }}>
      {showUploads && <>
        {([false, true] as const).map((images) => <Pressable key={String(images)} accessibilityRole="button" disabled={uploadsDisabled} accessibilityLabel={images ? '图片上传' : '文件上传'} onPress={() => onPick(images)} style={(state) => [rowStyle(state), uploadsDisabled && { opacity: 0.4 }]}><Ionicons name={images ? 'image-outline' : 'document-attach-outline'} color={colors.foreground} size={21} /><Text>{images ? '图片上传' : '文件上传'}</Text></Pressable>)}
        <Text variant="muted" style={styles.section}>可用命令 · 点选填入，不自动发送</Text>
      </>}
      {loading ? <View style={styles.row}><ActivityIndicator size="small" color={colors.mutedForeground} /><Text variant="muted">读取 ZCode 命令…</Text></View>
        : error ? <Pressable accessibilityRole="button" accessibilityLabel="重新加载命令" onPress={() => { setLoading(true); setError(''); setAttempt((n) => n + 1); }} style={rowStyle}><View style={styles.grow}><Text>命令加载失败，点此重试</Text><Text variant="muted" numberOfLines={2} style={styles.hint}>{error}</Text></View></Pressable>
          : filtered.length ? filtered.map((command) => <Pressable key={command.name} accessibilityRole="button" accessibilityLabel={`填入命令 /${command.name}，${command.description}`} onPress={() => onSelect(command.name)} style={rowStyle}><Ionicons name="terminal-outline" color={colors.mutedForeground} size={20} /><View style={styles.grow}><Text style={styles.name}>/{command.name}</Text>{!!command.description && <Text variant="muted" numberOfLines={2} style={styles.hint}>{command.description}</Text>}{!!command.inputHint && <Text variant="muted" numberOfLines={1} style={styles.hint}>{command.inputHint}</Text>}</View><Ionicons name="return-up-back" color={colors.dim} size={17} /></Pressable>)
            : <Text variant="muted" style={styles.section}>{query ? '没有匹配的命令' : '当前工作区未提供斜杠命令'}</Text>}
    </ScrollView>
  </Animated.View>;
}

const styles = StyleSheet.create({
  panel: { marginBottom: 8, borderRadius: 24, borderWidth: 1, overflow: 'hidden', elevation: 8 },
  heading: { flexDirection: 'row', alignItems: 'center', paddingLeft: 18 }, headingText: { flex: 1, fontSize: 13 }, close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  row: { minHeight: 52, paddingVertical: 10, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1 }, name: { fontSize: 16, fontWeight: '600' }, hint: { fontSize: 12, marginTop: 3 }, section: { paddingHorizontal: 18, paddingVertical: 12, fontSize: 12 },
});
