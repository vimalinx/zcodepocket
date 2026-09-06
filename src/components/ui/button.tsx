import { memo } from 'react';
import { Pressable, StyleSheet, type ViewProps } from 'react-native';
import { radius, useTheme } from '@/lib/theme';
import { Text } from './text';

type Variant = 'default' | 'secondary' | 'ghost' | 'destructive';
type Size = 'default' | 'sm';

const sizeStyle: Record<Size, { paddingHorizontal: number; height: number; fontSize: number }> = {
  default: { paddingHorizontal: 18, height: 48, fontSize: 15 },
  sm: { paddingHorizontal: 12, height: 40, fontSize: 13 },
};

type Props = ViewProps & {
  onPress?: () => void;
  disabled?: boolean;
  variant?: Variant;
  size?: Size;
  label: string;
};

export const Button = memo(function Button({ onPress, disabled, variant = 'default', size = 'default', label, ...viewProps }: Props) {
  const { colors } = useTheme();
  const variantStyle: Record<Variant, { bg: string; fg: string; border?: string }> = {
    default: { bg: colors.primary, fg: colors.primaryForeground },
    secondary: { bg: colors.secondary, fg: colors.secondaryForeground },
    ghost: { bg: 'transparent', fg: colors.foreground },
    destructive: { bg: colors.destructiveMuted, fg: colors.destructive, border: colors.destructive },
  };
  const v = variantStyle[variant];
  const s = sizeStyle[size];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: v.bg, height: s.height, paddingHorizontal: s.paddingHorizontal, borderRadius: radius.md },
        v.border ? { borderWidth: 1, borderColor: v.border } : null,
        pressed ? { opacity: 0.8 } : null,
        disabled ? { opacity: 0.45 } : null,
      ]}
      {...viewProps}
    >
      <Text style={{ color: v.fg, fontSize: s.fontSize, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
});
