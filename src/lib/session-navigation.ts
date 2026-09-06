import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { Animated, AppState, Easing, Keyboard, PanResponder, useWindowDimensions, type PanResponderGestureState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { create } from 'zustand';
import { resetSessionEntry, useSessionEntry } from '@/components/session/session-entry';
import { settleMotion, type GestureRelease } from './gesture-motion';
import type { SessionTarget } from './session-routes';

type InteractiveDrag = {
  begin: () => boolean;
  move: (dx: number, width: number) => void;
  release: (commit: boolean, gesture: GestureRelease, done: () => void) => void;
};
export const useSessionNavigation = create<{ current: SessionTarget | null; remember: (current: SessionTarget) => void }>((set) => ({
  current: null,
  remember: (current) => set({ current }),
}));

// A focused page owns its gesture; no shared incoming opacity/offset that another
// page can accidentally consume during rapid navigation.
export function useSessionSwipe(left?: (gesture?: GestureRelease) => void, right?: (gesture?: GestureRelease) => void,
  { rightDrag, leftDrag, canCapture }: { rightDrag?: InteractiveDrag; leftDrag?: InteractiveDrag; canCapture?: () => boolean } = {}) {
  const { width } = useWindowDimensions();
  const translation = useMemo(() => new Animated.Value(0), []);
  const callbacks = useRef({ left, right, rightDrag, leftDrag, canCapture });
  useLayoutEffect(() => { callbacks.current = { left, right, rightDrag, leftDrag, canCapture }; }, [left, right, rightDrag, leftDrag, canCapture]);
  const locked = useRef(false);
  const interactive = useRef(false);
  const capturedDirection = useRef<'left' | 'right'>('right');
  const focused = useRef(false);
  const generation = useRef(0);
  const watchdog = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const restore = useCallback(() => {
    generation.current++;
    clearTimeout(watchdog.current);
    translation.stopAnimation();
    translation.setValue(0);
    locked.current = false;
    interactive.current = false;
  }, [translation]);

  useLayoutEffect(() => {
    let readyVersion = useSessionEntry.getState().readyVersion;
    return useSessionEntry.subscribe((state) => {
      if (!focused.current && (state.readyVersion !== readyVersion || state.entry?.phase === 'return-dragging')) translation.setValue(0);
      readyVersion = state.readyVersion;
    });
  }, [translation]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    restore();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        if (interactive.current || useSessionEntry.getState().entry?.phase.startsWith('return-')) resetSessionEntry();
        restore();
      }
    });
    return () => {
      focused.current = false;
      generation.current++;
      clearTimeout(watchdog.current);
      subscription.remove();
      translation.stopAnimation();
      if (interactive.current) resetSessionEntry();
      interactive.current = false;
      locked.current = false;
    };
  }, [restore, translation]));

  const armWatchdog = useCallback(() => {
    clearTimeout(watchdog.current);
    watchdog.current = setTimeout(() => {
      // Interrupted/failed navigation must not strand the focused page offscreen.
      if (focused.current) { resetSessionEntry(); restore(); }
    }, 2200);
  }, [restore]);

  const settle = useCallback((target: number, velocity: number, action?: () => void) => {
    const token = ++generation.current;
    locked.current = true;
    armWatchdog();
    translation.stopAnimation((current) => {
      if (token !== generation.current || !focused.current) return;
      const motion = settleMotion(Math.abs(target - current), velocity * Math.sign(target - current));
      Animated.timing(translation, { toValue: target, duration: useSessionEntry.getState().reducedMotion ? 0 : motion.duration,
        easing: Easing.bezier(0.25, motion.controlY, 0.35, 1), useNativeDriver: true }).start(({ finished }) => {
        if (token !== generation.current || !focused.current) return;
        if (!finished || !action) { restore(); return; }
        try { action(); } catch { restore(); }
      });
    });
  }, [armWatchdog, restore, translation]);

  const navigate = useCallback((direction: 'left' | 'right', gesture?: GestureRelease) => {
    const action = callbacks.current[direction];
    if (!action || locked.current) return;
    const entry = useSessionEntry.getState().entry;
    if (entry) {
      if (direction === 'right' && ['settling', 'opening'].includes(entry.phase)) resetSessionEntry();
      else return;
    }
    Keyboard.dismiss();
    const drag = callbacks.current[direction === 'right' ? 'rightDrag' : 'leftDrag'];
    // Buttons and gestures commit the same transition, without a delayed handoff.
    if (!gesture && drag?.begin()) {
      locked.current = true;
      armWatchdog();
      drag.release(true, { dx: 0, vx: 0, width }, restore);
      return;
    }
    settle(direction === 'left' ? -width : width, gesture?.vx ?? 0, () => action(gesture));
  }, [armWatchdog, restore, settle, width]);

  const responder = useMemo(() => {
    const capture = (_: unknown, g: PanResponderGestureState) => {
      const direction = g.dx < 0 ? 'left' : 'right';
      const entry = useSessionEntry.getState().entry;
      const available = !entry || (direction === 'right' && ['settling', 'opening'].includes(entry.phase));
      const accepted = focused.current && !locked.current && available &&
        (callbacks.current.canCapture?.() ?? true) && g.numberActiveTouches === 1 && Math.abs(g.dx) > 16 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2 && !!callbacks.current[direction];
      if (accepted) capturedDirection.current = direction;
      return accepted;
    };
    const cancel = () => {
      if (interactive.current) {
        interactive.current = false;
        locked.current = true;
        armWatchdog();
        callbacks.current[capturedDirection.current === 'right' ? 'rightDrag' : 'leftDrag']?.release(false, { dx: 0, vx: 0, width }, restore);
      } else settle(0, 0);
    };
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: capture,
      onMoveShouldSetPanResponder: capture,
      onPanResponderGrant: (_, g) => {
        generation.current++;
        translation.stopAnimation();
        const entry = useSessionEntry.getState().entry;
        if (capturedDirection.current === 'right' && entry && ['settling', 'opening'].includes(entry.phase)) resetSessionEntry();
        // RN's onResponderGrant resets dx/dy to zero. The accepted direction
        // belongs to the capture event, not this freshly reset gesture state.
        const drag = callbacks.current[capturedDirection.current === 'right' ? 'rightDrag' : 'leftDrag'];
        interactive.current = !!drag?.begin();
        if (interactive.current) drag?.move(g.dx, width);
        else translation.setValue(Math.max(-width, Math.min(width, g.dx)));
      },
      onPanResponderMove: (_, g) => {
        if (interactive.current) { callbacks.current[capturedDirection.current === 'right' ? 'rightDrag' : 'leftDrag']?.move(g.dx, width); return; }
        if (!locked.current) translation.setValue(callbacks.current[g.dx < 0 ? 'left' : 'right'] ? Math.max(-width, Math.min(width, g.dx)) : g.dx * 0.12);
      },
      onPanResponderTerminationRequest: () => true,
      onPanResponderRelease: (_, g) => {
        if (g.numberActiveTouches > 0) { cancel(); return; }
        if (interactive.current) {
          interactive.current = false;
          locked.current = true;
          armWatchdog();
          const sign = capturedDirection.current === 'right' ? 1 : -1;
          callbacks.current[sign === 1 ? 'rightDrag' : 'leftDrag']?.release(g.dx * sign > width * 0.22 || (g.dx * sign > 24 && g.vx * sign > 0.45), { dx: g.dx, vx: g.vx, width }, restore);
          return;
        }
        const direction = g.dx < 0 ? 'left' : 'right';
        const towardVelocity = g.vx * Math.sign(g.dx);
        if (callbacks.current[direction] && (Math.abs(g.dx) >= width * 0.18 || (Math.abs(g.dx) >= 24 && towardVelocity >= 0.45))) navigate(direction, { dx: g.dx, vx: g.vx, width });
        else settle(0, g.vx);
      },
      onPanResponderTerminate: cancel,
    });
  }, [armWatchdog, navigate, restore, settle, translation, width]);
  return { panHandlers: responder.panHandlers, animatedStyle: { transform: [{ translateX: translation }] }, left: () => navigate('left'), right: () => navigate('right') };
}
