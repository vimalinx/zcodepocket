import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text } from '@/components/ui/text';
import { spacing, type ThemeColors, useTheme, useThemeStyles } from '@/lib/theme';
import { relTime } from '@/lib/util';
import type { SessionInfo } from '@/store/app';
import { beginSessionEntry, entryProgress, isCurrentEntryMeasurement, releaseSessionEntry, reserveEntryMeasurement, useSessionEntry } from './session-entry';
const rowPositions = new Map<string, number>();

function sessionState(colors: ThemeColors, status?: string, running?: boolean, pending?: boolean) {
  if (pending || /fail|error|block|wait/i.test(status ?? '')) return { label: '阻塞', color: colors.warning };
  if (running || status === 'running') return { label: '进行中', color: colors.success };
  return { label: '空闲', color: colors.dim };
}

export const SessionRow = memo(function SessionRow({
  item,
  source,
  running,
  pending,
  pinned,
  onPress,
  onTogglePin,
}: {
  item: SessionInfo;
  source: '/latest' | '/sessions';
  running: boolean;
  pending: boolean;
  pinned: boolean;
  onPress: (session: SessionInfo) => void;
  onTogglePin: (session: SessionInfo) => void;
}) {
  const { colors } = useTheme();
  const styles = useThemeStyles(createStyles);
  const status = sessionState(colors, item.status, running, pending);
  const { height } = useWindowDimensions();
  // A mounted background tab keeps its own identity while the chat is focused.
  const entry = useSessionEntry((s) => s.entry?.source === source ? s.entry : null);
  const reducedMotion = useSessionEntry((s) => s.reducedMotion);
  const rowRef = useRef<View>(null);
  const titleRef = useRef<View>(null);
  const titleTextWidth = useRef(0);
  const positionKey = `${source}:${item.sessionId}`;
  const [rowY, setRowY] = useState(() => rowPositions.get(positionKey) ?? 0);
  useEffect(() => {
    if (entry?.phase === 'dragging') rowRef.current?.measureInWindow((_x, y, w, h) => {
      if (w > 0 && h > 0) { rowPositions.set(positionKey, y); setRowY(y); }
    });
  }, [entry, positionKey]);
  const begin = useCallback(() => {
    if (useSessionEntry.getState().entry) return;
    if (reducedMotion) { onPress(item); return; }
    const token = reserveEntryMeasurement();
    rowRef.current?.measureInWindow((x, y, rowWidth, rowHeight) => {
      if (!isCurrentEntryMeasurement(token)) return;
      titleRef.current?.measureInWindow((tx, ty, tw, th) => {
        if (!isCurrentEntryMeasurement(token)) return;
        if (rowWidth <= 0 || rowHeight <= 0 || tw <= 0) { onPress(item); return; }
        const started = beginSessionEntry({ id: item.sessionId, title: item.title || '(未命名会话)', source, row: { x, y, width: rowWidth, height: rowHeight }, titleRect: { x: tx, y: ty, width: Math.min(tw, titleTextWidth.current || tw), height: th }, open: () => onPress(item) });
        // Give every visible row a layout pass at progress zero before splitting.
        if (started) requestAnimationFrame(() => requestAnimationFrame(() => {
          if (useSessionEntry.getState().entry?.id === item.sessionId) releaseSessionEntry(true);
        }));
      });
    });
  }, [item, onPress, reducedMotion, source]);
  const selected = entry?.id === item.sessionId;
  const distance = entry && !selected ? (rowY < entry.row.y ? -height : height) : 0;
  // Keep the native graph attached for the row's entire lifetime. Replacing
  // interpolations on every phase/cleanup races native completion with React's
  // animated-props detach/restore, leaving the native view on an old frame.
  const motion = useMemo(() => {
    const active = new Animated.Value(0);
    const chosen = new Animated.Value(0);
    const offset = new Animated.Value(0);
    const progress = Animated.multiply(entryProgress, active);
    const selectedOpacity = progress.interpolate({ inputRange: [0, 0.12, 1], outputRange: [1, 0, 0], extrapolate: 'clamp' });
    const siblingOpacity = progress.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 0.5, 0], extrapolate: 'clamp' });
    return { active, chosen, offset, style: {
      opacity: Animated.add(Animated.multiply(chosen, selectedOpacity), Animated.multiply(Animated.subtract(1, chosen), siblingOpacity)),
      transform: [{ translateY: Animated.multiply(progress, offset) }],
    } };
  }, []);
  useLayoutEffect(() => {
    motion.chosen.setValue(selected ? 1 : 0);
    motion.offset.setValue(distance);
    // Idle/reduced-motion is an explicit native update through the same graph,
    // independent of the overlay's retained last frame.
    motion.active.setValue(entry && !reducedMotion ? 1 : 0);
  }, [distance, entry, motion, reducedMotion, selected]);
  return (
    <Animated.View ref={rowRef} collapsable={false} style={motion.style}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title || '未命名会话'}，${pinned ? '已置顶，' : ''}${status.label}，更新于 ${relTime(item.updatedAt)}`}
      accessibilityHint={`点击进入这个会话。${pinned ? '长按取消置顶' : '长按置顶'}`}
      onPress={begin}
      onLongPress={() => onTogglePin(item)}
      style={({ pressed }) => [styles.row, pressed && !entry && styles.pressed]}
    >
      <View accessibilityLabel={`任务状态：${status.label}`} style={[styles.dot, { backgroundColor: status.color }]} />
      <View ref={titleRef} collapsable={false} style={{ flex: 1, minWidth: 0 }}><Text onTextLayout={(event) => { titleTextWidth.current = event.nativeEvent.lines[0]?.width ?? 0; }} numberOfLines={1} style={styles.title}>{item.title || '(未命名会话)'}</Text></View>
      {pinned ? <Ionicons accessibilityLabel="已置顶" name="pin" color={colors.mutedForeground} size={14} /> : null}
      <Text variant="muted" style={styles.time}>{relTime(item.updatedAt)}</Text>
    </Pressable>
    </Animated.View>
  );
});

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pressed: { backgroundColor: colors.surface },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { minWidth: 0, fontSize: 15, fontWeight: '600' },
  time: { fontSize: 12 },
});
