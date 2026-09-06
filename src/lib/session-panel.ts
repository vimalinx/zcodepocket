import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Keyboard, useWindowDimensions } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { cancelAnimation, Easing, runOnJS, runOnUI, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';
import { useSessionEntry } from '@/components/session/session-entry';
import { panelReleaseTarget, panelSettleMotion } from './session-panel-motion';

// One UI-thread track owns both real pages. Input, cancellation and settling
// never wait for a JS render, bridge position read or animation-end watchdog.
export function useSessionPanel(initialSettings = false, gestureTop = 0, gestureBottom = Infinity) {
  const { width } = useWindowDimensions();
  const progress = useSharedValue(initialSettings ? 1 : 0);
  const page = useSharedValue(initialSettings ? 1 : 0);
  const origin = useSharedValue(initialSettings ? 1 : 0);
  const originPage = useSharedValue(initialSettings ? 1 : 0);
  const focused = useSharedValue(false);
  const dragging = useSharedValue(false);
  const moving = useSharedValue(false);
  const epoch = useSharedValue(0);
  const touchX = useSharedValue(0);
  const touchY = useSharedValue(0);
  const blocked = useSharedValue(!!useSessionEntry.getState().entry);
  const reduced = useSharedValue(useSessionEntry.getState().reducedMotion);
  const [showing, setShowing] = useState(initialSettings);
  const [transitioning, setTransitioning] = useState(false);

  const publish = useCallback((settings: boolean, transition: boolean) => {
    setShowing(settings);
    setTransitioning(transition);
  }, []);
  const dismissKeyboard = useCallback(() => Keyboard.dismiss(), []);

  useEffect(() => useSessionEntry.subscribe((state) => {
    blocked.set(!!state.entry);
    reduced.set(state.reducedMotion);
  }), [blocked, reduced]);

  const restore = useCallback(() => {
    'worklet';
    epoch.set(epoch.get() + 1);
    cancelAnimation(progress);
    progress.set(page.get());
    dragging.set(false);
    moving.set(false);
    runOnJS(publish)(page.get() === 1, false);
  }, [dragging, epoch, moving, page, progress, publish]);

  useFocusEffect(useCallback(() => {
    runOnUI(() => { focused.set(width > 0); restore(); })();
    const subscription = AppState.addEventListener('change', (state) => {
      runOnUI(() => { focused.set(state === 'active' && width > 0); restore(); })();
    });
    return () => {
      subscription.remove();
      runOnUI(() => { focused.set(false); restore(); })();
    };
  }, [focused, restore, width]));

  const settle = useCallback((target: number, velocity = 0) => {
    'worklet';
    if (!focused.get()) return;
    epoch.set(epoch.get() + 1);
    const token = epoch.get();
    cancelAnimation(progress);
    dragging.set(false);
    const distance = Math.abs(target - progress.get()) * width;
    const motion = panelSettleMotion(distance, velocity * Math.sign(target - progress.get()));
    const finish = () => {
      'worklet';
      if (token !== epoch.get() || !focused.get()) return;
      page.set(target);
      progress.set(target);
      moving.set(false);
      runOnJS(publish)(target === 1, false);
    };
    if (reduced.get() || distance < 1) { finish(); return; }
    moving.set(true);
    runOnJS(publish)(true, true);
    progress.set(withTiming(target, {
      duration: motion.duration,
      easing: Easing.bezier(0.25, motion.controlY, 0.35, 1),
    }, (finished) => { if (finished) finish(); }));
  }, [dragging, epoch, focused, moving, page, progress, publish, reduced, width]);

  const open = useCallback(() => {
    Keyboard.dismiss();
    runOnUI(() => { if (!blocked.get()) settle(1); })();
  }, [blocked, settle]);
  const close = useCallback(() => { runOnUI(() => settle(0))(); }, [settle]);
  // Resolve hierarchy on the same thread as the moving page, not from a stale
  // React `showing` snapshot. A back during either transition only closes settings.
  const back = useCallback((returnToList: () => void) => {
    runOnUI(() => {
      if (!focused.get()) return;
      if (page.get() === 1 || progress.get() > 0 || moving.get() || dragging.get()) settle(0);
      else runOnJS(returnToList)();
    })();
  }, [dragging, focused, moving, page, progress, settle]);

  const gesture = useMemo(() => Gesture.Pan().manualActivation(true).maxPointers(1)
    .onTouchesDown((event, manager) => {
      if (!focused.get() || blocked.get() || event.numberOfTouches !== 1) { manager.fail(); return; }
      // Navigation lives in the header; text selection, attachments and other
      // horizontal controls in the conversation retain their own gestures.
      const y = event.allTouches[0].absoluteY;
      if (y < gestureTop || y > gestureBottom) { manager.fail(); return; }
      touchX.set(event.allTouches[0].absoluteX);
      touchY.set(event.allTouches[0].absoluteY);
    })
    .onTouchesMove((event, manager) => {
      if (dragging.get()) return;
      if (!focused.get() || blocked.get() || event.numberOfTouches !== 1) { manager.fail(); return; }
      const dx = event.allTouches[0].absoluteX - touchX.get();
      const dy = event.allTouches[0].absoluteY - touchY.get();
      if (Math.abs(dy) > 16 && Math.abs(dy) * 1.2 >= Math.abs(dx)) { manager.fail(); return; }
      if (Math.abs(dx) <= 16 || Math.abs(dx) <= Math.abs(dy) * 1.2) return;
      // Chat's right swipe belongs to its parent list. Between endpoints, either
      // direction can take over the current animation without waiting for it.
      if (!moving.get() && (progress.get() === 0 ? dx > 0 : progress.get() === 1 && dx < 0)) manager.fail();
      else manager.activate();
    })
    .onStart(() => {
      epoch.set(epoch.get() + 1);
      cancelAnimation(progress);
      origin.set(progress.get());
      originPage.set(page.get());
      dragging.set(true);
      moving.set(true);
      runOnJS(publish)(true, true);
      runOnJS(dismissKeyboard)();
    })
    .onUpdate((event) => {
      if (dragging.get() && focused.get()) progress.set(Math.max(0, Math.min(1, origin.get() - event.translationX / width)));
    })
    .onEnd((event, success) => {
      if (!dragging.get()) return;
      settle(success ? panelReleaseTarget(progress.get(), origin.get(), originPage.get(), event.translationX, event.velocityX, width) : originPage.get(), -event.velocityX / 1000);
    })
    .onFinalize(() => { if (dragging.get()) settle(originPage.get()); }),
  [blocked, dismissKeyboard, dragging, epoch, focused, gestureBottom, gestureTop, moving, origin, originPage, page, progress, publish, settle, touchX, touchY, width]);

  const trackStyle = useAnimatedStyle(() => ({ width: width * 2, transform: [{ translateX: -progress.get() * width }] }), [width]);
  const canReturnToList = useCallback(() => focused.get() && page.get() === 0 && progress.get() === 0 && !moving.get() && !dragging.get(), [dragging, focused, moving, page, progress]);
  return { open, close, back, showing, transitioning, width, gesture, trackStyle, canReturnToList };
}
