import { useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { changeBackgroundImage } from '@/lib/chat-background-files';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChatBackground } from '@/components/chat/chat-background';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { radius, spacing, type ThemeColors, useTheme, useThemeStyles } from '@/lib/theme';
import { DEFAULT_CHAT_BACKGROUND, useApp } from '@/store/app';

const OVERLAY_PRESETS = ['#09090b', '#111827', '#172554', '#3f1d2e', '#3f2a12', '#f4f4f5'];

export function AppearanceSettings() {
  const { colors } = useTheme();
  const styles = useThemeStyles(createStyles);
  const appearanceMode = useApp((state) => state.appearanceMode);
  const setAppearanceMode = useApp((state) => state.setAppearanceMode);
  const chatBackground = useApp((state) => state.chatBackground);
  const setChatBackground = useApp((state) => state.setChatBackground);
  const [overlayColor, setOverlayColor] = useState(chatBackground.overlayColor);
  const [colorError, setColorError] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [imageError, setImageError] = useState('');
  const [failedImageUri, setFailedImageUri] = useState<string | null>(null);
  const choosingLock = useRef(false);

  const runBackgroundChange = async (change: () => Promise<void>) => {
    if (choosingLock.current) return;
    choosingLock.current = true;
    setChoosing(true);
    setImageError('');
    try {
      await change();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setImageError(message);
      Alert.alert('无法设置背景', message);
    } finally {
      choosingLock.current = false;
      setChoosing(false);
    }
  };

  const chooseBackground = () => runBackgroundChange(async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'image/*', multiple: false, copyToCacheDirectory: true });
    if (!result.canceled && result.assets[0]) await changeBackgroundImage(result.assets[0].uri);
  });

  const removeBackgroundFile = () => runBackgroundChange(() => changeBackgroundImage(null));

  const resetBackground = () => runBackgroundChange(async () => {
    await changeBackgroundImage(null, true);
    setOverlayColor(DEFAULT_CHAT_BACKGROUND.overlayColor);
    setColorError('');
  });

  const commitOverlayColor = () => {
    const normalized = overlayColor.trim();
    if (!/^#[0-9a-f]{6}$/i.test(normalized)) {
      setColorError('请输入完整的 6 位十六进制颜色，例如 #172554');
      return;
    }
    setColorError('');
    void setChatBackground({ overlayColor: normalized });
  };

  return (
    <View style={styles.stack}>
      <SectionHeading title="界面主题" detail="立即应用到整个手机端" />
      <Card style={styles.card}>
        <View style={styles.themeGrid}>
          <ThemeChoice icon="moon-outline" label="深色" selected={appearanceMode === 'dark'} onPress={() => void setAppearanceMode('dark')} />
          <ThemeChoice icon="sunny-outline" label="浅色" selected={appearanceMode === 'light'} onPress={() => void setAppearanceMode('light')} />
        </View>
      </Card>

      <SectionHeading title="对话背景" detail="仅影响会话内容区，所有设置保存在本机" />
      <Card style={styles.backgroundCard}>
        <View style={styles.backgroundPreview} accessibilityLabel="当前对话背景预览">
          <ChatBackground onLoadError={setFailedImageUri} onLoaded={(uri) => setFailedImageUri((failed) => failed === uri ? null : failed)} />
          <View pointerEvents="none" style={styles.previewConversation}>
            <View style={styles.previewAssistant}>
              <Text style={styles.previewName}>ZCode</Text>
              <Text style={styles.previewText}>背景和蒙版会在这里实时预览。</Text>
            </View>
            <View style={styles.previewUser}><Text style={styles.previewText}>看起来不错</Text></View>
          </View>
          <View style={styles.localBadge}><Ionicons name="phone-portrait-outline" color="#ffffff" size={14} /><Text style={styles.localBadgeText}>{chatBackground.uri ? '本机图片' : '默认纯色'}</Text></View>
        </View>

        <View style={styles.actionRow}>
          <Button variant="secondary" label={choosing ? '正在处理…' : chatBackground.uri ? '更换图片' : '选择图片'} onPress={() => void chooseBackground()} disabled={choosing} />
          {chatBackground.uri ? <Button variant="ghost" label="移除图片" onPress={() => void removeBackgroundFile()} disabled={choosing} /> : null}
        </View>

        <Text variant="muted">可选 JPG、PNG / APNG、WebP、GIF、BMP；HEIC / AVIF 视设备支持。按文件内容识别，导入后转为静态背景，最长边 2048 像素。</Text>
        {imageError || (chatBackground.uri && failedImageUri === chatBackground.uri) ? <Text accessibilityLiveRegion="polite" style={{ color: colors.destructive }}>{imageError || '当前背景加载失败，请重新选择图片或换一种格式；也可移除图片恢复纯色背景。'}</Text> : null}

        <View style={styles.controlBlock}>
          <View style={styles.controlHeader}><Text style={styles.controlTitle}>颜色蒙版</Text><Text variant="muted" style={styles.controlValue}>{chatBackground.overlayColor.toUpperCase()}</Text></View>
          <View style={styles.colorRow}>
            {OVERLAY_PRESETS.map((color) => {
              const selected = chatBackground.overlayColor.toLowerCase() === color;
              return (
                <Pressable
                  key={color}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={`蒙版颜色 ${color}`}
                  onPress={() => { setOverlayColor(color); setColorError(''); void setChatBackground({ overlayColor: color }); }}
                  style={({ pressed }) => [styles.swatchTarget, pressed && styles.pressed]}
                >
                  <View style={[styles.colorSwatch, { backgroundColor: color }, selected && styles.colorSwatchSelected]}>
                    {selected ? <Ionicons name="checkmark" color={color === '#f4f4f5' ? '#18181b' : '#ffffff'} size={16} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.hexRow}>
            <Input
              accessibilityLabel="自定义蒙版颜色"
              value={overlayColor}
              onChangeText={(value) => { setOverlayColor(value); if (colorError) setColorError(''); }}
              onSubmitEditing={commitOverlayColor}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={7}
              placeholder="#09090B"
              returnKeyType="done"
              style={[styles.colorInput, colorError ? styles.inputError : null]}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="应用自定义蒙版颜色" onPress={commitOverlayColor} style={({ pressed }) => [styles.applyButton, pressed && styles.pressed]}><Text style={styles.applyButtonText}>应用</Text></Pressable>
          </View>
          {colorError ? <Text variant="destructive" style={styles.errorText}>{colorError}</Text> : null}
        </View>

        <SettingSlider label="蒙版不透明度" hint="越高，背景图片越不抢文字" value={chatBackground.overlayOpacity} min={0} max={1} step={0.01} onChange={(value) => void setChatBackground({ overlayOpacity: value })} />
        <SettingSlider label="背景亮度" hint="只调整图片，不影响文字和组件" value={chatBackground.brightness} min={0.4} max={1.5} step={0.01} onChange={(value) => void setChatBackground({ brightness: value })} />
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 12 }}>
          <View style={{ flex: 1 }}><Text>倾斜视差背景</Text><Text variant="muted">轻轻倾斜手机，背景移动，聊天文字保持不动。</Text></View>
          <Switch accessibilityLabel="倾斜视差背景" value={chatBackground.parallaxEnabled} onValueChange={(value) => { void setChatBackground({ parallaxEnabled: value }).catch(() => Alert.alert('保存失败', '请稍后重试。')); }} />
        </View>
        {chatBackground.parallaxEnabled && <SettingSlider label="视差强度" hint="整图视差，不是人物分层；离开页面或减少动态效果开启时暂停" value={chatBackground.parallaxStrength} min={0} max={1} step={0.05} onChange={(value) => void setChatBackground({ parallaxStrength: value })} />}

        <View style={styles.privacyNote}><Ionicons name="lock-closed-outline" color={colors.mutedForeground} size={16} /><Text variant="muted" style={styles.privacyText}>图片、蒙版和亮度只保存在这台手机，不上传到电脑或 ZCode。</Text></View>
        <Button variant="ghost" label="恢复默认背景设置" onPress={() => void resetBackground()} disabled={choosing} />
      </Card>
    </View>
  );
}

function SectionHeading({ title, detail }: { title: string; detail: string }) {
  const styles = useThemeStyles(createStyles);
  return <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{title}</Text><Text variant="muted" style={styles.sectionDetail}>{detail}</Text></View>;
}

function ThemeChoice({ icon, label, selected, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useThemeStyles(createStyles);
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={`${label}主题`} onPress={onPress} style={({ pressed }) => [styles.themeChoice, selected && styles.themeChoiceSelected, pressed && styles.pressed]}>
      <Ionicons name={icon} color={colors.foreground} size={22} />
      <Text style={styles.themeLabel}>{label}</Text>
      <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} color={selected ? colors.success : colors.dim} size={20} />
    </Pressable>
  );
}

