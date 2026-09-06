const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { nativeInteraction, nativeEvents } = require('./native-pan-responder.cjs');

function harness({ custom = false, throws = false, native = false, drag, fromLatest = false, available = true, canCapture } = {}) {
  let focusEffect, background, cleanFocus, navigation = 0, timerId = 0;
  const timers = new Map(), animations = [], values = [];
  class Value {
    constructor(value) { this.value = value; this.pending = null; values.push(this); }
    setValue(value) { this.value = value; }
    stopAnimation(callback) {
      const pending = this.pending; this.pending = null;
      pending?.({ finished: false }); callback?.(this.value);
    }
  }
  const react = { useRef: (current) => ({ current }), useMemo: (fn) => fn(), useCallback: (fn) => fn,
    useLayoutEffect: (fn) => fn() };
  const entryState = { entry: null, reducedMotion: false, readyVersion: 0 }, entryListeners = [];
  const entry = { getState: () => entryState, subscribe: fn => { entryListeners.push(fn); return () => {}; } };
  const publishEntry = patch => { Object.assign(entryState, patch); entryListeners.forEach(fn => fn(entryState)); };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/session-navigation.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports,
    setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; }, clearTimeout: (id) => timers.delete(id),
    require: (name) => {
      if (name === 'react') return react;
      if (name === 'expo-router') return { useFocusEffect: (fn) => { focusEffect = fn; cleanFocus = fn(); } };
      if (name === 'zustand') return { create: (init) => init(() => {}) };
      if (name === './gesture-motion') return { settleMotion: () => ({ duration: 300, controlY: 0.2 }) };
      if (name.includes('session-entry')) return { useSessionEntry: entry, resetSessionEntry() { publishEntry({ entry: null }); } };
      if (name === 'react-native') return {
        useWindowDimensions: () => ({ width: 400 }), Keyboard: { dismiss() {} },
        AppState: { addEventListener: (_, fn) => { background = fn; return { remove() {} }; } },
        PanResponder: native ? nativeInteraction('PanResponder') : { create: (handlers) => ({ panHandlers: handlers }) }, Easing: { bezier() {} },
        Animated: { Value, timing: (value, config) => ({ start: (callback) => {
          value.pending = callback;
          animations.push(() => { const cb = value.pending; value.pending = null; if (cb) { value.value = config.toValue; cb({ finished: true }); } });
        } }) },
      };
      throw new Error(name);
    },
  });
  let nav, tree; const pushes = [];
  if (fromLatest) {
    // Render the actual screen and let its actual binding call the production
    // swipe hook. A generic hook-only test cannot catch swapped screen arguments.
    const latest = {}, jsx = (type, props) => ({ type, props });
    const state = { sessions: [{ sessionId: 'last', title: 'Last chat', updatedAt: 1 }], running: {}, pendingInteractions: [], pinnedSessionIds: [], status: 'online' };
    const mocks = {
      react, 'react/jsx-runtime': { jsx, jsxs: jsx },
      'react-native': { Animated: { View: 'AnimatedView' }, FlatList: 'FlatList', Pressable: 'Pressable', View: 'View', RefreshControl: 'RefreshControl', StyleSheet: { create: (v) => v }, useWindowDimensions: () => ({ width: 400, height: 900 }) },
      '@/components/session/session-entry': { beginReopenSessionEntry: () => false, invalidateSessionLayout() {}, moveSessionEntry() {}, releaseReopenSessionEntry() {}, useSessionListHandoff: () => ({}) },
      'expo-router': { router: { push: (href) => { navigation++; pushes.push(href); } } },
      '@/lib/session-navigation': { useSessionNavigation: (select) => select({ current: available ? { id: 'last', title: 'Last chat' } : null }),
        useSessionSwipe: (...args) => (nav = exports.useSessionSwipe(...args)) },
      '@expo/vector-icons': { Ionicons: 'Ionicons' }, '@/components/session/session-row': { SessionRow: 'SessionRow' },
      '@/components/ui/text': { Text: 'Text' },
      '@/lib/theme': { radius: {}, spacing: {}, useTheme: () => ({ colors: {} }) },
      '@/store/app': { useApp: (select) => select(state) },
    };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/app/(tabs)/latest.tsx'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { exports: latest, require: (name) => { if (!(name in mocks)) throw new Error(name); return mocks[name]; } });
    tree = latest.default();
  } else {
    nav = exports.useSessionSwipe(undefined, () => { navigation++; if (throws) throw new Error('route failed'); },
      { rightDrag: drag ?? (custom ? { begin: () => false } : undefined), canCapture });
  }
  const event = (dx, touches = 1, vx = 0.2) => ({ dx, dy: 0, vx, numberActiveTouches: touches });
  return { nav, tree, pushes, handlers: nav.panHandlers, event, animations, value: values[0], count: () => navigation, publishEntry,
    blur: () => cleanFocus(), focus: () => { cleanFocus = focusEffect(); }, background: () => background('background'),
    flushTimers: () => { for (const fn of [...timers.values()]) fn(); } };
}

