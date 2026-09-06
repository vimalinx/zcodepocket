import { createContext, createElement, useContext, useMemo, type PropsWithChildren } from 'react';
import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';

export type AppearanceMode = 'dark' | 'light';

export type ThemeColors = {
  background: string;
  card: string;
  surface: string;
  surfaceRaised: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  borderStrong: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  userBubble: string;
  link: string;
  quote: string;
  codeBackground: string;
  codeForeground: string;
  destructive: string;
  destructiveMuted: string;
  success: string;
  successMuted: string;
  warning: string;
  dim: string;
};

export const darkColors: ThemeColors = {
  background: '#09090b',
  card: '#0f0f12',
  surface: '#131316',
  surfaceRaised: '#1a1a1f',
  foreground: '#fafafa',
  muted: '#18181b',
  mutedForeground: '#a1a1aa',
  border: '#27272a',
  borderStrong: '#34343a',
  primary: '#fafafa',
  primaryForeground: '#18181b',
  secondary: '#27272a',
  secondaryForeground: '#fafafa',
  userBubble: '#202025',
  link: '#a5b4fc',
  quote: '#71717a',
  codeBackground: '#111114',
  codeForeground: '#e4e4e7',
  destructive: '#ef4444',
  destructiveMuted: '#450a0a',
  success: '#4ade80',
  successMuted: '#052e16',
  warning: '#fbbf24',
  dim: '#71717a',
};

export const lightColors: ThemeColors = {
  background: '#f7f7f8',
  card: '#ffffff',
  surface: '#f1f1f3',
  surfaceRaised: '#e9e9ed',
  foreground: '#18181b',
  muted: '#e4e4e7',
  mutedForeground: '#52525b',
  border: '#dedee3',
  borderStrong: '#c6c6ce',
  primary: '#18181b',
  primaryForeground: '#fafafa',
  secondary: '#e4e4e7',
  secondaryForeground: '#18181b',
  userBubble: '#e9e9ed',
  link: '#4338ca',
  quote: '#71717a',
  codeBackground: '#18181b',
  codeForeground: '#f4f4f5',
  destructive: '#dc2626',
  destructiveMuted: '#fee2e2',
  success: '#16803a',
  successMuted: '#dcfce7',
  warning: '#a16207',
  dim: '#71717a',
};

/** Dark remains the compatibility default for modules not yet using the theme context. */
export const colors = darkColors;

export function getThemeColors(mode: AppearanceMode) {
  return mode === 'light' ? lightColors : darkColors;
}

type ThemeValue = { mode: AppearanceMode; colors: ThemeColors; isDark: boolean };
const ThemeContext = createContext<ThemeValue>({ mode: 'dark', colors: darkColors, isDark: true });

export function ThemeProvider({ mode, children }: PropsWithChildren<{ mode: AppearanceMode }>) {
  const value = useMemo<ThemeValue>(() => ({ mode, colors: getThemeColors(mode), isDark: mode === 'dark' }), [mode]);
  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function useThemeStyles<T extends Record<string, ViewStyle | TextStyle | ImageStyle>>(factory: (theme: ThemeColors) => T) {
  const { colors: themeColors } = useTheme();
  return useMemo(() => factory(themeColors), [factory, themeColors]);
}

export const radius = { md: 8, lg: 12, xl: 16 } as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
