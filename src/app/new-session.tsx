import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { replaceWithSession, sessionList, type RootSessionNavigation } from '@/lib/session-routes';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/text';
import { remoteClient as gateway } from '@/lib/remote-client';
import { pickPreferredModel } from '@/lib/models';
import { radius, spacing, type ThemeColors, useTheme, useThemeStyles } from '@/lib/theme';
import { baseName } from '@/lib/util';
import { useApp } from '@/store/app';

export default function NewSessionScreen() {
  const { colors } = useTheme();
  const styles = useThemeStyles(createStyles);
  const params = useLocalSearchParams<{ workspace?: string; returnTo?: string }>();
  const navigation = useNavigation<RootSessionNavigation>('/');
  const workspaces = useApp((s) => s.workspaces);
  const providers = useApp((s) => s.providers);

  const [ws, setWs] = useState(params.workspace ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    if (!ws) {
      setError('请选择工作区');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const createParams: Record<string, unknown> = { workspacePath: ws };
      const defaultModel = pickPreferredModel(providers);
      if (defaultModel) createParams.model = { providerId: defaultModel.providerId, modelId: defaultModel.modelId };
      const r = await gateway.request<{ session?: { sessionId: string; title?: string } }>('gw.create', createParams);
      const sid = r.session?.sessionId;
      if (!sid) throw new Error('创建失败');
      replaceWithSession(navigation, { id: sid, title: r.session?.title ?? '新会话', workspacePath: ws, returnTo: sessionList(params.returnTo) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.dismiss()} hitSlop={8} style={styles.back}>
          <Ionicons name="close" color={colors.foreground} size={22} />
        </Pressable>
        <Text variant="primary" style={styles.title}>
          新会话
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="创建会话" disabled={!ws || busy} onPress={() => void create()} style={({ pressed }) => [styles.headerCreate, (!ws || busy) && styles.headerCreateDisabled, pressed && styles.pressed]}>
          {busy ? <Text style={styles.headerCreateText}>创建中…</Text> : <Text style={styles.headerCreateText}>创建</Text>}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="muted" style={styles.section}>
          工作区
        </Text>
        <View style={styles.list}>
          {workspaces.map((item) => (
            <RadioRow
              key={item.workspaceKey}
              label={baseName(item.workspacePath)}
              sub={item.workspacePath}
              selected={ws === item.workspacePath}
              onPress={() => setWs(item.workspacePath)}
            />
          ))}
          {workspaces.length === 0 ? <Text variant="muted" style={styles.empty}>ZCode 还没有可见工作区。先在电脑端打开一个项目，手机会自动发现。</Text> : null}
        </View>
        {error ? (
          <Text variant="destructive" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <Text variant="muted" style={styles.modelHint}>
          默认使用 GLM-5.3-Flash 和全自动模式，创建后可在对话中随时调整。
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function RadioRow({
  label,
  sub,
  selected,
  onPress,
}: {
  label: string;
  sub?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const styles = useThemeStyles(createStyles);
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={`${label} 工作区`} onPress={onPress} style={[styles.radioRow, selected && styles.radioSelected]}>
      <View style={[styles.radio, selected && styles.radioOn]} />
      <View style={styles.radioMain}>
        <Text style={styles.radioLabel} numberOfLines={1}>
          {label}
        </Text>
        {sub ? (
          <Text variant="muted" style={styles.radioSub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  back: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '700' },
  headerCreate: { marginLeft: 'auto', minWidth: 64, height: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 20, backgroundColor: colors.primary },
  headerCreateDisabled: { opacity: 0.3 },
  headerCreateText: { color: colors.primaryForeground, fontSize: 14, fontWeight: '700' },
  section: {
    fontSize: 12,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: 6,
  },
  content: { paddingBottom: spacing.xl },
  list: { paddingHorizontal: spacing.lg },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 9,
    paddingHorizontal: spacing.md,
    marginBottom: 6,
    backgroundColor: colors.card,
  },
  radioSelected: { borderColor: colors.foreground },
  radio: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: colors.dim },
  radioOn: { backgroundColor: colors.foreground, borderColor: colors.foreground },
  radioMain: { flex: 1 },
  radioLabel: { fontSize: 14 },
  radioSub: { fontSize: 11, marginTop: 1 },
  empty: { fontSize: 13, lineHeight: 20, textAlign: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.xl },
  error: { paddingHorizontal: spacing.lg, paddingVertical: 4, fontSize: 13 },
  modelHint: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, fontSize: 12 },
  pressed: { opacity: 0.72 },
});
