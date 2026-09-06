import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, ToastAndroid, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { AppearanceSettings } from '@/components/settings/appearance-settings';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { remoteClient as gateway } from '@/lib/remote-client';
import { radius, spacing, type ThemeColors, useTheme, useThemeStyles } from '@/lib/theme';
import { useApp } from '@/store/app';

const META = {
  general: ['常规', '电脑端行为、消息流与自动化'], appearance: ['外观', '主题与对话背景'], models: ['模型设置', '工作区默认模型与能力'], browser: ['浏览器控制', '浏览器入口、性能与安全'],
  memory: ['记忆', '记忆与模型数据保留'], subagents: ['子智能体', '配置和运行状态'], plugins: ['插件', '已安装插件、组件与更新'], mcp: ['MCP 服务器', '连接状态、工具与启停'],
  skills: ['技能', 'ZCode 当前发现的技能'], commands: ['命令', '工作区斜杠命令'], hooks: ['钩子', '插件注册的自动化钩子'], indexes: ['索引库', '仓库索引与搜索增强'],
  usage: ['使用统计', 'ZCode 本机数据库'], onboarding: ['引导', '连接、会话与设置入口'], 'plugin-market': ['插件市场', '发现并安装 ZCode 插件'],
} as const;
type Section = keyof typeof META;
type Snapshot = Record<string, any> & { workspacePath?: string; settings?: Record<string, unknown> };
type ToggleDefinition = { key: string; label: string; hint: string; icon: keyof typeof Ionicons.glyphMap; warning?: string };

const TOGGLE_GROUPS: Partial<Record<Section, { title: string; detail?: string; rows: ToggleDefinition[] }[]>> = {
  general: [
    { title: '运行环境', rows: [
      { key: 'terminalInheritSystemProfile', label: '继承终端环境', hint: '让 Agent 终端继承电脑的系统配置', icon: 'terminal-outline' },
      { key: 'keepAwakeWhileRunning', label: '运行时保持唤醒', hint: '有任务执行时避免电脑自动休眠', icon: 'cafe-outline' },
    ] },
    { title: '消息与工具展示', rows: [
      { key: 'messageStreamShowReasoning', label: '显示思考过程', hint: '在消息流中展示 ZCode 返回的推理内容', icon: 'bulb-outline' },
      { key: 'messageStreamShowTodos', label: '显示任务清单', hint: '在对话中显示 Agent Todo 与进度', icon: 'checkbox-outline' },
      { key: 'toolGroupingExploreEnabled', label: '合并探索工具', hint: '归组连续的浏览、读取和搜索操作', icon: 'search-outline' },
      { key: 'toolGroupingTerminalEnabled', label: '合并终端工具', hint: '归组连续执行的终端命令', icon: 'code-slash-outline' },
      { key: 'toolGroupingChangesEnabled', label: '合并文件更改', hint: '归组连续的编辑与写入操作', icon: 'documents-outline' },
    ] },
    { title: '自动化', rows: [
      { key: 'askUserQuestionAutoResolutionEnabled', label: '自动处理简单提问', hint: '允许 ZCode 按内置策略处理低风险确认', icon: 'flash-outline' },
      { key: 'taskAutoArchiveEnabled', label: '自动归档旧会话', hint: '按设定天数归档长期未使用的会话', icon: 'archive-outline' },
    ] },
  ],
  browser: [
    { title: '入口与性能', rows: [
      { key: 'computerUseComposerEntryHidden', label: '隐藏电脑控制入口', hint: '控制对话输入区是否显示电脑控制入口', icon: 'desktop-outline' },
      { key: 'desktopChromiumHardwareAccelerationEnabled', label: '浏览器硬件加速', hint: '使用电脑 GPU 加速内嵌 Chromium', icon: 'speedometer-outline' },
    ] },
    { title: '安全', detail: '只在可信的本地开发环境中放宽证书校验。', rows: [
      { key: 'embeddedBrowserAllowInsecureCertificates', label: '允许不安全证书', hint: '访问自签名或证书异常的开发站点', icon: 'warning-outline', warning: '开启后，内嵌浏览器可能无法识别中间人攻击。' },
    ] },
  ],
  memory: [{ title: '记忆能力', rows: [
    { key: 'memoryEnabled', label: '启用记忆', hint: '允许 ZCode 在后续会话使用已保存记忆', icon: 'archive-outline' },
    { key: 'modelIoFullRetentionEnabled', label: '保留完整模型输入输出', hint: '为诊断和历史回看保留更完整的模型数据', icon: 'save-outline', warning: '可能增加本机存储占用，并保留更多会话内容。' },
    { key: 'optimizeAgentExperienceEnabled', label: 'Agent 体验优化', hint: '启用 ZCode 的实验性 Agent 体验优化', icon: 'sparkles-outline' },
  ] }],
  indexes: [{ title: '工作区索引', detail: '这些选项影响电脑端搜索速度和磁盘占用。', rows: [
    { key: 'repoSnapshotIndexingEnabled', label: '仓库快照索引', hint: '为项目文件建立可复用的快照索引', icon: 'layers-outline' },
    { key: 'instantGrepIndexingEnabled', label: '即时文本索引', hint: '加速工作区内的文本匹配与定位', icon: 'search-outline' },
    { key: 'nativeSearchEnhancementsEnabled', label: '原生搜索增强', hint: '启用 ZCode 的本地搜索增强能力', icon: 'flash-outline' },
  ] }],
};

