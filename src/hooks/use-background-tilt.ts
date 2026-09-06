import { useCallback } from 'react';
import { AccessibilityInfo, AppState, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Accelerometer } from 'expo-sensors';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import { tiltOffset } from '@/lib/background-tilt';

export function useBackgroundTilt(enabled: boolean) {
  const x = useSharedValue(0), y = useSharedValue(0);
  useFocusEffect(useCallback(() => {
    let disposed = false, generation = 0, reduced = true;
    let active = AppState.currentState === 'active';
    let sensor: { remove(): void } | undefined;
    let origin: { x: number; y: number } | undefined;
    const stop = () => {
      generation++;
      sensor?.remove(); sensor = undefined; origin = undefined;
      x.value = 0; y.value = 0;
    };
    const start = async () => {
      stop();
      if (!enabled || !active || reduced || disposed || Platform.OS !== 'android') return;
      const run = generation;
      try {
        if (!await Accelerometer.isAvailableAsync() || disposed || run !== generation) return;
        Accelerometer.setUpdateInterval(40);
        sensor = Accelerometer.addListener((value) => {
          if (disposed || run !== generation || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return;
          origin ??= value;
          const offset = tiltOffset(value, origin);
          x.value = withTiming(offset.x, { duration: 160 });
          y.value = withTiming(offset.y, { duration: 160 });
        });
      } catch { stop(); }
    };
    const app = AppState.addEventListener('change', (state) => { active = state === 'active'; void start(); });
    let accessibilityChanged = false;
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => { accessibilityChanged = true; reduced = value; void start(); });
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (!disposed && !accessibilityChanged) { reduced = value; void start(); }
    }).catch(() => {});
    return () => { disposed = true; stop(); app.remove(); motion.remove(); };
  }, [enabled, x, y]));
  return { x, y };
}
