import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, ToastAndroid, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text } from '@/components/ui/text';
import { remoteClient as gateway } from '@/lib/remote-client';
import { radius, spacing, useTheme, type ThemeColors } from '@/lib/theme';
import { useApp } from '@/store/app';
import { useSessionNavigation } from '@/lib/session-navigation';
import { replaceWithSession, resetToSessionList, type SessionTarget, type RootSessionNavigation } from '@/lib/session-routes';
import { forgetSessionEntry } from './session-entry';
const MODES = [
  { id: 'build', label: '构建', hint: '读取与修改项目，危险操作询问' },
  { id: 'plan', label: '规划', hint: '只分析和制定计划' },
  { id: 'edit', label: '编辑', hint: '自动批准常规文件编辑' },
  { id: 'yolo', label: '全自动', hint: '尽量不询问，谨慎使用' },
] as const;

const showToast = (message: string) => ToastAndroid.show(message, ToastAndroid.SHORT);
export function SessionSettings({ target: params, active, onBack }: { target: SessionTarget; active: boolean; onBack: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const rootNavigation = useNavigation<RootSessionNavigation>('/');
  const sessionId = params.id;
  const title = params.title || '';
  const pinned = useApp((s) => s.pinnedSessionIds.includes(sessionId));
  const togglePinnedSession = useApp((s) => s.togglePinnedSession);
  const refresh = useApp((s) => s.refresh);
  const [mode, setMode] = useState('');
  const [actionBusy, setActionBusy] = useState('loading');
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void (async () => {
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setActionBusy('loading');
      try {
        const detail = await gateway.request<{ settings?: { mode?: string | { current?: string } } }>('session/read', { sessionId }, { signal: controller.signal });
        const value = typeof detail.settings?.mode === 'string' ? detail.settings.mode : detail.settings?.mode?.current;
        if (!controller.signal.aborted) setMode(MODES.some(item => item.id === value) ? value! : '');
      } catch (error) { if (!controller.signal.aborted) showToast('读取模式失败：' + String(error)); }
      finally { if (!controller.signal.aborted) setActionBusy(''); }
    })();
    return () => controller.abort();
  }, [active, sessionId]);
  const setSessionMode = async (nextMode: string) => {
    const previous = mode;
    setMode(nextMode);
    try { setActionBusy(`mode-${nextMode}`); await gateway.request('session/setMode', { sessionId, mode: nextMode }); }
    catch (error) { setMode(previous); showToast(`切换失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setActionBusy(''); }
  };

  const compact = () => Alert.alert('压缩上下文', '压缩会调用当前模型生成摘要，完成前请勿重复操作。', [{ text: '取消', style: 'cancel' }, { text: '开始压缩', onPress: () => void (async () => {
    try { setActionBusy('compact'); await gateway.request('session/compact', { sessionId }); Alert.alert('已完成', '会话上下文已压缩。'); }
    catch (error) { Alert.alert('压缩失败', error instanceof Error ? error.message : String(error)); }
    finally { setActionBusy(''); }
  })() }]);
  const forkLatest = async () => {
    try {
      setActionBusy('fork');
      const result = await gateway.request<{ forkedSessionId?: string; session?: { sessionId?: string } }>('session/fork', { sessionId, target: { kind: 'latestCheckpoint' } });
      const forkedId = result.forkedSessionId ?? result.session?.sessionId;
      if (!forkedId) throw new Error('引擎未返回新分支 ID');
      void refresh().catch(() => {});
      replaceWithSession(rootNavigation, { ...params, id: forkedId, title: `${title || '会话'} · 分支` });
    } catch (error) { Alert.alert('创建分支失败', error instanceof Error ? error.message : String(error)); }
    finally { setActionBusy(''); }
  };
  const closeSession = () => Alert.alert('关闭会话', '关闭后会从活动会话中移除。此操作可能无法撤销。', [{ text: '取消', style: 'cancel' }, { text: '关闭', style: 'destructive', onPress: () => void (async () => {
    try {
      setActionBusy('close');
      await gateway.request('session/close', { sessionId });
      forgetSessionEntry(sessionId);
      if (useSessionNavigation.getState().current?.id === sessionId) useSessionNavigation.setState({ current: null });
      void refresh().catch(() => {});
      resetToSessionList(rootNavigation, params.returnTo);
    }
    catch (error) { Alert.alert('关闭失败', error instanceof Error ? error.message : String(error)); }
    finally { setActionBusy(''); }
  })() }]);

  return (        <SafeAreaView style={styles.fullSettings} edges={['top', 'bottom']}>
          <View style={styles.fullSettingsHeader}><Pressable accessibilityRole="button" accessibilityLabel="返回对话" onPress={onBack} style={styles.fullSettingsBack}><Ionicons name="chevron-back" color={colors.foreground} size={25} /></Pressable><View style={styles.sheetTitleWrap}><Text style={styles.sheetTitle}>会话设置</Text><Text variant="muted" style={styles.sheetSubtitle}>在标题区向右滑返回对话</Text></View></View>
          <ScrollView contentContainerStyle={styles.sheetBody}>
            <Text variant="muted" style={styles.sectionLabel}>模式</Text>
            {!mode && !actionBusy ? <Text variant="muted" style={styles.optionHint}>当前模式未识别，请手动选择；不会自动修改电脑设置。</Text> : null}
            {MODES.map((item) => <Pressable key={item.id} disabled={!!actionBusy} onPress={() => void setSessionMode(item.id)} style={[styles.optionRow, mode === item.id && styles.optionSelected]}><Ionicons name={mode === item.id ? 'radio-button-on' : 'radio-button-off'} color={mode === item.id ? colors.foreground : colors.dim} size={18} /><View style={styles.optionText}><Text>{item.label}</Text><Text variant="muted" style={styles.optionHint}>{item.hint}</Text></View>{actionBusy === `mode-${item.id}` ? <ActivityIndicator color={colors.dim} size={15} /> : null}</Pressable>)}
            <Text variant="muted" style={styles.sectionLabel}>管理</Text>
            <Pressable disabled={!!actionBusy} onPress={() => void togglePinnedSession(sessionId)} style={styles.manageRow}><Ionicons name={pinned ? 'pin' : 'pin-outline'} color={colors.foreground} size={19} /><Text style={styles.manageText}>{pinned ? '取消置顶会话' : '置顶会话'}</Text></Pressable>
            <Pressable disabled={!!actionBusy} onPress={() => void forkLatest()} style={styles.manageRow}><Ionicons name="git-branch-outline" color={colors.foreground} size={19} /><Text style={styles.manageText}>从最新检查点创建分支</Text></Pressable>
            <Pressable disabled={!!actionBusy} onPress={compact} style={styles.manageRow}><Ionicons name="contract-outline" color={colors.foreground} size={19} /><Text style={styles.manageText}>压缩上下文</Text></Pressable>
            <Pressable disabled={!!actionBusy} onPress={closeSession} style={styles.manageRow}><Ionicons name="close-circle-outline" color={colors.destructive} size={19} /><Text variant="destructive" style={styles.manageText}>关闭会话</Text></Pressable>
          </ScrollView>
        </SafeAreaView>
);
}
function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    fullSettings: { flex: 1, backgroundColor: colors.background },
    fullSettingsHeader: { minHeight: 64, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    fullSettingsBack: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
    sheetTitleWrap: { flex: 1, paddingVertical: 10 },
    sheetTitle: { fontSize: 18, fontWeight: '700' },
    sheetSubtitle: { fontSize: 11, marginTop: 2 },
    sheetBody: { padding: spacing.lg, paddingBottom: 34 },
    sectionLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 12, marginBottom: 7 },
    optionRow: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 10, gap: 10, borderRadius: radius.md },
    optionSelected: { backgroundColor: colors.surfaceRaised },
    optionText: { flex: 1 },
    optionHint: { fontSize: 11, marginTop: 2 },
    manageRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    manageText: { flex: 1, fontSize: 14 },
  });
}