export default function NativeSettingsScreen() {
  const params = useLocalSearchParams<{ section?: string }>();
  const section: Section = params.section && params.section in META ? params.section as Section : 'general';
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState('');
  const [query, setQuery] = useState('');
  const workspaces = useApp((state) => state.workspaces);
  const status = useApp((state) => state.status);
  const { colors } = useTheme();
  const styles = useThemeStyles(createStyles);
  const workspacePath = workspaces[0]?.workspacePath;
  const isLocalSection = section === 'appearance' || section === 'onboarding';

  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      if (isLocalSection) setSnapshot({ section, settings: {}, workspacePath });
      else setSnapshot(await gateway.request<Snapshot>('gw.settingsSection', { section, ...(workspacePath ? { workspacePath } : {}) }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '读取失败');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [isLocalSection, section, workspacePath]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const updateSetting = async (key: string, value: unknown) => {
    if (!snapshot || pending) return;
    const before = snapshot;
    setSnapshot({ ...snapshot, settings: { ...snapshot.settings, [key]: value } });
    setPending(key);
    try {
      const result = await gateway.request<{ settings: Record<string, unknown> }>('gw.settingsUpdate', { key, value });
      setSnapshot((current) => current ? { ...current, settings: result.settings } : current);
      ToastAndroid.show('已保存到电脑端 ZCode', ToastAndroid.SHORT);
    } catch (reason) {
      setSnapshot(before);
      ToastAndroid.show(reason instanceof Error ? reason.message : '保存失败', ToastAndroid.SHORT);
    } finally { setPending(''); }
  };

  const body = () => {
    if (loading && !snapshot) return <Empty icon="sync-outline" title="正在读取 ZCode…" detail="正在同步电脑端当前设置" spinner />;
    if (error && !snapshot) return <Empty icon="cloud-offline-outline" title="无法读取设置" detail={error} action="重新连接并读取" onAction={() => void load()} />;
    if (!snapshot) return null;
    if (section === 'appearance') return <AppearanceSettings />;
    if (section === 'onboarding') return <Onboarding online={status === 'online'} />;
    if (section === 'general') return <General values={snapshot.settings ?? {}} pending={pending} onChange={updateSetting} />;
    if (TOGGLE_GROUPS[section]) return <ToggleGroups groups={TOGGLE_GROUPS[section]!} values={snapshot.settings ?? {}} pending={pending} onChange={updateSetting} />;
    switch (section) {
      case 'models': return <Models snapshot={snapshot} busy={pending} setBusy={setPending} reload={load} query={query} setQuery={setQuery} />;
      case 'plugins': return <Plugins snapshot={snapshot} busy={pending} setBusy={setPending} reload={load} />;
      case 'plugin-market': return <PluginMarket snapshot={snapshot} query={query} setQuery={setQuery} busy={pending} setBusy={setPending} reload={load} />;
      case 'mcp': return <Mcp snapshot={snapshot} busy={pending} setBusy={setPending} reload={load} />;
      case 'skills': return <Skills snapshot={snapshot} query={query} setQuery={setQuery} />;
      case 'commands': return <Commands snapshot={snapshot} query={query} setQuery={setQuery} />;
      case 'hooks': return <Hooks snapshot={snapshot} />;
      case 'subagents': return <Subagents snapshot={snapshot} />;
      case 'usage': return <Usage snapshot={snapshot} />;
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回设置" hitSlop={6} onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><Ionicons name="chevron-back" color={colors.foreground} size={26} /></Pressable>
        <View style={styles.headerText}><Text style={styles.title}>{META[section][0]}</Text><Text variant="muted" style={styles.subtitle}>{META[section][1]}</Text></View>
        {!isLocalSection ? <Pressable accessibilityRole="button" accessibilityLabel="刷新本页设置" disabled={refreshing} onPress={() => void load(true)} style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}>{refreshing ? <ActivityIndicator color={colors.mutedForeground} size={17} /> : <Ionicons name="refresh" color={colors.mutedForeground} size={19} />}</Pressable> : <View style={styles.headerSpacer} />}
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.screen} contentContainerStyle={styles.content} refreshControl={!isLocalSection ? <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.foreground} colors={[colors.foreground]} progressBackgroundColor={colors.surfaceRaised} /> : undefined}>
        {!isLocalSection ? <ConnectionContext online={status === 'online'} workspacePath={snapshot?.workspacePath} /> : null}
        {body()}
        {error && snapshot ? <View style={styles.inlineError}><Ionicons name="alert-circle-outline" color={colors.destructive} size={16} /><Text variant="destructive" style={styles.inlineErrorText}>{error}</Text></View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function ConnectionContext({ online, workspacePath }: { online: boolean; workspacePath?: string }) {
  const { colors } = useTheme(); const styles = useThemeStyles(createStyles);
  return <View style={[styles.contextBar, { backgroundColor: online ? colors.successMuted : colors.surface }]}><Ionicons name={online ? 'checkmark-circle' : 'cloud-offline-outline'} color={online ? colors.success : colors.warning} size={16} /><View style={styles.grow}><Text style={[styles.contextTitle, { color: online ? colors.success : colors.warning }]}>{online ? '已连接电脑端 ZCode' : '电脑端当前离线'}</Text>{workspacePath ? <Text variant="muted" numberOfLines={1} style={styles.contextPath}>{workspacePath}</Text> : null}</View></View>;
}

function General({ values, pending, onChange }: SettingsProps) {
  const styles = useThemeStyles(createStyles);
  return <View style={styles.stack}>
    <SectionTitle title="界面语言" detail="同步修改电脑端 ZCode 的界面语言" />
    <Card style={styles.card}><View style={styles.segmentRow}>{[['zh-CN', '简体中文'], ['en-US', 'English']].map(([value, label]) => <Segment key={value} label={label} selected={values.locale === value} disabled={!!pending} onPress={() => onChange('locale', value)} />)}</View></Card>
    <ToggleGroups groups={TOGGLE_GROUPS.general!} values={values} pending={pending} onChange={onChange} />
    {values.taskAutoArchiveEnabled === true ? <View><SectionTitle title="自动归档时间" detail="超过此时间未活动的会话会被自动归档" /><Card style={styles.card}><View style={styles.segmentRow}>{[7, 30, 90].map((days) => <Segment key={days} label={`${days} 天`} selected={values.taskAutoArchiveOlderThanDays === days} disabled={!!pending} onPress={() => onChange('taskAutoArchiveOlderThanDays', days)} />)}</View></Card></View> : null}
  </View>;
}

type SettingsProps = { values: Record<string, unknown>; pending: string; onChange: (key: string, value: unknown) => void };
function ToggleGroups({ groups, values, pending, onChange }: SettingsProps & { groups: { title: string; detail?: string; rows: ToggleDefinition[] }[] }) {
  const styles = useThemeStyles(createStyles);
  return <View style={styles.stack}>{groups.map((group) => <View key={group.title}><SectionTitle title={group.title} detail={group.detail} /><Card style={styles.card}>{group.rows.map((row, index) => <ToggleRow key={row.key} row={row} value={values[row.key] === true} disabled={!!pending} loading={pending === row.key} divider={index < group.rows.length - 1} onChange={(value) => onChange(row.key, value)} />)}</Card></View>)}</View>;
}

function ToggleRow({ row, value, onChange, disabled, loading, divider }: { row: ToggleDefinition; value: boolean; onChange: (value: boolean) => void; disabled?: boolean; loading?: boolean; divider?: boolean }) {
  const { colors } = useTheme(); const styles = useThemeStyles(createStyles);
  return <View style={[styles.toggleRow, divider && styles.divider]}><View style={styles.iconBox}><Ionicons name={row.icon} color={row.warning && value ? colors.warning : colors.foreground} size={20} /></View><View style={styles.grow}><View style={styles.labelLine}><Text style={styles.itemTitle}>{row.label}</Text><Text style={[styles.stateLabel, { color: value ? colors.success : colors.dim }]}>{value ? '已开启' : '已关闭'}</Text></View><Text variant="muted" style={styles.itemHint}>{row.hint}</Text>{row.warning && value ? <Text style={[styles.warningText, { color: colors.warning }]}>{row.warning}</Text> : null}</View>{loading ? <ActivityIndicator color={colors.mutedForeground} /> : <Switch accessibilityLabel={row.label} accessibilityRole="switch" value={value} disabled={disabled} onValueChange={onChange} trackColor={{ false: colors.borderStrong, true: colors.foreground }} thumbColor={value ? colors.card : colors.mutedForeground} />}</View>;
}

function Segment({ label, selected, disabled, onPress }: { label: string; selected: boolean; disabled?: boolean; onPress: () => void }) {
  const { colors } = useTheme(); const styles = useThemeStyles(createStyles);
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.segment, selected && styles.segmentActive, (pressed || disabled) && styles.faded]}><Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} color={selected ? colors.primaryForeground : colors.dim} size={17} /><Text style={[styles.segmentText, selected && { color: colors.primaryForeground }]}>{label}</Text></Pressable>;
}

