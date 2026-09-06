import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useApp } from '@/store/app';
import { useTheme } from '@/lib/theme';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useBackgroundTilt } from '@/hooks/use-background-tilt';

export function ChatBackground({ onLoadError, onLoaded }: { onLoadError?: (uri: string) => void; onLoaded?: (uri: string) => void } = {}) {
  const background = useApp((state) => state.chatBackground);
  const { colors } = useTheme();
  const enabled = !!background.uri && background.parallaxEnabled && background.parallaxStrength > 0;
  const { x, y } = useBackgroundTilt(enabled);
  const strength = enabled ? background.parallaxStrength : 0;
  const motionStyle = useAnimatedStyle(() => ({ transform: [
    { translateX: x.value * 22 * strength }, { translateY: -y.value * 22 * strength },
  ] }));
  const darken = background.brightness < 1 ? 1 - background.brightness : 0;
  const lighten = background.brightness > 1 ? Math.min(0.5, background.brightness - 1) : 0;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.background, overflow: 'hidden' }]}>
      {background.uri ? <Animated.View style={[StyleSheet.absoluteFill, enabled ? { top: -24, bottom: -24, left: -24, right: -24 } : null, motionStyle]}><Image key={background.uri} recyclingKey={background.uri} source={{ uri: background.uri }} contentFit="cover" transition={0} onError={() => onLoadError?.(background.uri!)} onLoad={() => onLoaded?.(background.uri!)} style={StyleSheet.absoluteFill} /></Animated.View> : null}
      {background.uri && darken > 0 ? <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0, 0, 0, ${darken})` }]} /> : null}
      {background.uri && lighten > 0 ? <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(255, 255, 255, ${lighten})` }]} /> : null}
      {background.uri ? <View style={[StyleSheet.absoluteFill, { backgroundColor: background.overlayColor, opacity: background.overlayOpacity }]} /> : null}
    </View>
  );
}
