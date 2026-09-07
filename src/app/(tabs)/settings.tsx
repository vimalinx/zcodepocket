import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { radius, spacing, type ThemeColors, useTheme, useThemeStyles } from '@/lib/theme';
import { useApp } from '@/store/app';
import { AppUpdatesCard } from '@/components/settings/app-updates';

type OfficialSection =
  | 'general'
  | 'appearance'
  | 'models'
  | 'browser'
  | 'memory'
  | 'subagents'
  | 'plugins'
  | 'mcp'
  | 'skills'
  | 'commands'
  | 'hooks'
  | 'indexes'
  | 'usage'
  | 'onboarding'
  | 'plugin-market';

type SettingItem = {
  section: OfficialSection;
  label: string;
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const GROUPS: { title: string; items: SettingItem[] }[] = [
  {
    title: '基础设置',
    items: [
      { section: 'general', label: '常规', hint: '语言、行为与基础偏好', icon: 'options-outline' },
      { section: 'appearance', label: '外观', hint: '手机主题、对话背景与显示', icon: 'sunny-outline' },
      { section: 'models', label: '模型设置', hint: '模型与推理相关选项', icon: 'hardware-chip-outline' },
      { section: 'browser', label: '浏览器控制', hint: '浏览器能力与授权', icon: 'globe-outline' },
    ],
  },
  {
    title: 'Agent 能力',
    items: [
      { section: 'memory', label: '记忆', hint: '管理官方记忆能力', icon: 'archive-outline' },
      { section: 'subagents', label: '子智能体', hint: '查看子智能体配置', icon: 'git-network-outline' },
      { section: 'plugins', label: '插件', hint: '已安装插件与权限', icon: 'extension-puzzle-outline' },
      { section: 'mcp', label: 'MCP 服务器', hint: '连接的 MCP 服务', icon: 'server-outline' },
      { section: 'skills', label: '技能', hint: 'Agent 技能管理', icon: 'ribbon-outline' },
      { section: 'commands', label: '命令', hint: '可用命令与配置', icon: 'terminal-outline' },
      { section: 'hooks', label: '钩子', hint: '事件钩子与自动化', icon: 'code-slash-outline' },
    ],
  },
  {
    title: '数据与统计',
    items: [
      { section: 'indexes', label: '索引库', hint: '本地索引与数据来源', icon: 'library-outline' },
      { section: 'usage', label: '使用统计', hint: '查看官方使用数据', icon: 'stats-chart-outline' },
      { section: 'onboarding', label: '引导', hint: '重新查看产品引导', icon: 'compass-outline' },
    ],
  },
];

export default function SettingsScreen() {
  const { colors } = useTheme();
  const styles = useThemeStyles(createStyles);
  const status = useApp((state) => state.status);
  const openNative = (section: OfficialSection) => router.push({ pathname: '/settings/[section]', params: { section } } as never);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text variant="primary" style={styles.title}>设置</Text>
          <Text variant="muted" style={styles.subtitle}>直接读取并管理电脑上的 ZCode</Text>
        </View>

        <View style={styles.connectedRow}>
          <Ionicons name={status === 'online' ? 'checkmark-circle' : 'cloud-offline-outline'} color={status === 'online' ? colors.success : colors.warning} size={17} />
          <Text variant="muted" style={styles.connectedText}>{status === 'online' ? '原生设置通道已连接 · 数据来自 ZCode 本机' : '电脑离线，设置将在重连后加载'}</Text>
        </View>

        <Pressable accessibilityRole="button" accessibilityLabel="打开插件市场" onPress={() => openNative('plugin-market')} style={({ pressed }) => [styles.marketCard, pressed && styles.pressed]}>
          <View style={styles.marketIcon}><Ionicons name="storefront-outline" color={colors.primaryForeground} size={24} /></View>
          <View style={styles.marketText}>
            <Text style={styles.marketTitle}>插件市场</Text>
            <Text variant="muted" style={styles.marketHint}>发现并管理 ZCode 官方插件</Text>
          </View>
          <Ionicons name="chevron-forward" color={colors.mutedForeground} size={20} />
        </Pressable>

        <AppUpdatesCard />
        {GROUPS.map((group) => (
          <View key={group.title} style={styles.group}>
            <Text variant="muted" style={styles.groupTitle}>{group.title}</Text>
            <Card style={styles.groupCard}>
              {group.items.map((item, index) => (
                <Pressable
                  key={item.section}
                  accessibilityRole="button"
                  accessibilityLabel={`打开${item.label}设置`}
                  onPress={() => openNative(item.section)}
                  style={({ pressed }) => [styles.row, index < group.items.length - 1 && styles.rowBorder, pressed && styles.pressed]}
                >
                  <View style={styles.rowIcon}><Ionicons name={item.icon} color={colors.foreground} size={19} /></View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{item.label}</Text>
                    <Text variant="muted" style={styles.rowHint}>{item.hint}</Text>
                  </View>
                  <Ionicons name="chevron-forward" color={colors.dim} size={17} />
                </Pressable>
              ))}
            </Card>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 40 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  title: { fontSize: 26 },
  subtitle: { fontSize: 12, marginTop: 2 },
  connectedRow: { minHeight: 44, marginHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: 7 },
  connectedText: { flex: 1, fontSize: 11 },
  marketCard: { minHeight: 86, marginHorizontal: spacing.lg, marginTop: spacing.md, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderStrong },
  marketIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  marketText: { flex: 1 },
  marketTitle: { fontSize: 17, fontWeight: '700' },
  marketHint: { fontSize: 12, marginTop: 3 },
  group: { marginTop: spacing.lg },
  groupTitle: { paddingHorizontal: spacing.lg, marginBottom: spacing.sm, fontSize: 12, fontWeight: '600' },
  groupCard: { marginHorizontal: spacing.lg, overflow: 'hidden' },
  row: { minHeight: 64, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowIcon: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: '600' },
  rowHint: { fontSize: 11, marginTop: 2 },
  pressed: { opacity: 0.68 },
});