type ActionProps = { snapshot: Snapshot; busy: string; setBusy: (value: string) => void; reload: (pull?: boolean) => Promise<void> };

function Models({ snapshot, busy, setBusy, reload, query, setQuery }: ActionProps & { query: string; setQuery: (value: string) => void }) {
  const { colors } = useTheme(); const styles = useThemeStyles(createStyles); const current = snapshot.workspaceState?.settings?.model?.current;
  const providers = (snapshot.providers ?? []).map((provider: any) => ({ ...provider, models: (provider.models ?? []).filter((model: any) => `${model.label ?? ''} ${model.modelId}`.toLowerCase().includes(query.toLowerCase())) })).filter((provider: any) => provider.models.length);
  const choose = async (providerId: string, modelId: string) => { const key = `${providerId}/${modelId}`; setBusy(key); try { await gateway.request('gw.setDefaultModel', { workspacePath: snapshot.workspacePath, providerId, modelId }); ToastAndroid.show('已设为当前工作区默认模型', ToastAndroid.SHORT); await reload(true); } catch (error) { ToastAndroid.show(error instanceof Error ? error.message : '设置失败', ToastAndroid.SHORT); } finally { setBusy(''); } };
  return <View style={styles.stack}><SummaryCard icon="hardware-chip-outline" title={current?.modelId ?? '尚未读取默认模型'} detail={current ? `提供方 ${current.providerId}` : `${snapshot.providers?.length ?? 0} 个提供方`} /><Input value={query} onChangeText={setQuery} placeholder="搜索模型" accessibilityLabel="搜索模型" autoCorrect={false} style={styles.searchInput} />{providers.map((provider: any) => <View key={provider.providerId}><SectionTitle title={provider.label ?? provider.providerId} detail={`${provider.models.length} 个可用模型`} /><Card style={styles.card}>{provider.models.map((model: any, index: number) => { const active = current?.providerId === provider.providerId && current?.modelId === model.modelId; const key = `${provider.providerId}/${model.modelId}`; const capability = [model.contextWindow ? `${compact(model.contextWindow)} 上下文` : '', model.supportsImages ? '图片' : '', model.supportsPdf ? 'PDF' : ''].filter(Boolean); return <Pressable accessibilityRole="radio" accessibilityState={{ checked: active, disabled: !!busy }} key={model.modelId} disabled={!!busy} onPress={() => void choose(provider.providerId, model.modelId)} style={({ pressed }) => [styles.selectRow, index < provider.models.length - 1 && styles.divider, pressed && styles.pressed]}><Ionicons name={active ? 'checkmark-circle' : 'ellipse-outline'} color={active ? colors.success : colors.dim} size={21} /><View style={styles.grow}><View style={styles.labelLine}><Text style={styles.itemTitle}>{model.label ?? model.modelId}</Text>{active ? <Pill label="当前默认" tone="success" /> : null}</View><Text variant="muted" style={styles.itemHint}>{model.modelId}</Text>{capability.length ? <View style={styles.pillRow}>{capability.map((item) => <Pill key={item} label={item} />)}</View> : null}</View>{busy === key ? <ActivityIndicator color={colors.foreground} /> : null}</Pressable>; })}</Card></View>)}{!providers.length ? <Empty icon="search-outline" title="没有匹配的模型" detail="换个关键词试试" /> : null}</View>;
}

