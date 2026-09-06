import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { remoteClient as gateway } from '@/lib/remote-client';
import { radius, spacing, type ThemeColors, useTheme, useThemeStyles } from '@/lib/theme';
import { useApp } from '@/store/app';

type Usage = {
  days: number;
  stats: {
    requestCount: number;
    sessionCount: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
  };
  allTime: { requestCount: number; totalTokens: number };
  models: { providerId: string; modelId: string; requestCount: number; totalTokens: number }[];
  daily: { date: string; requestCount: number; totalTokens: number }[];
};

function compactNumber(value = 0) {
  return Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export default function AccountScreen() {
  const { colors } = useTheme();
  const styles = useThemeStyles(createStyles);
  const deviceName = useApp((s) => s.deviceName);
  const connectionDetail = useApp((s) => s.connectionDetail);
  const status = useApp((s) => s.status);
  const sessions = useApp((s) => s.sessions);
  const workspaces = useApp((s) => s.workspaces);
  const refresh = useApp((s) => s.refresh);
  const unpair = useApp((s) => s.unpair);
  const reconnect = useApp((s) => s.reconnect);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState('');
  const [unpairing, setUnpairing] = useState(false);

  const loadUsage = useCallback(async () => {
    if (gateway.status !== 'online') return;
    setUsageLoading(true);
    setUsageError('');
    try {
      setUsage(await gateway.request<Usage>('gw.usage', { days: 7, heatmapDays: 98 }));
    } catch (error) {
      setUsageError(error instanceof Error ? error.message : '读取失败');
    } finally {
      setUsageLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void loadUsage();
  }, [loadUsage]));

  const statusLabel = status === 'online' ? '已连接' : status === 'connecting' ? '连接中…' : status === 'offline' ? '已断开' : '未连接';
  const statusColor = status === 'online' ? colors.success : status === 'offline' ? colors.destructive : colors.dim;

  const logout = async () => {
    setUnpairing(true);
    try { await unpair(); }
    catch (error) { Alert.alert('解除登录失败', error instanceof Error ? error.message : '请重试'); }
    finally { setUnpairing(false); }
    // The root's protected routes discard the paired history after unpairing.
  };
  const confirmLogout = () => Alert.alert('解除登录', '将断开电脑并清除本机配对信息，之后需要重新扫码。不会删除电脑上的会话。', [
    { text: '取消', style: 'cancel' },
    { text: '解除登录', style: 'destructive', onPress: () => void logout() },
  ]);

  const refreshAll = async () => {
    await refresh();
    await loadUsage();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text variant="primary" style={styles.title}>账号</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="刷新账号数据" onPress={() => void refreshAll()} style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}>
            {usageLoading ? <ActivityIndicator color={colors.mutedForeground} size={17} /> : <Ionicons name="refresh" color={colors.mutedForeground} size={19} />}
          </Pressable>
        </View>

        <Text variant="muted" style={styles.sectionLabel}>最近 7 天用量</Text>
        <Card style={styles.usageCard}>
          <View style={styles.usageHero}>
            <View>
              <Text variant="muted" style={styles.usageCaption}>总 Token</Text>
              <Text style={styles.usageValue}>{usage ? compactNumber(usage.stats.totalTokens) : usageLoading ? '读取中…' : '—'}</Text>
            </View>
            <View style={styles.nativeBadge}><Ionicons name="shield-checkmark-outline" color={colors.success} size={13} /><Text style={styles.nativeBadgeText}>ZCode 本机记录</Text></View>
          </View>
          <View style={styles.metrics}>
            <Metric label="请求" value={usage ? compactNumber(usage.stats.requestCount) : '—'} />
            <Metric label="会话" value={usage ? compactNumber(usage.stats.sessionCount) : '—'} />
            <Metric label="输出" value={usage ? compactNumber(usage.stats.outputTokens) : '—'} />
          </View>
          {usage?.models.slice(0, 3).map((item) => (
            <View key={`${item.providerId}/${item.modelId}`} style={styles.modelUsageRow}>
              <Text style={styles.modelUsageName} numberOfLines={1}>{item.modelId}</Text>
              <Text variant="muted" style={styles.modelUsageValue}>{compactNumber(item.totalTokens)} · {item.requestCount} 次</Text>
            </View>
          ))}
          {usageError ? <Text variant="destructive" style={styles.usageError}>{usageError}</Text> : null}
          <Text variant="muted" style={styles.usageHint}>这是电脑上 ZCode 的本地调用统计，不代表 Coding Plan 套餐余额或账单。</Text>
        </Card>

        <Text variant="muted" style={styles.sectionLabel}>Token 活跃度</Text>
        <Card style={styles.heatmapCard}>
          <TokenHeatmap daily={usage?.daily ?? []} loading={usageLoading} />
        </Card>

        <Text variant="muted" style={styles.sectionLabel}>连接</Text>
        <Card style={styles.card}>
          <InfoRow icon="desktop-outline" label="电脑" value={deviceName ?? '未配对'} />
          <InfoRow icon="pulse-outline" label="状态" value={statusLabel} valueColor={statusColor} />
          <InfoRow icon="folder-outline" label="工作区" value={String(workspaces.length)} />
          <InfoRow icon="chatbubbles-outline" label="可见会话" value={String(sessions.length)} />
          <InfoRow icon="globe-outline" label="连接" value={connectionDetail} muted />
        </Card>

        <Text variant="muted" style={styles.sectionLabel}>管理</Text>
        <Card style={styles.card}>
          {status !== 'online' ? <Button variant="secondary" label={status === 'connecting' ? '正在连接…' : '重新连接已配对电脑'} disabled={status === 'connecting'} onPress={() => void reconnect().catch((error) => Alert.alert('连接失败', error instanceof Error ? error.message : '请重新扫码'))} /> : null}
          <Button variant="ghost" label="刷新会话与用量" onPress={() => void refreshAll()} disabled={usageLoading} />
          <Button variant="destructive" label={unpairing ? '正在解除…' : '解除登录并清除配对'} disabled={unpairing} onPress={confirmLogout} />
          <Text variant="muted" style={styles.hint}>通过 ZCode 官方公网中转连接电脑，全部会话在本 App 原生界面中显示。配对凭据保存在手机安全存储中。</Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const styles = useThemeStyles(createStyles);
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text variant="muted" style={styles.metricLabel}>{label}</Text></View>;
}

function isoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function TokenHeatmap({ daily, loading }: { daily: Usage['daily']; loading: boolean }) {
  const { colors, isDark } = useTheme();
  const styles = useThemeStyles(createStyles);
  const values = new Map(daily.map((item) => [item.date, item.totalTokens]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const mondayOffset = (today.getDay() + 6) % 7;
  const start = new Date(today);
  start.setDate(today.getDate() - 13 * 7 - mondayOffset);
  const max = Math.max(1, ...daily.map((item) => item.totalTokens));
  const weeks = Array.from({ length: 14 }, (_, week) => Array.from({ length: 7 }, (_, day) => {
    const date = new Date(start);
    date.setDate(start.getDate() + week * 7 + day);
    const future = date > today;
    const tokens = future ? 0 : values.get(isoDate(date)) ?? 0;
    const intensity = tokens === 0 ? 0 : Math.max(1, Math.ceil(Math.sqrt(tokens / max) * 4));
    return { date, future, tokens, intensity };
  }));
  const palette = isDark
    ? [colors.muted, '#064e3b', '#047857', '#10b981', '#34d399']
    : [colors.muted, '#bbf7d0', '#86efac', '#22c55e', '#15803d'];
  const activeDays = daily.filter((item) => item.totalTokens > 0).length;
  const total = daily.reduce((sum, item) => sum + item.totalTokens, 0);

  return (
    <View accessibilityLabel={`近 14 周 Token 热力图，${activeDays} 个活跃日，共 ${compactNumber(total)} Token`}>
      <View style={styles.heatmapHead}>
        <View><Text style={styles.heatmapTitle}>近 14 周</Text><Text variant="muted" style={styles.heatmapSummary}>{loading ? '读取中…' : `${activeDays} 个活跃日 · ${compactNumber(total)} Token`}</Text></View>
        <View style={styles.legend}><Text variant="muted" style={styles.legendText}>少</Text>{palette.map((color) => <View key={color} style={[styles.legendCell, { backgroundColor: color }]} />)}<Text variant="muted" style={styles.legendText}>多</Text></View>
      </View>
      <View style={styles.heatmapBody}>
        <View style={styles.weekdayColumn}>{['一', '', '三', '', '五', '', '日'].map((label, index) => <Text key={index} variant="muted" style={styles.weekday}>{label}</Text>)}</View>
        <View style={styles.heatmap}>
          {weeks.map((week, weekIndex) => <View key={weekIndex} style={styles.heatmapWeek}>{week.map((day) => <View accessible={false} key={isoDate(day.date)} style={[styles.heatmapCell, { backgroundColor: day.future ? 'transparent' : palette[day.intensity] }]} />)}</View>)}
        </View>
      </View>
    </View>
  );
}

function InfoRow({ icon, label, value, valueColor, muted }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; valueColor?: string; muted?: boolean }) {
  const { colors } = useTheme();
  const styles = useThemeStyles(createStyles);
  return <View style={styles.row}><Ionicons name={icon} color={colors.dim} size={18} /><Text style={styles.rowLabel}>{label}</Text><Text variant={muted ? 'muted' : 'default'} style={[styles.rowValue, valueColor ? { color: valueColor } : null]} numberOfLines={1}>{value}</Text></View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 40 },
  header: { minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  title: { fontSize: 26 },
  refreshButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  sectionLabel: { fontSize: 12, fontWeight: '600', paddingHorizontal: spacing.lg, marginTop: spacing.sm, marginBottom: spacing.sm },
  card: { padding: spacing.md, marginHorizontal: spacing.lg, marginBottom: spacing.md, gap: spacing.sm },
  usageCard: { padding: spacing.md, marginHorizontal: spacing.lg, marginBottom: spacing.md },
  heatmapCard: { padding: spacing.md, marginHorizontal: spacing.lg, marginBottom: spacing.md },
  heatmapHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  heatmapTitle: { fontSize: 15, fontWeight: '700' },
  heatmapSummary: { fontSize: 11, marginTop: 2 },
  heatmapBody: { flexDirection: 'row', marginTop: spacing.md },
  heatmap: { flex: 1, flexDirection: 'row', justifyContent: 'space-between' },
  heatmapWeek: { gap: 4 },
  heatmapCell: { width: 13, height: 13, borderRadius: 3 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingTop: 2 },
  legendCell: { width: 8, height: 8, borderRadius: 2 },
  legendText: { fontSize: 9 },
  weekdayColumn: { gap: 4, marginRight: spacing.sm },
  weekday: { width: 13, height: 13, lineHeight: 13, fontSize: 9, textAlign: 'center' },
  usageHero: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  usageCaption: { fontSize: 12 },
  usageValue: { fontSize: 30, lineHeight: 38, fontWeight: '700', fontVariant: ['tabular-nums'] },
  nativeBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, minHeight: 26, borderRadius: radius.md, backgroundColor: colors.successMuted },
  nativeBadgeText: { color: colors.success, fontSize: 10, fontWeight: '600' },
  metrics: { flexDirection: 'row', marginTop: spacing.md, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  metric: { flex: 1 },
  metricValue: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  metricLabel: { fontSize: 10, marginTop: 2 },
  modelUsageRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  modelUsageName: { flex: 1, fontSize: 12 },
  modelUsageValue: { fontSize: 11, marginLeft: spacing.sm },
  usageError: { fontSize: 12, marginTop: spacing.sm },
  usageHint: { fontSize: 11, lineHeight: 16, marginTop: spacing.sm },
  row: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowLabel: { color: colors.mutedForeground, fontSize: 14, width: 72 },
  rowValue: { color: colors.foreground, fontSize: 14, flex: 1, textAlign: 'right' },
  hint: { fontSize: 12, lineHeight: 18, marginTop: spacing.xs },
  pressed: { opacity: 0.72 },
});
