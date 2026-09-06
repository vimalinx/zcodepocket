import { useCallback, useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, StyleSheet, useWindowDimensions, type View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { Text } from '@/components/ui/text';
import { settleMotion, type GestureRelease } from '@/lib/gesture-motion';

export type EntryRect = { x: number; y: number; width: number; height: number };
type Entry = { id: string; title: string; row: EntryRect; titleRect: EntryRect; source: string; layoutRevision?: number; open: () => void; phase: 'dragging' | 'settling' | 'opening' | 'return-dragging' | 'return-settling' | 'return-handoff' };
const entries = new Map<string, Omit<Entry, 'phase'>>();
const layoutRevisions = new Map<string, number>();
export function invalidateSessionLayout(source: string) {
  layoutRevisions.set(source, (layoutRevisions.get(source) ?? 0) + 1);
  const entry = useSessionEntry.getState().entry;
  if (entry?.source === source && ['return-dragging', 'return-settling'].includes(entry.phase)) resetSessionEntry();
}
function validEntry(id: string, source?: string) {
  const entry = entries.get(id);
  return entry && (!source || source === entry.source) && entry.layoutRevision === (layoutRevisions.get(entry.source) ?? 0) ? entry : undefined;
}
export const entryProgress = new Animated.Value(0);
export const sessionEntryModels = new Map<string, string>();
const overlayOpacity = new Animated.Value(1);
export const useSessionEntry = create<{ entry: Entry | null; reducedMotion: boolean; readyVersion: number }>(() => ({ entry: null, reducedMotion: false, readyVersion: 0 }));
let timeout: ReturnType<typeof setTimeout> | undefined;
let handoffDuration = 240;
let transitionGeneration = 0;
let returnDone: (() => void) | undefined;
let pageReady = false;
let fading = false;
let measurementGeneration = 0;

export function reserveEntryMeasurement() { return ++measurementGeneration; }
export function isCurrentEntryMeasurement(token: number) { return token === measurementGeneration && !useSessionEntry.getState().entry; }

export function forgetSessionEntry(id: string) {
  if (useSessionEntry.getState().entry?.id === id) resetSessionEntry();
  entries.delete(id);
  sessionEntryModels.delete(id);
}

export function beginInteractiveReturn(id: string, source?: string) {
  const previous = validEntry(id, source);
  if (!previous || (source && previous.source !== source) || useSessionEntry.getState().entry || useSessionEntry.getState().reducedMotion) return false;
  transitionGeneration++;
  clearTimeout(timeout);
  entryProgress.stopAnimation();
  entryProgress.setValue(1);
  overlayOpacity.setValue(1);
  useSessionEntry.setState({ entry: { ...previous, phase: 'return-dragging' } });
  return true;
}

export function moveInteractiveReturn(dx: number, width: number) {
  if (useSessionEntry.getState().entry?.phase !== 'return-dragging') return;
  entryProgress.setValue(1 - Math.max(0, Math.min(1, dx / Math.max(1, width * 0.8))));
}

export function releaseInteractiveReturn(commit: boolean, gesture: GestureRelease, navigate: (source: string) => void, done: () => void) {
  const entry = useSessionEntry.getState().entry;
  if (entry?.phase !== 'return-dragging') { done(); return; }
  const generation = transitionGeneration;
  returnDone = done;
  useSessionEntry.setState({ entry: { ...entry, phase: 'return-settling' } });
  entryProgress.stopAnimation((progress) => {
    if (generation !== transitionGeneration) return;
    const target = commit ? 0 : 1;
    const motion = settleMotion(Math.abs(target - progress) * gesture.width * 0.8, gesture.vx * (commit ? 1 : -1));
    Animated.timing(entryProgress, { toValue: target, duration: motion.duration, easing: Easing.bezier(0.25, motion.controlY, 0.35, 1), useNativeDriver: true }).start(({ finished }) => {
      if (generation !== transitionGeneration) return;
      if (!finished || !commit) { resetSessionEntry(); return; }
      // Keep the chat invisible until the original list has regained focus.
      useSessionEntry.setState({ entry: { ...entry, phase: 'return-handoff' } });
      try { navigate(entry.source); } catch { resetSessionEntry(); return; }
      timeout = setTimeout(() => { if (generation === transitionGeneration) resetSessionEntry(); }, 700);
    });
  });
}

export function finishInteractiveReturn(source?: string) {
  const entry = useSessionEntry.getState().entry;
  if (entry?.phase === 'return-handoff' && source === entry.source) resetSessionEntry();
}

export function useSessionListHandoff(source: string) {
  const ref = useRef<View>(null);
  const focused = useRef(false);
  const onLayout = useCallback(() => {
    const generation = transitionGeneration;
    ref.current?.measureInWindow((_x, _y, width, height) => {
      if (focused.current && generation === transitionGeneration && width > 0 && height > 0) finishInteractiveReturn(source);
    });
  }, [source]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    onLayout();
    return () => { focused.current = false; measurementGeneration++; };
  }, [onLayout]));
  return { ref, onLayout };
}

export function resetSessionEntry() {
  transitionGeneration++;
  pageReady = false;
  fading = false;
  clearTimeout(timeout);
  const done = returnDone;
  returnDone = undefined;
  useSessionEntry.setState({ entry: null });
  entryProgress.stopAnimation();
  overlayOpacity.stopAnimation();
  // Preserve the last native frame until React detaches the overlay/row styles.
  // Resetting here briefly replays the source list before that commit lands.
  done?.();
}