async function pluginAction(action: string, pluginId: string, snapshot: Snapshot, setBusy: (value: string) => void, reload: (pull?: boolean) => Promise<void>, enabled?: boolean) {
  setBusy(pluginId); try { await gateway.request('gw.pluginAction', { action, pluginId, enabled, workspacePath: snapshot.workspacePath }); ToastAndroid.show(action === 'install' ? '插件已安装' : action === 'uninstall' ? '插件已卸载' : '插件设置已保存', ToastAndroid.SHORT); await reload(true); } catch (error) { ToastAndroid.show(error instanceof Error ? error.message : '插件操作失败', ToastAndroid.LONG); } finally { setBusy(''); }
}

function Plugins({ snapshot, busy, setBusy, reload }: ActionProps) {
  const { colors } = useTheme(); const styles = useThemeStyles(createStyles); const list = snapshot.overview?.installedPlugins ?? [];
  return <View style={styles.stack}><Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/settings/[section]', params: { section: 'plugin-market' } } as never)} style={({ pressed }) => [styles.marketLink, pressed && styles.pressed]}><View style={styles.marketIcon}><Ionicons name="storefront-outline" color={colors.primaryForeground} size={23} /></View><View style={styles.grow}><Text style={styles.cardTitle}>浏览插件市场</Text><Text variant="muted" style={styles.itemHint}>{snapshot.overview?.availablePlugins?.length ?? 0} 个插件可供发现</Text></View><Ionicons name="chevron-forward" color={colors.dim} size={19} /></Pressable><SectionTitle title={`已安装 · ${list.length}`} detail="启停会立即保存；卸载前会再次确认" />{list.map((plugin: any) => <Card key={plugin.id} style={styles.pluginCard}><View style={styles.dataRow}><View style={styles.pluginGlyph}><Ionicons name="extension-puzzle-outline" color={colors.foreground} size={22} /></View><View style={styles.grow}><View style={styles.labelLine}><Text style={styles.cardTitle}>{plugin.name}</Text><Pill label={plugin.enabled ? '已启用' : '已停用'} tone={plugin.enabled ? 'success' : 'default'} /></View><Text variant="muted" style={styles.itemHint}>v{plugin.version ?? '未知'} · {plugin.scope ?? '用户级'}</Text></View>{busy === plugin.id ? <ActivityIndicator /> : <Switch accessibilityLabel={`启用 ${plugin.name}`} disabled={!!busy} value={plugin.enabled === true} onValueChange={(value) => void pluginAction('setEnabled', plugin.id, snapshot, setBusy, reload, value)} />}</View><Text variant="muted" style={styles.description}>{plugin.description || '此插件没有提供说明。'}</Text><View style={styles.pillRow}>{(plugin.componentTypes ?? []).map((type: string) => <Pill key={type} label={componentLabel(type)} />)}</View><View style={styles.actionRow}>{plugin.updateStatus && plugin.updateStatus !== 'none' ? <MiniButton label="更新" icon="cloud-download-outline" disabled={!!busy} onPress={() => void pluginAction('update', plugin.id, snapshot, setBusy, reload)} /> : <Pill label="已是最新版" />}<MiniButton label="卸载" icon="trash-outline" destructive disabled={!!busy} onPress={() => Alert.alert('卸载插件', `确定卸载 ${plugin.name}？`, [{ text: '取消', style: 'cancel' }, { text: '卸载', style: 'destructive', onPress: () => void pluginAction('uninstall', plugin.id, snapshot, setBusy, reload) }])} /></View></Card>)}{!list.length ? <Empty icon="extension-puzzle-outline" title="还没有安装插件" detail="可以从上方插件市场直接安装" /> : null}</View>;
}

