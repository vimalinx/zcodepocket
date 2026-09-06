import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { spacing, type ThemeColors, useThemeStyles } from '@/lib/theme';
import { isOfficialRemoteUrl, pairFromOfficialUrl } from '@/lib/official-pairing';
import { useApp } from '@/store/app';

export default function PairScreen() {
  const styles = useThemeStyles(createStyles);
  const pair = useApp((s) => s.pair);
  const [officialUrl, setOfficialUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const pairingLock = useRef(false);

  const connectOfficial = async (value = officialUrl) => {
    if (pairingLock.current) return;
    const normalized = value.trim();
    setError('');
    if (!isOfficialRemoteUrl(normalized)) {
      setError('请输入 ZCode 官方 remote/v4 链接');
      return;
    }
    pairingLock.current = true;
    setOfficialUrl(normalized);
    setBusy(true);
    try {
      await pairFromOfficialUrl(normalized, { pair, onProgress: setProgress });
      setOfficialUrl('');
      // The root's protected routes remove the entire login history on pairing.
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '连接失败，请重试');
    } finally {
      pairingLock.current = false;
      setBusy(false);
      setProgress('');
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const raw = (await Clipboard.getStringAsync()).trim();
      setOfficialUrl(raw);
      await connectOfficial(raw);
    } catch {
      setError('无法读取剪贴板，请重试');
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <View style={styles.body}>
          <Text variant="primary" style={styles.title}>
            ZCode Pocket
          </Text>
          <Text variant="muted" style={styles.subtitle}>
            扫描或粘贴电脑上 ZCode 提供的官方链接，通过官方公网连接原生会话
          </Text>

          <Button label="扫描 ZCode 官方二维码" onPress={() => router.push('/scanner')} disabled={busy} />
          <Text variant="muted" style={styles.or}>
            —— 或粘贴官方链接 ——
          </Text>

          <Card style={styles.card}>
            <Text variant="muted" style={styles.label}>
              ZCode 官方链接
            </Text>
            <Input
              accessibilityLabel="ZCode 官方链接"
              value={officialUrl}
              onChangeText={setOfficialUrl}
              placeholder="https://zcode.z.ai/remote/v4…"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={!busy}
              onSubmitEditing={() => void connectOfficial()}
            />
            <Button variant="ghost" size="sm" label="从剪贴板粘贴并连接" onPress={() => void pasteFromClipboard()} disabled={busy} />
            {error ? (
              <Text variant="destructive" accessibilityLiveRegion="assertive" style={styles.error}>
                {error}
              </Text>
            ) : null}
            {busy && progress ? <Text variant="muted" style={styles.progress}>{progress}</Text> : null}
            <Button variant="secondary" label={busy ? '正在自动连接…' : '连接'} onPress={() => void connectOfficial()} disabled={busy} />
          </Card>
          <Text variant="muted" style={styles.privacy}>配对凭据保存在手机安全存储中。连接与会话数据经 ZCode 官方服务转发，不需要同一 Wi-Fi 或额外网关。</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  body: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.sm },
  title: { fontSize: 28, textAlign: 'center' },
  subtitle: { textAlign: 'center', marginBottom: spacing.md },
  or: { textAlign: 'center', fontSize: 12 },
  card: { padding: spacing.lg, gap: spacing.sm },
  label: { fontSize: 13, marginTop: spacing.xs },
  error: { fontSize: 13 },
  progress: { fontSize: 12, textAlign: 'center' },
  privacy: { fontSize: 11, lineHeight: 17, textAlign: 'center', paddingHorizontal: spacing.md },
});