test('chat right-return hook captures right and never accepts left navigation', () => {
  const h = harness();
  assert.equal(h.handlers.onMoveShouldSetPanResponderCapture(null, h.event(40)), true);
  assert.equal(h.handlers.onMoveShouldSetPanResponderCapture(null, h.event(-40)), false);
});

test('real RN grant resets dx but still starts and completes the captured shared return', () => {
  let began = 0; const moves = [], releases = [];
  const h = harness({ custom: true, native: true, drag: {
    begin: () => { began++; return true; }, move: (dx) => moves.push(dx),
    release: (commit, gesture, done) => { releases.push({ commit, dx: gesture.dx }); done(); },
  } });
  const e = nativeEvents(), p = h.handlers;
  p.onStartShouldSetResponderCapture(e());
  const capture = e(80); assert.equal(p.onMoveShouldSetResponderCapture(capture), true);
  p.onResponderGrant(capture);
  assert.equal(began, 1); assert.equal(moves[0], 0, 'actual RN grant resets dx');
  p.onResponderMove(e(240)); assert.equal(moves.at(-1), 160);
  assert.equal(h.value.value, 0, 'shared return must not slide the whole chat as fallback');
  const up = e(240, 0); p.onResponderEnd(up); p.onResponderRelease(up);
  assert.deepEqual(releases, [{ commit: true, dx: 160 }]);
});
test('real RN short return cancellation accepts a second independent gesture', () => {
  let began = 0; const commits = [];
  const h = harness({ custom: true, native: true, drag: {
    begin: () => { began++; return true; }, move() {}, release: (commit, _, done) => { commits.push(commit); done(); },
  } });
  for (const distance of [12, 160]) {
    const e = nativeEvents(), p = h.handlers;
    p.onStartShouldSetResponderCapture(e());
    const capture = e(80); assert.equal(p.onMoveShouldSetResponderCapture(capture), true);
    p.onResponderGrant(capture); p.onResponderMove(e(80 + distance));
    const up = e(80 + distance, 0); p.onResponderEnd(up); p.onResponderRelease(up);
  }
  assert.equal(began, 2); assert.deepEqual(commits, [false, true]);
});

test('missing shared-row history still follows the finger and completes navigation', () => {
  const h = harness({ custom: true });
  h.handlers.onPanResponderGrant(null, h.event(40)); h.handlers.onPanResponderMove(null, h.event(160));
  assert.equal(h.value.value, 160);
  h.handlers.onPanResponderRelease(null, h.event(160, 0)); h.animations.shift()();
  assert.equal(h.count(), 1);
});

test('short/cancelled drags settle back and immediately accept another gesture', () => {
  const h = harness(); h.handlers.onPanResponderGrant(null, h.event(40));
  h.handlers.onPanResponderMove(null, h.event(8)); h.handlers.onPanResponderRelease(null, h.event(8, 0, -0.2));
  h.animations.shift()(); assert.equal(h.value.value, 0); assert.equal(h.count(), 0);
  assert.equal(h.handlers.onMoveShouldSetPanResponderCapture(null, h.event(40)), true);
});

test('interrupted animations cannot leave a half-translated, locked page', () => {
  const h = harness(); h.handlers.onPanResponderGrant(null, h.event(80));
  h.handlers.onPanResponderRelease(null, h.event(160, 0)); h.value.stopAnimation();
  assert.equal(h.value.value, 0); assert.equal(h.count(), 0);
  assert.equal(h.handlers.onMoveShouldSetPanResponderCapture(null, h.event(40)), true);
});

test('blur invalidates old animation callbacks; returning restores the whole page', () => {
  const h = harness(); h.handlers.onPanResponderGrant(null, h.event(80));
  h.handlers.onPanResponderRelease(null, h.event(160, 0)); h.blur(); h.animations.shift()(); h.focus();
  assert.equal(h.count(), 0); assert.equal(h.value.value, 0);
  assert.equal(h.handlers.onMoveShouldSetPanResponderCapture(null, h.event(40)), true);
});