function PluginMarket({ snapshot, query, setQuery, busy, setBusy, reload }: ActionProps & { query: string; setQuery: (value: string) => void }) {
  const styles = useThemeStyles(createStyles); const source = useMemo(() => snapshot.overview?.availablePlugins ?? [], [snapshot.overview?.availablePlugins]); const list = useMemo(() => source.filter((plugin: any) => !plugin.installed && `${plugin.name} ${plugin.description} ${plugin.listing?.author ?? ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 100), [source, query]);
  return <View style={styles.stack}><SummaryCard icon="storefront-outline" title={`${source.length} 个可用插件`} detail="安装到当前 ZCode 工作区" /><Input value={query} onChangeText={setQuery} placeholder="搜索名称、作者或功能" accessibilityLabel="搜索插件市场" autoCorrect={false} style={styles.searchInput} />{list.map((plugin: any) => <Card key={plugin.id} style={styles.pluginCard}><View style={styles.dataRow}><View style={styles.grow}><Text style={styles.cardTitle}>{plugin.name}</Text><Text variant="muted" style={styles.itemHint}>{plugin.listing?.author ?? plugin.marketplace ?? 'ZCode 插件市场'}</Text></View><MiniButton label={busy === plugin.id ? '安装中…' : '安装'} icon="add-circle-outline" disabled={!!busy} onPress={() => void pluginAction('install', plugin.id, snapshot, setBusy, reload)} /></View><Text variant="muted" numberOfLines={5} style={styles.description}>{plugin.description || '暂无说明'}</Text>{plugin.componentTypes?.length ? <View style={styles.pillRow}>{plugin.componentTypes.map((type: string) => <Pill key={type} label={componentLabel(type)} />)}</View> : null}</Card>)}{!list.length ? <Empty icon="search-outline" title="没有匹配的插件" detail="清空关键词或换个名称试试" /> : null}</View>;
}

function Mcp({ snapshot, busy, setBusy, reload }: ActionProps) {
  const { colors } = useTheme(); const styles = useThemeStyles(createStyles); const statuses = Object.entries(snapshot.mcp?.statuses ?? {}); const connected = statuses.filter(([, raw]) => (raw as any).status === 'connected').length;
  const change = async (name: string, enabled: boolean) => { setBusy(name); try { const result = await gateway.request<{ restartRequired?: boolean }>('gw.mcpSetEnabled', { name, enabled, workspacePath: snapshot.workspacePath }); ToastAndroid.show(result.restartRequired ? '已保存，将在新会话或重启后生效' : '已保存', ToastAndroid.LONG); await reload(true); } catch (error) { ToastAndroid.show(error instanceof Error ? error.message : '保存失败', ToastAndroid.SHORT); } finally { setBusy(''); } };
  return <View style={styles.stack}><SummaryCard icon="server-outline" title={`${connected} / ${statuses.length} 已连接`} detail={`${statuses.reduce((sum, [, raw]) => sum + Number((raw as any).toolCount ?? 0), 0)} 个工具可用`} /><View><SectionTitle title="服务器列表" detail="插件提供的服务器由对应插件统一管理" /><Card style={styles.card}>{statuses.map(([name, raw], index) => { const status = raw as any; const userManaged = !name.startsWith('plugin:'); const enabled = status.status !== 'disabled'; const isConnected = status.status === 'connected'; return <View key={name} style={[styles.toggleRow, index < statuses.length - 1 && styles.divider]}><View style={[styles.statusGlyph, { backgroundColor: isConnected ? colors.successMuted : colors.surface }]}><Ionicons name={isConnected ? 'checkmark' : enabled ? 'hourglass-outline' : 'pause'} color={isConnected ? colors.success : enabled ? colors.warning : colors.dim} size={18} /></View><View style={styles.grow}><View style={styles.labelLine}><Text style={styles.itemTitle} numberOfLines={1}>{cleanMcpName(name)}</Text><Pill label={statusLabel(status.status)} tone={isConnected ? 'success' : 'default'} /></View><Text variant="muted" style={styles.itemHint}>{status.transport ?? '未知传输'} · {status.toolCount ?? 0} 个工具{!userManaged ? ' · 插件管理' : ''}</Text></View>{busy === name ? <ActivityIndicator /> : userManaged ? <Switch accessibilityLabel={`启用 ${name}`} disabled={!!busy} value={enabled} onValueChange={(value) => void change(name, value)} /> : null}</View>; })}</Card></View>{!statuses.length ? <Empty icon="server-outline" title="没有配置 MCP 服务器" detail="可通过电脑端配置或安装包含 MCP 的插件" /> : null}</View>;
}

function Skills({ snapshot, query, setQuery }: { snapshot: Snapshot; query: string; setQuery: (value: string) => void }) {
  const styles = useThemeStyles(createStyles); const source = snapshot.skills?.skills ?? snapshot.skills?.references ?? []; const list = source.filter((skill: any) => `${skill.name} ${skill.description} ${skill.scope ?? ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 150);
  return <View style={styles.stack}><SummaryCard icon="ribbon-outline" title={`${source.length} 个技能`} detail="来自全局、工作区与已安装插件" /><Input value={query} onChangeText={setQuery} placeholder="搜索技能名称或说明" accessibilityLabel="搜索技能" autoCorrect={false} style={styles.searchInput} /><Card style={styles.card}>{list.map((skill: any, index: number) => <View key={skill.id ?? skill.path ?? skill.name} style={[styles.listItem, index < list.length - 1 && styles.divider]}><View style={styles.labelLine}><Text style={styles.itemTitle}>{skill.name}</Text>{skill.scope ? <Pill label={scopeLabel(skill.scope)} /> : null}</View><Text variant="muted" numberOfLines={4} style={styles.description}>{skill.description || '此技能没有提供说明。'}</Text></View>)}</Card>{!list.length ? <Empty icon="search-outline" title="没有匹配的技能" /> : null}</View>;
}

function Commands({ snapshot, query, setQuery }: { snapshot: Snapshot; query: string; setQuery: (value: string) => void }) {
  const { colors } = useTheme(); const styles = useThemeStyles(createStyles); const source = snapshot.commands ?? []; const list = source.filter((command: any) => `${command.name} ${command.description}`.toLowerCase().includes(query.toLowerCase()));
  const copy = async (command: any) => { await Clipboard.setStringAsync(command.inputHint || `/${command.name}`); ToastAndroid.show('命令已复制', ToastAndroid.SHORT); };
  return <View style={styles.stack}><SummaryCard icon="terminal-outline" title={`${source.length} 条可用命令`} detail="点按复制后可直接粘贴到会话输入框" /><Input value={query} onChangeText={setQuery} placeholder="搜索命令" accessibilityLabel="搜索命令" autoCorrect={false} autoCapitalize="none" style={styles.searchInput} /><Card style={styles.card}>{list.map((command: any, index: number) => <Pressable accessibilityRole="button" accessibilityLabel={`复制命令 ${command.name}`} key={command.name} onPress={() => void copy(command)} style={({ pressed }) => [styles.commandRow, index < list.length - 1 && styles.divider, pressed && styles.pressed]}><View style={styles.grow}><View style={styles.labelLine}><Text style={styles.command}>/{command.name}</Text><Pill label={command.source === 'builtin' ? '内置' : '自定义'} /></View><Text variant="muted" style={styles.description}>{command.description || '暂无说明'}</Text><Text variant="muted" numberOfLines={2} style={styles.code}>{command.inputHint || `/${command.name}`}</Text></View><Ionicons name="copy-outline" color={colors.dim} size={19} /></Pressable>)}</Card>{!list.length ? <Empty icon="search-outline" title="没有匹配的命令" /> : null}</View>;
}

function Hooks({ snapshot }: { snapshot: Snapshot }) {
  const styles = useThemeStyles(createStyles); const hooks = (snapshot.overview?.installedPlugins ?? []).flatMap((plugin: any) => (plugin.hookDetails ?? []).map((hook: any) => ({ ...hook, plugin: plugin.name, pluginEnabled: plugin.enabled })));
  return <View style={styles.stack}><SummaryCard icon="code-slash-outline" title={`${hooks.length} 个自动化钩子`} detail="钩子随所属插件启停，无需单独配置" />{hooks.length ? <Card style={styles.card}>{hooks.map((hook: any, index: number) => <View key={`${hook.plugin}-${hook.event}-${index}`} style={[styles.listItem, index < hooks.length - 1 && styles.divider]}><View style={styles.labelLine}><Text style={styles.itemTitle}>{hook.event}</Text><Pill label={hook.runnable && hook.pluginEnabled ? '可运行' : '不可运行'} tone={hook.runnable && hook.pluginEnabled ? 'success' : 'default'} /></View><Text variant="muted" style={styles.itemHint}>来自 {hook.plugin}</Text><Text variant="muted" style={styles.description}>{hook.statusMessage ?? hook.matcher ?? '在指定事件发生时自动执行'}</Text></View>)}</Card> : <Empty icon="code-slash-outline" title="当前没有钩子" detail="安装带有 Hook 组件的插件后会显示在这里" />}</View>;
}

function Subagents({ snapshot }: { snapshot: Snapshot }) {
  const { colors } = useTheme(); const styles = useThemeStyles(createStyles); const active = (snapshot.sessions ?? []).filter((session: any) => session.status === 'running').length; const agents = snapshot.agents ?? [];
  return <View style={styles.stack}><View style={styles.metricsGrid}><MetricCard label="已配置" value={String(agents.length)} icon="git-network-outline" /><MetricCard label="正在运行" value={String(active)} icon="pulse-outline" /></View><SectionTitle title="可用子智能体" detail="由当前工作区安装的插件提供" />{agents.length ? agents.map((agent: any) => <Card key={`${agent.pluginId}-${agent.name}`} style={styles.agentCard}><View style={styles.dataRow}><View style={[styles.statusGlyph, { backgroundColor: colors.successMuted }]}><Ionicons name="git-branch-outline" color={colors.success} size={18} /></View><View style={styles.grow}><Text style={styles.cardTitle}>{agent.name}</Text><Text variant="muted" style={styles.itemHint}>来自 {agent.pluginName}</Text></View><Pill label="可用" tone="success" /></View><Text variant="muted" style={styles.description}>{agent.description || '插件提供的专用子智能体。'}</Text></Card>) : <Empty icon="git-network-outline" title="当前没有已配置的子智能体" detail="临时创建的子智能体仍会显示在所属会话的实时工具流中" />}</View>;
}

function Usage({ snapshot }: { snapshot: Snapshot }) {
  const styles = useThemeStyles(createStyles); const usage = snapshot.usage ?? {}; const summary = usage.summary ?? {}; const models = usage.models ?? []; const tools = usage.tools ?? [];
  return <View style={styles.stack}><Card style={styles.usageHero}><Text variant="muted" style={styles.eyebrow}>近 30 天总 Token</Text><Text style={styles.usageValue}>{compact(summary.totalTokens)}</Text><View style={styles.metrics}><Metric label="会话" value={compact(summary.totalSessions)} /><Metric label="轮次" value={compact(summary.totalTurns)} /><Metric label="工具调用" value={compact(summary.toolCallCount)} /></View></Card><View><SectionTitle title="Token 构成" detail="统计来自电脑端 ZCode 本机数据库" /><Card style={styles.card}><DataLine label="输入" value={compact(summary.inputTokens)} /><DataLine label="输出" value={compact(summary.outputTokens)} /><DataLine label="缓存读取" value={compact(summary.cacheReadTokens)} /><DataLine label="推理" value={compact(summary.reasoningTokens)} /><DataLine label="缓存命中率" value={percent(summary.cacheHitRate)} /></Card></View><UsageHeatmap heatmap={usage.heatmap} /><View><SectionTitle title="模型用量" detail={summary.favoriteModel ? `最常用 ${summary.favoriteModel.modelId}` : undefined} /><Card style={styles.card}>{models.slice(0, 8).map((model: any, index: number) => <View key={model.modelId} style={[styles.usageRow, index < Math.min(models.length, 8) - 1 && styles.divider]}><View style={styles.grow}><View style={styles.labelLine}><Text style={styles.itemTitle}>{model.modelId}</Text><Text variant="muted" style={styles.itemHint}>{percent(model.share)}</Text></View><View style={styles.barTrack}><View style={[styles.barFill, { width: `${Math.max(2, Math.min(100, Number(model.share ?? 0) * 100))}%` }]} /></View></View><Text style={styles.usageRowValue}>{compact(model.totalTokens)}</Text></View>)}</Card></View><View><SectionTitle title="工具概况" detail={`工具错误率 ${percent(summary.toolErrorRate)}`} /><Card style={styles.card}>{tools.slice(0, 8).map((tool: any, index: number) => <View key={tool.toolName} style={[styles.dataRow, index < Math.min(tools.length, 8) - 1 && styles.divider]}><Text style={styles.grow} numberOfLines={1}>{tool.toolName}</Text><Text variant="muted" style={styles.itemHint}>{compact(tool.callCount)} 次 · 错误 {percent(tool.errorRate)}</Text></View>)}</Card></View></View>;
}

function UsageHeatmap({ heatmap }: { heatmap?: any }) {
  const { colors } = useTheme(); const styles = useThemeStyles(createStyles); const weeks = heatmap?.weeks ?? []; const palette = [colors.muted, colors.successMuted, colors.success, colors.foreground, colors.primary];
  if (!weeks.length) return null;
  return <View><SectionTitle title="Token 热力图" detail={`${heatmap.startDate} 至 ${heatmap.endDate}`} /><Card style={styles.heatmapCard}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.heatmap}>{weeks.map((week: any) => <View key={week.weekIndex} style={styles.heatmapWeek}>{(week.days ?? []).map((day: any, index: number) => day ? <View accessible accessibilityLabel={`${day.date}，${compact(day.totalTokens)} Token`} key={day.date} style={[styles.heatmapCell, { backgroundColor: palette[Math.max(0, Math.min(4, day.level ?? 0))] }]} /> : <View key={`empty-${index}`} style={[styles.heatmapCell, styles.transparent]} />)}</View>)}</ScrollView><View style={styles.legend}><Text variant="muted" style={styles.legendText}>少</Text>{palette.map((color) => <View key={color} style={[styles.legendCell, { backgroundColor: color }]} />)}<Text variant="muted" style={styles.legendText}>多</Text></View></Card></View>;
}

function Onboarding({ online }: { online: boolean }) {
  const styles = useThemeStyles(createStyles); const steps = [
    { icon: 'qr-code-outline' as const, title: '连接电脑', text: '一次配对后长期使用。更换电脑前，请在账号页主动解除配对，再重新扫码。', action: '管理配对', onPress: () => router.navigate('/(tabs)/account') },
    { icon: 'chatbubbles-outline' as const, title: '进入会话', text: '在“最新”或“会话”中查看任务状态、实时回复和工具调用。', action: '查看最新会话', onPress: () => router.push('/(tabs)/latest') },
    { icon: 'settings-outline' as const, title: '管理 ZCode', text: '模型、插件、MCP、技能和索引都在设置页原生管理。' },
  ];
  return <View style={styles.stack}><SummaryCard icon={online ? 'checkmark-circle-outline' : 'cloud-offline-outline'} title={online ? '电脑端已连接' : '等待连接电脑端'} detail={online ? '可以直接管理会话和设置' : '本机外观仍可离线设置'} />{steps.map((step, index) => <Card key={step.title} style={styles.guideCard}><View style={styles.stepCircle}><Text style={styles.stepText}>{index + 1}</Text></View><View style={styles.grow}><View style={styles.labelLine}><Text style={styles.cardTitle}>{step.title}</Text><Ionicons name={step.icon} size={19} /></View><Text variant="muted" style={styles.description}>{step.text}</Text>{step.action ? <View style={styles.guideAction}><MiniButton label={step.action} icon="arrow-forward-outline" onPress={step.onPress!} /></View> : null}</View></Card>)}</View>;
}

function SectionTitle({ title, detail }: { title: string; detail?: string }) { const styles = useThemeStyles(createStyles); return <View style={styles.sectionTitle}><Text style={styles.sectionTitleText}>{title}</Text>{detail ? <Text variant="muted" style={styles.sectionTitleDetail}>{detail}</Text> : null}</View>; }
function SummaryCard({ icon, title, detail }: { icon: keyof typeof Ionicons.glyphMap; title: string; detail: string }) { const { colors } = useTheme(); const styles = useThemeStyles(createStyles); return <Card style={styles.summaryCard}><View style={styles.summaryIcon}><Ionicons name={icon} color={colors.foreground} size={25} /></View><View style={styles.grow}><Text style={styles.summaryTitle}>{title}</Text><Text variant="muted" style={styles.description}>{detail}</Text></View></Card>; }
function MetricCard({ label, value, icon }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap }) { const { colors } = useTheme(); const styles = useThemeStyles(createStyles); return <Card style={styles.metricCard}><Ionicons name={icon} color={colors.dim} size={19} /><Text style={styles.metricCardValue}>{value}</Text><Text variant="muted" style={styles.itemHint}>{label}</Text></Card>; }
function Metric({ label, value }: { label: string; value: string }) { const styles = useThemeStyles(createStyles); return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text variant="muted" style={styles.metricLabel}>{label}</Text></View>; }
function DataLine({ label, value }: { label: string; value: string }) { const styles = useThemeStyles(createStyles); return <View style={styles.dataLine}><Text variant="muted" style={styles.grow}>{label}</Text><Text style={styles.dataValue}>{value}</Text></View>; }
function Pill({ label, tone = 'default' }: { label: string; tone?: 'default' | 'success' }) { const { colors } = useTheme(); const styles = useThemeStyles(createStyles); return <View style={[styles.pill, tone === 'success' && { backgroundColor: colors.successMuted }]}><Text style={[styles.pillText, tone === 'success' && { color: colors.success }]}>{label}</Text></View>; }
function MiniButton({ label, icon, onPress, destructive, disabled }: { label: string; icon?: keyof typeof Ionicons.glyphMap; onPress: () => void; destructive?: boolean; disabled?: boolean }) { const { colors } = useTheme(); const styles = useThemeStyles(createStyles); return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} hitSlop={4} onPress={onPress} style={({ pressed }) => [styles.miniButton, destructive && styles.destructiveButton, (pressed || disabled) && styles.faded]}>{icon ? <Ionicons name={icon} color={destructive ? colors.destructive : colors.foreground} size={17} /> : null}<Text style={[styles.miniButtonText, destructive && { color: colors.destructive }]}>{label}</Text></Pressable>; }
function Empty({ icon, title, detail, action, onAction, spinner }: { icon: keyof typeof Ionicons.glyphMap; title: string; detail?: string; action?: string; onAction?: () => void; spinner?: boolean }) { const { colors } = useTheme(); const styles = useThemeStyles(createStyles); return <View accessibilityRole={spinner ? 'progressbar' : undefined} style={styles.empty}>{spinner ? <ActivityIndicator color={colors.foreground} size="large" /> : <Ionicons name={icon} color={colors.dim} size={34} />}<Text style={styles.emptyTitle}>{title}</Text>{detail ? <Text variant="muted" style={styles.emptyDetail}>{detail}</Text> : null}{action ? <MiniButton label={action} icon="refresh-outline" onPress={onAction!} /> : null}</View>; }

