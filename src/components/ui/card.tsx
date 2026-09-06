import { memo } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { radius, type ThemeColors, useThemeStyles } from '@/lib/theme';

export const Card = memo(function Card({ style, ...props }: ViewProps) {
  const styles = useThemeStyles(createStyles);
  return <View style={[styles.base, style]} {...props} />;
});

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  base: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
  },
});