test('route errors and no-op navigation both recover instead of hanging', () => {
  for (const throws of [false, true]) {
    const h = harness({ throws }); h.nav.right(); h.animations.shift()(); h.flushTimers();
    assert.equal(h.value.value, 0);
    assert.equal(h.handlers.onMoveShouldSetPanResponderCapture(null, h.event(40)), true);
  }
});

test('backgrounding during drag restores the page and unlocks touches', () => {
  const h = harness(); h.handlers.onPanResponderGrant(null, h.event(160)); h.background();
  assert.equal(h.value.value, 0);
  assert.equal(h.handlers.onMoveShouldSetPanResponderCapture(null, h.event(40)), true);
});

test('actual latest list reopens on LEFT swipe with following motion when no fresh row exists', () => {
  const h = harness({ fromLatest: true });
  assert.equal(h.handlers.onMoveShouldSetPanResponderCapture(null, h.event(-40)), true);
  assert.equal(h.handlers.onMoveShouldSetPanResponderCapture(null, h.event(40)), false);
  h.handlers.onPanResponderGrant(null, h.event(-40)); h.handlers.onPanResponderMove(null, h.event(-160));
  assert.equal(h.value.value, -160);
  h.handlers.onPanResponderRelease(null, h.event(-160, 0, -0.8));
  assert.equal(h.count(), 0); h.animations.shift()();
  assert.equal(h.count(), 1); assert.equal(h.value.value, -400);
  h.blur(); h.focus(); assert.equal(h.value.value, 0);
  assert.equal(h.pushes[0].params.id, 'last'); assert.equal(h.pushes[0].params.returnTo, 'latest');
});

test('actual latest left swipe works with native RN grant resetting dx', () => {
  const h = harness({ fromLatest: true, native: true }), e = nativeEvents(), p = h.handlers;
  p.onStartShouldSetResponderCapture(e());
  const capture = e(-80); assert.equal(p.onMoveShouldSetResponderCapture(capture), true);
  p.onResponderGrant(capture); p.onResponderMove(e(-240));
  const up = e(-240, 0); p.onResponderEnd(up); p.onResponderRelease(up);
  h.animations.shift()();
  assert.equal(h.count(), 1); assert.equal(h.value.value, -400); assert.equal(h.pushes[0].params.id, 'last');
});

test('latest return button and row taps retain their distinct targets', () => {
  const buttonCase = harness({ fromLatest: true });
  const button = buttonCase.tree.props.children[0].props.children[0];
  button.props.onPress(); buttonCase.animations.shift()(); assert.equal(buttonCase.pushes[0].params.id, 'last');
  assert.match(button.props.accessibilityHint, /向左滑/);
  const rowCase = harness({ fromLatest: true });
  const list = rowCase.tree.props.children[1];
  const selected = { sessionId: 'selected', title: 'Selected', workspace: { workspacePath: '/project' } };
  list.props.renderItem({ item: selected }).props.onPress(selected);
  assert.equal(rowCase.pushes[0].params.id, 'selected');
});

test('latest with no previous chat cannot capture either direction', () => {
  const h = harness({ fromLatest: true, available: false });
  assert.equal(h.handlers.onMoveShouldSetPanResponderCapture(null, h.event(-40)), false);
  assert.equal(h.handlers.onMoveShouldSetPanResponderCapture(null, h.event(40)), false);
  assert.equal(h.tree.props.children[0].props.children[0], null);
});

test('offscreen source resets only after destination layout, ready for the next return', () => {
  const h = harness({ fromLatest: true });
  h.nav.left(); h.animations.shift()(); assert.equal(h.value.value, -400);
  h.blur(); assert.equal(h.value.value, -400);
  h.publishEntry({ readyVersion: 1 }); assert.equal(h.value.value, 0);
});

test('parent return gesture respects the native settings transition gate', () => {
  let moving = true;
  const h = harness({ canCapture: () => !moving });
  assert.equal(h.handlers.onMoveShouldSetPanResponderCapture(null, h.event(40)), false);
  moving = false;
  assert.equal(h.handlers.onMoveShouldSetPanResponderCapture(null, h.event(40)), true);
});

test('a right swipe can interrupt the incoming chat transition without a second entry', () => {
  const h = harness(); h.publishEntry({ entry: { phase: 'opening' } });
  assert.equal(h.handlers.onMoveShouldSetPanResponderCapture(null, h.event(40)), true);
  h.handlers.onPanResponderGrant(null, h.event(0));
  h.handlers.onPanResponderMove(null, h.event(160));
  h.handlers.onPanResponderRelease(null, h.event(160, 0, 1));
  h.animations.shift()(); assert.equal(h.count(), 1);
});