function SettingSlider({ label, hint, value, min, max, step, onChange }: { label: string; hint: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  const styles = useThemeStyles(createStyles);
  const [width, setWidth] = useState(1);
  const percent = ((value - min) / (max - min)) * 100;
  const update = (locationX: number) => {
    const raw = min + Math.min(1, Math.max(0, locationX / width)) * (max - min);
    onChange(Math.round(raw / step) * step);
  };
  return (
    <View style={styles.sliderBlock}>
      <View style={styles.sliderHead}><View style={styles.grow}><Text style={styles.controlTitle}>{label}</Text><Text variant="muted" style={styles.sliderHint}>{hint}</Text></View><Text style={styles.sliderValue}>{Math.round(value * 100)}%</Text></View>
      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: Math.round(min * 100), max: Math.round(max * 100), now: Math.round(value * 100) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => onChange(Math.min(max, Math.max(min, value + (event.nativeEvent.actionName === 'increment' ? step * 5 : -step * 5))))}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        onPress={(event) => update(event.nativeEvent.locationX)}
        onTouchMove={(event) => update(event.nativeEvent.locationX)}
        style={styles.sliderTrack}
      >
        <View pointerEvents="none" style={styles.sliderRail} />
        <View pointerEvents="none" style={[styles.sliderFill, { width: `${percent}%` }]} />
        <View pointerEvents="none" style={[styles.sliderThumb, { left: `${percent}%` }]} />
      </Pressable>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  stack: { gap: spacing.md }, grow: { flex: 1 }, card: { padding: spacing.md }, backgroundCard: { padding: spacing.md, gap: spacing.md },
  sectionHeading: { marginTop: spacing.xs }, sectionTitle: { fontSize: 16, fontWeight: '700' }, sectionDetail: { fontSize: 12, lineHeight: 18, marginTop: 2 },
  themeGrid: { flexDirection: 'row', gap: spacing.sm }, themeChoice: { flex: 1, minHeight: 64, paddingHorizontal: spacing.md, borderRadius: radius.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, themeChoiceSelected: { borderColor: colors.foreground, backgroundColor: colors.surfaceRaised }, themeLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  backgroundPreview: { height: 210, overflow: 'hidden', borderRadius: radius.lg, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.borderStrong, justifyContent: 'flex-end' }, previewConversation: { flex: 1, padding: spacing.md, justifyContent: 'center', gap: spacing.sm }, previewAssistant: { maxWidth: '84%' }, previewName: { fontSize: 11, fontWeight: '700', marginBottom: 4 }, previewUser: { alignSelf: 'flex-end', maxWidth: '76%', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 16, backgroundColor: colors.userBubble }, previewText: { fontSize: 13, lineHeight: 19 }, localBadge: { position: 'absolute', left: 12, bottom: 12, minHeight: 30, paddingHorizontal: 10, borderRadius: 15, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(9,9,11,0.76)' }, localBadgeText: { color: '#ffffff', fontSize: 11, fontWeight: '600' },
  actionRow: { gap: spacing.xs }, controlBlock: { gap: spacing.sm }, controlHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, controlTitle: { fontSize: 14, fontWeight: '600' }, controlValue: { fontSize: 11, fontFamily: 'monospace' },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 }, swatchTarget: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }, colorSwatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' }, colorSwatchSelected: { borderWidth: 2, borderColor: colors.foreground },
  hexRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, colorInput: { flex: 1, height: 48, fontSize: 14, fontFamily: 'monospace' }, inputError: { borderColor: colors.destructive }, applyButton: { minWidth: 72, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.secondary }, applyButtonText: { fontSize: 13, fontWeight: '700' }, errorText: { fontSize: 11, lineHeight: 16 },
  sliderBlock: { paddingVertical: spacing.xs }, sliderHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: 8 }, sliderHint: { fontSize: 11, lineHeight: 16, marginTop: 2 }, sliderValue: { minWidth: 48, textAlign: 'right', fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] }, sliderTrack: { height: 48, justifyContent: 'center' }, sliderRail: { position: 'absolute', left: 0, right: 0, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong }, sliderFill: { position: 'absolute', left: 0, height: 5, borderRadius: 3, backgroundColor: colors.foreground }, sliderThumb: { position: 'absolute', width: 22, height: 22, marginLeft: -11, borderRadius: 11, backgroundColor: colors.foreground, borderWidth: 4, borderColor: colors.card },
  privacyNote: { minHeight: 48, padding: spacing.sm, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface }, privacyText: { flex: 1, fontSize: 11, lineHeight: 17 }, pressed: { opacity: 0.7 },
});
