import { forwardRef, memo } from 'react';
import { StyleSheet, TextInput, type TextInputProps } from 'react-native';
import { radius, type ThemeColors, useTheme, useThemeStyles } from '@/lib/theme';

export const Input = memo(forwardRef<TextInput, TextInputProps>(function Input({ style, ...props }, ref) {
  const { colors } = useTheme();
  const styles = useThemeStyles(createStyles);
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={colors.dim}
      style={[
        styles.base,
        style,
      ]}
      {...props}
    />
  );
}));

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  base: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.foreground,
    fontSize: 15,
    paddingHorizontal: 12,
    height: 44,
  },
});
