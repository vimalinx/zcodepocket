import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text } from '@/components/ui/text';
import { spacing, type ThemeColors, useTheme, useThemeStyles } from '@/lib/theme';
import { isOfficialRemoteUrl, pairFromOfficialUrl } from '@/lib/official-pairing';
import { useApp } from '@/store/app';

export { isOfficialRemoteUrl };

export default function ScannerScreen() {
  const { colors } = useTheme();
  const styles = useThemeStyles(createStyles);
  const [permission, requestPermission] = useCameraPermissions();
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState('');
  const scanLock = useRef(false);
  const pair = useApp((s) => s.pair);

  useEffect(() => {
    void requestPermission();
  }, [requestPermission]);

  const onScanned = async (raw: string) => {
    if (scanLock.current) return;
    scanLock.current = true;
    const s = raw.trim();
    if (!isOfficialRemoteUrl(s)) {
      setDone(true);
      Alert.alert('无法识别二维码', '这里只接受 ZCode 官方 remote/v4 二维码。', [{ text: '继续扫描', onPress: () => { scanLock.current = false; setDone(false); } }], { cancelable: false });
      return;
    }
    setDone(true);
    try {
      await pairFromOfficialUrl(s, { pair, onProgress: setProgress });
      // The root switches to the paired stack, removing scanner AND login.
    } catch (error) {
      setProgress('');
      Alert.alert('连接失败', error instanceof Error ? error.message : '请重新扫描官方二维码', [
        { text: '重新扫描', onPress: () => { scanLock.current = false; setDone(false); } },
      ], { cancelable: false });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => router.back()} style={styles.back} hitSlop={8}>
          <Ionicons name="chevron-back" color={colors.foreground} size={24} />
        </Pressable>
        <Text variant="primary" style={styles.title}>
          扫码连接电脑
        </Text>
      </View>

      <View style={styles.cameraWrap}>
        {permission?.granted ? (
          <CameraView
            style={styles.camera}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={done ? undefined : ({ data }) => void onScanned(data)}
          />
        ) : (
          <View style={[styles.camera, styles.placeholder]}>
            <Text variant="muted" style={styles.hint}>
              {permission ? '未获得相机权限' : '正在请求相机权限…'}
            </Text>
            {!permission?.granted ? (
              <Pressable style={styles.permBtn} onPress={() => void requestPermission()}>
                <Text>授权相机</Text>
              </Pressable>
            ) : null}
          </View>
        )}
        <View style={styles.frame}>
          <Text variant="muted" style={styles.hint}>
            对准电脑上的配对二维码
          </Text>
        </View>
        {done && progress ? <View style={styles.connecting}><ActivityIndicator color="#ffffff" size="small" /><Text style={styles.connectingText}>{progress}</Text></View> : null}
      </View>

      <Text variant="muted" style={styles.footer}>
        仅接受 ZCode 官方 remote/v4 二维码，识别后会自动连接对应电脑
      </Text>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: 4,
  },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '700' },
  cameraWrap: { flex: 1, paddingHorizontal: spacing.lg },
  camera: { flex: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000' },
  placeholder: { alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  frame: { position: 'absolute', left: 0, right: 0, bottom: spacing.xl, alignItems: 'center' },
  connecting: { position: 'absolute', left: spacing.xl, right: spacing.xl, top: '45%', minHeight: 56, borderRadius: 28, backgroundColor: 'rgba(9,9,11,0.84)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  connectingText: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  hint: { textAlign: 'center', padding: spacing.sm },
  permBtn: {
    backgroundColor: colors.secondary,
    borderRadius: 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  footer: { textAlign: 'center', fontSize: 12, padding: spacing.lg },
});
