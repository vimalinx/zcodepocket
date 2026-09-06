import { memo, useMemo } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text as RNText, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Markdown, { MarkdownIt, type RenderRules } from 'react-native-markdown-display';
import { radius, spacing, type ThemeColors, useTheme, useThemeStyles } from '@/lib/theme';

const markdownIt = MarkdownIt({
  breaks: true,
  linkify: true,
  typographer: true,
});

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

const createMarkdownStyles = (colors: ThemeColors) => StyleSheet.create({
  body: {
    color: colors.foreground,
    fontSize: 16,
    lineHeight: 26,
  },
  paragraph: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: '100%',
    marginTop: 0,
    marginBottom: 14,
  },
  text: {
    color: colors.foreground,
    fontSize: 16,
    lineHeight: 26,
  },
  strong: { color: colors.foreground, fontWeight: '700' },
  em: { color: colors.foreground, fontStyle: 'italic' },
  s: { color: colors.mutedForeground, textDecorationLine: 'line-through' },
  heading1: {
    color: colors.foreground,
    fontSize: 24,
    lineHeight: 31,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 14,
  },
  heading2: {
    color: colors.foreground,
    fontSize: 21,
    lineHeight: 28,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 12,
  },
  heading3: {
    color: colors.foreground,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '700',
    marginTop: 6,
    marginBottom: 10,
  },
  heading4: {
    color: colors.foreground,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 8,
  },
  heading5: {
    color: colors.foreground,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '700',
    marginBottom: 8,
  },
  heading6: {
    color: colors.mutedForeground,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  bullet_list: { marginBottom: 12 },
  ordered_list: { marginBottom: 12 },
  list_item: { flexDirection: 'row', marginBottom: 5 },
  bullet_list_icon: { color: colors.mutedForeground, marginLeft: 2, marginRight: 10, lineHeight: 26 },
  ordered_list_icon: {
    color: colors.mutedForeground,
    minWidth: 20,
    marginLeft: 0,
    marginRight: 8,
    lineHeight: 26,
  },
  bullet_list_content: { flex: 1 },
  ordered_list_content: { flex: 1 },
  blockquote: {
    backgroundColor: colors.surface,
    borderColor: colors.quote,
    borderLeftWidth: 3,
    borderRadius: radius.md,
    marginTop: 2,
    marginBottom: 14,
    marginLeft: 0,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 0,
  },
  code_inline: {
    color: colors.codeForeground,
    backgroundColor: colors.codeBackground,
    borderColor: colors.borderStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 5,
    fontFamily: mono,
    fontSize: 14,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  fence: {},
  code_block: {},
  link: { color: colors.link, textDecorationLine: 'none' },
  hr: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth, marginVertical: 16 },
  table: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, marginBottom: 14 },
  tr: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong, flexDirection: 'row' },
  th: { flex: 1, backgroundColor: colors.surfaceRaised, padding: 8 },
  td: { flex: 1, padding: 8 },
});

function CodeBlock({ content }: { content: string }) {
  const { colors } = useTheme();
  const styles = useThemeStyles(createStyles);
  const value = content.endsWith('\n') ? content.slice(0, -1) : content;
  return (
    <View style={styles.codeShell}>
      <View style={styles.codeToolbar}>
        <RNText style={styles.codeLabel}>代码</RNText>
        <Pressable
          accessibilityLabel="复制代码"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => void Clipboard.setStringAsync(value)}
          style={({ pressed }) => [styles.copyCode, pressed && styles.pressed]}
        >
          <Ionicons accessible={false} name="copy-outline" color={colors.mutedForeground} size={15} />
          <RNText style={styles.copyCodeText}>复制</RNText>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codeScroll}>
        <RNText selectable style={styles.codeText}>
          {value}
        </RNText>
      </ScrollView>
    </View>
  );
}

export const MarkdownMessage = memo(function MarkdownMessage({ children }: { children: string }) {
  const markdownStyles = useThemeStyles(createMarkdownStyles);
  const rules = useMemo<RenderRules>(
    () => ({
      fence: (node) => <CodeBlock key={node.key} content={node.content} />,
      code_block: (node) => <CodeBlock key={node.key} content={node.content} />,
    }),
    [],
  );

  return (
    <Markdown
      markdownit={markdownIt}
      rules={rules}
      style={markdownStyles}
      onLinkPress={(url) => /^(https?:|mailto:)/i.test(url)}
    >
      {children}
    </Markdown>
  );
});

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  codeShell: {
    overflow: 'hidden',
    backgroundColor: colors.codeBackground,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    marginTop: 2,
    marginBottom: spacing.lg,
  },
  codeToolbar: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 12,
    paddingRight: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  codeLabel: { color: colors.mutedForeground, fontSize: 12, fontWeight: '600' },
  copyCode: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 6 },
  copyCodeText: { color: colors.mutedForeground, fontSize: 12 },
  codeScroll: { padding: 13 },
  codeText: { color: colors.codeForeground, fontFamily: mono, fontSize: 13, lineHeight: 20 },
  pressed: { opacity: 0.6 },
});
