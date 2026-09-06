import { Alert, Linking, Pressable, StyleSheet, Switch, View } from 'react-native';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/lib/theme';
import { checkAppUpdate, installedBuild, installedVersion, setAutomaticUpdates, useAppUpdates } from '@/lib/app-updates';

export function AppUpdatesCard() {
  const { colors } = useTheme();
  const { automatic, checking, message, release, checkedAt } = useAppUpdates();
  const download = () => {
    if (!release) return;
    Alert.alert(`下载 ${release.version}`, '将打开 GitHub 安装包链接。下载完成后，点击 APK 并按 Android 提示安装。若提示签名不一致，请勿卸载旧版，以免丢失数据。', [
      { text: '取消', style: 'cancel' },
      { text: '前往下载', onPress: () => { void Linking.openURL(release.url).catch(() => Alert.alert('无法打开下载链接', '请检查系统浏览器设置后重试。')); } },
    ]);
  };
  return <Card style={styles.card}>
    <Text style={styles.title}>应用更新</Text>
    <Text variant="muted">当前版本 {installedVersion ?? '开发预览'}{installedBuild ? ` (${installedBuild})` : ''}</Text>
    <View style={styles.row}>
      <Text style={styles.label}>自动检查更新</Text>
      <Switch accessibilityLabel="自动检查应用更新" value={automatic} onValueChange={(value) => { void setAutomaticUpdates(value); }} />
    </View>
    <Text variant="muted">启动或回到前台时检查，每 6 小时至多一次；不会自动下载。</Text>
    <Text accessibilityLiveRegion="polite" style={styles.status}>{message}</Text>
    {checkedAt > 0 && <Text variant="muted">上次成功检查 {new Date(checkedAt).toLocaleString()}</Text>}
    {release?.notes ? <Text numberOfLines={8} variant="muted">{release.notes}</Text> : null}
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: checking }} disabled={checking} onPress={() => { void checkAppUpdate(true); }} style={({ pressed }) => [styles.button, { borderColor: colors.border, opacity: checking || pressed ? 0.5 : 1 }]}>
      <Text>{checking ? '检查中…' : '检查更新'}</Text>
    </Pressable>
    {release && <Pressable accessibilityRole="button" onPress={download} style={({ pressed }) => [styles.button, { borderColor: colors.primary, opacity: pressed ? 0.6 : 1 }]}><Text>下载新版 APK</Text></Pressable>}
    <Text variant="muted">更新来源 · vimalinx/zcodepocket</Text>
  </Card>;
}
const styles = StyleSheet.create({
  card: { margin: 20, padding: 16, gap: 12 }, title: { fontSize: 17, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }, label: { flex: 1 },
  status: { fontSize: 14 }, button: { minHeight: 48, borderWidth: 1, borderRadius: 12, padding: 12, alignItems: 'center', justifyContent: 'center' },
});