function compact(value = 0) { return Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value) || 0); }
function percent(value = 0) { return `${(Number(value || 0) * 100).toFixed(Number(value || 0) < 0.1 ? 1 : 0)}%`; }
function componentLabel(value: string) { return ({ command: '命令', skill: '技能', mcp: 'MCP', hook: '钩子', agent: '子智能体' } as Record<string, string>)[value] ?? value; }
function scopeLabel(value: string) { return ({ global: '全局', workspace: '工作区', user: '用户', plugin: '插件' } as Record<string, string>)[value] ?? value; }
function statusLabel(value: string) { return ({ connected: '已连接', disabled: '已停用', connecting: '连接中', error: '异常' } as Record<string, string>)[value] ?? value; }
function cleanMcpName(value: string) { const parts = value.split(':'); return parts.length > 1 ? parts.at(-1)!.replace(/^.*?\//, '') : value; }

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, screen: { flex: 1 }, content: { padding: spacing.lg, paddingBottom: 48 }, grow: { flex: 1 }, stack: { gap: spacing.lg },
  header: { minHeight: 66, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingHorizontal: spacing.sm }, back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 }, headerText: { flex: 1 }, headerSpacer: { width: 48 }, refreshButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 }, title: { fontSize: 19, fontWeight: '700' }, subtitle: { fontSize: 11, marginTop: 2 },
  contextBar: { minHeight: 58, marginBottom: spacing.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, contextTitle: { fontSize: 12, fontWeight: '700' }, contextPath: { fontSize: 10, marginTop: 2 },
  sectionTitle: { marginBottom: spacing.sm }, sectionTitleText: { fontSize: 15, fontWeight: '700' }, sectionTitleDetail: { fontSize: 11, lineHeight: 17, marginTop: 2 }, card: { paddingHorizontal: spacing.md, overflow: 'hidden' }, cardTitle: { fontSize: 16, fontWeight: '700' }, summaryCard: { minHeight: 92, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, summaryIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' }, summaryTitle: { fontSize: 19, fontWeight: '700' },
  toggleRow: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm }, divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, iconBox: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }, statusGlyph: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, labelLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, itemTitle: { flexShrink: 1, fontSize: 14, fontWeight: '600' }, itemHint: { fontSize: 11, lineHeight: 16, marginTop: 2 }, stateLabel: { fontSize: 10, fontWeight: '700' }, warningText: { fontSize: 10, lineHeight: 15, marginTop: 4 }, description: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  segmentRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.md }, segment: { flex: 1, minHeight: 48, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface }, segmentActive: { backgroundColor: colors.primary, borderColor: colors.primary }, segmentText: { fontSize: 12, fontWeight: '700' },
  searchInput: { height: 48, backgroundColor: colors.card }, selectRow: { minHeight: 76, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, dataRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, listItem: { paddingVertical: spacing.md }, commandRow: { minHeight: 92, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, command: { color: colors.link, fontSize: 15, fontWeight: '700', fontFamily: 'monospace' }, code: { fontSize: 11, lineHeight: 17, fontFamily: 'monospace', marginTop: 5 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm }, pill: { minHeight: 24, paddingHorizontal: 8, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }, pillText: { color: colors.mutedForeground, fontSize: 9, fontWeight: '700' },
  marketLink: { minHeight: 82, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, marketIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, pluginCard: { padding: spacing.md }, pluginGlyph: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }, actionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  miniButton: { minHeight: 40, paddingHorizontal: 13, borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: colors.secondary }, destructiveButton: { backgroundColor: colors.destructiveMuted }, miniButtonText: { fontSize: 11, fontWeight: '700' }, faded: { opacity: 0.45 }, pressed: { opacity: 0.68 },
  metricsGrid: { flexDirection: 'row', gap: spacing.sm }, metricCard: { flex: 1, minHeight: 112, padding: spacing.md }, metricCardValue: { fontSize: 28, lineHeight: 36, fontWeight: '700', marginTop: spacing.sm }, agentCard: { padding: spacing.md },
  usageHero: { padding: spacing.lg }, eyebrow: { fontSize: 11 }, usageValue: { fontSize: 34, lineHeight: 44, fontWeight: '700', fontVariant: ['tabular-nums'] }, metrics: { flexDirection: 'row', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, metric: { flex: 1 }, metricValue: { fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] }, metricLabel: { fontSize: 10, marginTop: 2 }, dataLine: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, dataValue: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] }, usageRow: { minHeight: 64, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, usageRowValue: { minWidth: 66, textAlign: 'right', fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] }, barTrack: { height: 5, marginTop: 8, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.surfaceRaised }, barFill: { height: 5, borderRadius: 3, backgroundColor: colors.foreground },
  heatmapCard: { padding: spacing.md }, heatmap: { flexDirection: 'row', gap: 5, paddingRight: spacing.sm }, heatmapWeek: { gap: 5 }, heatmapCell: { width: 16, height: 16, borderRadius: 4 }, transparent: { backgroundColor: 'transparent' }, legend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: spacing.sm }, legendCell: { width: 10, height: 10, borderRadius: 3 }, legendText: { fontSize: 9 },
  guideCard: { minHeight: 126, padding: spacing.md, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }, stepCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, stepText: { color: colors.primaryForeground, fontWeight: '800' }, guideAction: { alignItems: 'flex-start', marginTop: spacing.md },
  empty: { minHeight: 280, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm }, emptyTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' }, emptyDetail: { maxWidth: 280, fontSize: 12, lineHeight: 18, textAlign: 'center' }, inlineError: { minHeight: 48, marginTop: spacing.md, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.destructiveMuted, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, inlineErrorText: { flex: 1, fontSize: 11, lineHeight: 16 },
});
