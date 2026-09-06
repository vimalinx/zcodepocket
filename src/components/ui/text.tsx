import { Text as RNText, type TextProps } from 'react-native';
import { useMemo } from 'react';
import { useTheme } from '@/lib/theme';

type Variant = 'default' | 'muted' | 'primary' | 'destructive';

export function Text({ variant = 'default', style, ...props }: TextProps & { variant?: Variant }) {
  const { colors } = useTheme();
  const palette = useMemo<Record<Variant, { color: string; fontWeight?: '500' | '600' | '700' }>>(() => ({
    default: { color: colors.foreground },
    muted: { color: colors.mutedForeground },
    primary: { color: colors.primary, fontWeight: '600' },
    destructive: { color: colors.destructive },
  }), [colors]);
  return <RNText style={[{ color: colors.foreground, fontSize: 15 }, palette[variant], style]} {...props} />;
}