export function beginSessionEntry(entry: Omit<Entry, 'phase'>) {
  if (useSessionEntry.getState().entry) return false;
  transitionGeneration++;
  entryProgress.setValue(0);
  overlayOpacity.setValue(1);
  pageReady = false;
  fading = false;
  useSessionEntry.setState({ entry: { ...entry, layoutRevision: layoutRevisions.get(entry.source) ?? 0, phase: 'dragging' } });
  timeout = setTimeout(resetSessionEntry, 15000);
  return true;
}

export function beginReopenSessionEntry(id: string, source: string, open: () => void) {
  const previous = validEntry(id, source);
  return !!previous && beginSessionEntry({ ...previous, open });
}

export function moveSessionEntry(dx: number, width: number) {
  if (useSessionEntry.getState().entry?.phase === 'dragging') entryProgress.setValue(Math.max(0, Math.min(1, -dx / Math.max(1, width * 0.65))));
}

export function releaseReopenSessionEntry(commit: boolean, gesture: GestureRelease, done: () => void) {
  returnDone = done;
  releaseSessionEntry(commit, gesture);
}

export function releaseSessionEntry(commit: boolean, gesture?: GestureRelease) {
  const { entry, reducedMotion } = useSessionEntry.getState();
  if (!entry || entry.phase !== 'dragging') return;
  const generation = transitionGeneration;
  useSessionEntry.setState({ entry: { ...entry, phase: 'settling' } });
  // Start routing/loading now, while the shared transition is moving. The real
  // list layout acknowledges readiness; mounting one frame is not readiness.
  if (commit) {
    entries.set(entry.id, entry);
    try { entry.open(); } catch { resetSessionEntry(); return; }
  }
  entryProgress.stopAnimation((progress) => {
    if (generation !== transitionGeneration) return;
    const distance = Math.abs((commit ? 1 : 0) - progress) * (gesture?.width ?? entry.row.width) * 0.65;
    const motion = settleMotion(distance, gesture ? gesture.vx * (commit ? -1 : 1) : 0);
    handoffDuration = Math.round(motion.duration * 0.6);
    Animated.timing(entryProgress, { toValue: commit ? 1 : 0, duration: reducedMotion ? 0 : motion.duration, easing: Easing.bezier(0.25, motion.controlY, 0.35, 1), useNativeDriver: true }).start(({ finished }) => {
      if (generation !== transitionGeneration) return;
      if (!finished || !commit) { resetSessionEntry(); return; }
      useSessionEntry.setState({ entry: { ...entry, phase: 'opening' } });
      clearTimeout(timeout);
      // Safety recovery only. Normal handoff is driven by the destination layout.
      timeout = setTimeout(resetSessionEntry, 3000);
      if (pageReady) finishSessionEntry(entry.id);
    });
  });
}

export function finishSessionEntry(id: string) {
  const entry = useSessionEntry.getState().entry;
  if (entry?.id !== id || !['settling', 'opening'].includes(entry.phase)) return;
  pageReady = true;
  if (entry.phase !== 'opening' || fading) return;
  fading = true;
  const generation = transitionGeneration;
  clearTimeout(timeout);
  Animated.timing(overlayOpacity, { toValue: 0, duration: handoffDuration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start(({ finished }) => {
    if (generation === transitionGeneration) resetSessionEntry();
  });
}

export function acknowledgeSessionPage(id: string) {
  useSessionEntry.setState({ readyVersion: useSessionEntry.getState().readyVersion + 1 });
  finishSessionEntry(id);
}

export function returnSessionEntry(id: string, navigate: (source: string) => void, gesture?: GestureRelease, source?: string) {
  const previous = validEntry(id, source);
  if (!beginInteractiveReturn(id, source)) { navigate(source ?? previous?.source ?? '/latest'); return; }
  releaseInteractiveReturn(true, gesture ?? { dx: 0, vx: 0, width: previous!.row.width }, navigate, () => {});
}

export function SessionEntryOverlay() {
  const entry = useSessionEntry((s) => s.entry);
  const reducedMotion = useSessionEntry((s) => s.reducedMotion);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    let active = true;
    const updateMotion = (reducedMotion: boolean) => {
      if (!active) return;
      useSessionEntry.setState({ reducedMotion });
      if (reducedMotion && useSessionEntry.getState().entry) resetSessionEntry();
    };
    void AccessibilityInfo.isReduceMotionEnabled().then(updateMotion).catch(() => {});
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', updateMotion);
    const lifecycle = AppState.addEventListener('change', state => { if (state !== 'active') resetSessionEntry(); });
    return () => { active = false; listener.remove(); lifecycle.remove(); resetSessionEntry(); };
  }, []);
  if (!entry || reducedMotion) return null;
  const interpolate = (from: number, to: number) => entryProgress.interpolate({ inputRange: [0, 1], outputRange: [from, to], extrapolate: 'clamp' });
  const titleWidth = Math.min(entry.titleRect.width, width - 136);
  const interactiveReturn = entry.phase.startsWith('return-');
  return <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, { zIndex: 100, opacity: interactiveReturn ? entryProgress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }) : overlayOpacity }]}>
    <Animated.View style={{ position: 'absolute', left: entry.titleRect.x, top: entry.titleRect.y, width: titleWidth, opacity: entryProgress.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }), transform: [
      { translateX: interpolate(0, (width - titleWidth) / 2 - entry.titleRect.x) },
      { translateY: interpolate(0, insets.top + 17 - entry.titleRect.y) },
      { scale: interpolate(1, 16 / 15) },
    ] }}><Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '700' }}>{entry.title}</Text></Animated.View>
  </Animated.View>;
}
