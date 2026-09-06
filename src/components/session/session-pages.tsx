import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import { useTheme } from '@/lib/theme';
import type { useSessionPanel } from '@/lib/session-panel';

export function SessionPages({ panel, chat, settings }: {
  panel: ReturnType<typeof useSessionPanel>; chat: ReactNode; settings: ReactNode;
}) {
  const { colors } = useTheme();
  return <GestureDetector gesture={panel.gesture}><View collapsable={false} style={[styles.viewport, panel.showing && { backgroundColor: colors.background }]}>
    <Animated.View style={[styles.track, panel.trackStyle]}>
      <View style={{ width: panel.width }} pointerEvents={panel.showing ? 'none' : 'auto'}
        accessibilityElementsHidden={panel.showing} importantForAccessibility={panel.showing ? 'no-hide-descendants' : 'auto'}>{chat}</View>
      <View style={{ width: panel.width, backgroundColor: colors.background }} pointerEvents={panel.showing && !panel.transitioning ? 'auto' : 'none'}
        accessibilityElementsHidden={!panel.showing || panel.transitioning} importantForAccessibility={!panel.showing || panel.transitioning ? 'no-hide-descendants' : 'auto'}>{settings}</View>
    </Animated.View>
  </View></GestureDetector>;
}

const styles = StyleSheet.create({ viewport: { flex: 1, overflow: 'hidden' }, track: { flex: 1, flexDirection: 'row' } });
