const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: (name) => {
    if (!(name in mocks)) throw new Error(`Unexpected import: ${name}`);
    return mocks[name];
  } });
  return exports;
}
const motion = load('../src/lib/session-panel-motion.ts', {});

// Execute the production hook's UI worklets with a controllable animation clock
// and a separate JS queue. This is state/contract coverage, not device FPS proof.
function harness({ settings = false, width = 400, reduced = false, gestureTop = 0, gestureBottom = Infinity } = {}) {
  const slots = [], values = [], animations = [], effects = [], jsQueue = [];
  let cursor = 0, cleanup, focusEffect, background, api, pauseJS = false, entryListener;
  const memo = (fn, deps) => {
    const index = cursor++;
    if (!slots[index] || deps.some((dep, i) => dep !== slots[index].deps[i])) slots[index] = { deps, value: fn() };
    return slots[index].value;
  };
  const effect = (fn, deps) => memo(() => { effects.push(fn); }, deps);
  const react = {
    useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps), useEffect: effect,
    useState: (initial) => {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: initial };
      return [slots[index].value, (value) => { slots[index].value = value; }];
    },
  };
  class Shared {
    constructor(value) { this.value = value; values.push(this); }
    get() { return this.value; }
    set(value) {
      if (value && value.animation) { this.pending = value; value.owner = this; animations.push(value); }
      else this.value = value;
    }
  }
  const reanimated = {
    default: { View: 'AnimatedView' },
    useSharedValue: (initial) => memo(() => new Shared(initial), []),
    useAnimatedStyle: (fn, deps) => memo(() => ({ get current() { return fn(); } }), deps),
    cancelAnimation: (value) => { const pending = value.pending; value.pending = null; pending?.callback(false); },
    Easing: { bezier() {} },
    runOnUI: (fn) => fn,
    runOnJS: (fn) => (...args) => { if (pauseJS) jsQueue.push(() => fn(...args)); else fn(...args); },
    withTiming: (target, config, callback) => ({ animation: true, target, config, callback,
      finish() { if (this.owner.pending !== this) return; this.owner.pending = null; this.owner.value = target; callback(true); },
      advance(value) { if (this.owner.pending === this) this.owner.value = value; },
    }),
  };
  class Pan {
    constructor() { this.handlers = {}; this.config = {}; }
    manualActivation(value) { this.config.manualActivation = value; return this; }
    maxPointers(value) { this.config.maxPointers = value; return this; }
  }
  for (const name of ['onTouchesDown', 'onTouchesMove', 'onStart', 'onUpdate', 'onEnd', 'onFinalize']) {
    Pan.prototype[name] = function(fn) { this.handlers[name] = fn; return this; };
  }
  const gestureHandler = { Gesture: { Pan: () => new Pan() }, GestureDetector: 'GestureDetector' };
  const native = {
    useWindowDimensions: () => ({ width }), Keyboard: { dismiss() {} },
    AppState: { addEventListener: (_, fn) => { background = fn; return { remove() {} }; } },
    View: 'View', StyleSheet: { create: (styles) => styles },
  };
  const entry = { entry: null, reducedMotion: reduced };
  const mod = load('../src/lib/session-panel.ts', {
    react, 'react-native': native, 'react-native-reanimated': reanimated, 'react-native-gesture-handler': gestureHandler,
    'expo-router': { useFocusEffect: (fn) => effect(() => { cleanup?.(); focusEffect = fn; cleanup = fn(); }, [fn]) },
    '@/components/session/session-entry': { useSessionEntry: { getState: () => entry, subscribe: (fn) => { entryListener = fn; return () => {}; } } },
    './session-panel-motion': motion,
  });
  const render = () => { cursor = 0; api = mod.useSessionPanel(settings, gestureTop, gestureBottom); while (effects.length) effects.shift()(); return api; };
  render(); render();
  const jsx = (type, props) => ({ type, props });
  const { SessionPages } = load('../src/components/session/session-pages.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    'react-native-reanimated': reanimated, 'react-native-gesture-handler': gestureHandler,
    '@/lib/theme': { useTheme: () => ({ colors: { background: '#000' } }) },
  });
  const touch = (dx = 0, dy = 0, count = 1) => ({ numberOfTouches: count, allTouches: [{ absoluteX: 200 + dx, absoluteY: 200 + dy }] });
  const capture = (dx, dy = 0, count = 1, start = false) => {
    let accepted = false, failed = false;
    const manager = { fail() { failed = true; }, activate() { if (!failed) { accepted = true; if (start) api.gesture.handlers.onStart(); } } };
    api.gesture.handlers.onTouchesDown(touch(0, 0, count), manager);
    if (!failed) api.gesture.handlers.onTouchesMove(touch(dx, dy, count), manager);
    return accepted;
  };
  return {
    render, animations, progress: values[0], capture,
    get api() { return api; }, get handlers() { return api.gesture.handlers; },
    start: (dx) => { assert.equal(capture(dx, 0, 1, true), true); },
    move: (dx) => api.gesture.handlers.onUpdate({ translationX: dx }),
    end: (dx, velocity = 0) => { api.gesture.handlers.onEnd({ translationX: dx, velocityX: velocity }, true); api.gesture.handlers.onFinalize(); },
    tree: () => SessionPages({ panel: render(), chat: 'REAL_CHAT', settings: 'REAL_SETTINGS' }),
    background: () => background('background'), foreground: () => background('active'),
    blur: () => cleanup(), focus: () => { cleanup = focusEffect(); }, rotate: (w) => { width = w; return render(); },
    setEntry: (value) => { entry.entry = value; entryListener(entry); },
    pauseJS: () => { pauseJS = true; }, flushJS: () => { pauseJS = false; while (jsQueue.length) jsQueue.shift()(); },
  };
}

test('stream rerenders keep the same UI-thread gesture and animated track', () => {
  const h = harness(); const { gesture, trackStyle } = h.api;
  h.start(-30); h.move(-120);
  for (let i = 0; i < 30; i++) { assert.equal(h.render().gesture, gesture); assert.equal(h.api.trackStyle, trackStyle); }
  h.end(-120, -800); h.animations.at(-1).finish();
  assert.equal(h.render().showing, true); assert.equal(h.api.trackStyle, trackStyle);
});

test('both real pages are mounted and share one edge throughout portrait and landscape motion', () => {
  for (const width of [375, 400, 820]) {
    const h = harness({ width }); h.start(-30);
    for (const fraction of [0, 0.05, 0.25, 0.5, 0.75, 1]) {
      h.move(-fraction * width);
      const detector = h.tree(); assert.equal(detector.type, 'GestureDetector');
      const track = detector.props.children.props.children;
      const [chat, settings] = track.props.children;
      assert.equal(chat.props.children, 'REAL_CHAT'); assert.equal(settings.props.children, 'REAL_SETTINGS');
      assert.equal(chat.props.style.width, width); assert.equal(settings.props.style.width, width);
      assert.equal(track.props.style[1].current.transform[0].translateX, -fraction * width);
      assert.equal(settings.props.style.backgroundColor, '#000');
    }
  }
});

test('fast opposite swipe takes over the exact moving position without an endpoint jump or lock', () => {
  const h = harness(); h.start(-30); h.move(-160); h.end(-160, -1800);
  const opening = h.animations.at(-1); opening.advance(0.7);
  h.start(30); assert.equal(h.progress.get(), 0.7);
  h.move(120); assert.ok(Math.abs(h.progress.get() - 0.4) < 1e-8);
  opening.callback(true); assert.ok(Math.abs(h.progress.get() - 0.4) < 1e-8);
  h.end(120, 1800); h.animations.at(-1).finish();
  assert.equal(h.progress.get(), 0); assert.equal(h.render().showing, false);
  assert.equal(h.capture(-40), true); assert.equal(h.capture(40), false);
});

test('UI dragging, settling and hierarchy continue while JS callbacks are delayed', () => {
  const h = harness(); h.pauseJS();
  h.start(-30); h.move(-200); assert.equal(h.progress.get(), 0.5);
  h.end(-200, -1200); h.animations.at(-1).finish(); assert.equal(h.progress.get(), 1);
  assert.equal(h.api.showing, false); // React deliberately has not caught up.
  let returned = 0; h.api.back(() => returned++);
  h.animations.at(-1).finish(); assert.equal(h.progress.get(), 0); assert.equal(returned, 0);
  h.flushJS(); assert.equal(h.render().showing, false);
  h.api.back(() => returned++); assert.equal(returned, 1);
});

test('return is settings -> chat -> list, including repeated back during settling', () => {
  const h = harness({ settings: true }); let returned = 0;
  h.api.back(() => returned++); const old = h.animations.at(-1); old.advance(0.45);
  h.api.back(() => returned++); old.callback(true); assert.equal(returned, 0);
  h.animations.at(-1).finish(); assert.equal(h.progress.get(), 0); assert.equal(returned, 0);
  h.api.back(() => returned++); assert.equal(returned, 1);
});

test('back during opening cancels only settings even before the first animated frame', () => {
  const h = harness(); let returned = 0; h.api.open(); const old = h.animations.at(-1);
  h.api.back(() => returned++); old.callback(true);
  assert.equal(h.progress.get(), 0); assert.equal(h.render().showing, false); assert.equal(returned, 0);
});

test('full-width fast release finishes immediately instead of waiting at a zero-distance endpoint', () => {
  const h = harness(); h.start(-30); h.move(-500); h.end(-500, -2400);
  assert.equal(h.animations.length, 0); assert.equal(h.progress.get(), 1); assert.equal(h.render().transitioning, false);
  h.start(30); h.move(500); h.end(500, 2400);
  assert.equal(h.animations.length, 0); assert.equal(h.progress.get(), 0); assert.equal(h.render().showing, false);
});

test('short drag and reverse flick restore the original page in both directions', () => {
  for (const settings of [false, true]) for (const reverse of [false, true]) {
    const h = harness({ settings }); const sign = settings ? 1 : -1;
    h.start(sign * 30); h.move(sign * (reverse ? 180 : 30));
    h.end(sign * (reverse ? 180 : 30), reverse ? -sign * 1000 : 0); h.animations.at(-1).finish();
    assert.equal(h.progress.get(), settings ? 1 : 0); assert.equal(h.render().showing, settings);
  }
});

test('termination, background, blur and rotation cancel old callbacks and restore complete pages', () => {
  for (const settings of [false, true]) for (const mode of ['terminate', 'background', 'blur', 'rotate']) {
    const h = harness({ settings }); const sign = settings ? 1 : -1;
    h.start(sign * 30); h.move(sign * 160);
    if (mode === 'terminate') { h.handlers.onFinalize(); h.animations.at(-1).finish(); }
    if (mode === 'background') { h.background(); h.foreground(); }
    if (mode === 'blur') { h.blur(); h.focus(); }
    if (mode === 'rotate') h.rotate(820);
    h.move(sign * 250); // stale update must not resurrect a cancelled gesture.
    assert.equal(h.progress.get(), settings ? 1 : 0); assert.equal(h.render().transitioning, false);
  }
});

test('vertical, multitouch, list-return and shared-row entry gestures are not stolen', () => {
  const h = harness();
  assert.equal(h.capture(-40, 80), false); assert.equal(h.capture(-40, 0, 2), false);
  assert.equal(h.capture(40), false); assert.equal(h.capture(-40), true);
  h.setEntry({ phase: 'return-dragging' }); assert.equal(h.capture(-40), false);
  h.api.open(); assert.equal(h.animations.length, 0);
  h.setEntry(null); assert.equal(h.capture(-40), true);
});

test('reduced motion settles directly and settings controls activate only at the endpoint', () => {
  const h = harness({ reduced: true }); h.api.open();
  assert.equal(h.animations.length, 0); assert.equal(h.progress.get(), 1);
  const pages = h.tree().props.children.props.children.props.children;
  assert.equal(pages[0].props.pointerEvents, 'none'); assert.equal(pages[1].props.pointerEvents, 'auto');
  h.api.close(); assert.equal(h.progress.get(), 0); assert.equal(h.render().showing, false);
});

test('panel settling uses remaining distance and release speed without zero-distance delay', () => {
  assert.equal(motion.panelSettleMotion(0).duration, 0);
  assert.ok(motion.panelSettleMotion(20, 2).duration < 150);
  assert.ok(motion.panelSettleMotion(200, 0).duration > motion.panelSettleMotion(200, 2).duration);
  for (const d of [0, 1, 30, 400, 10000, NaN, Infinity]) for (const v of [-2, 0, 3, NaN, Infinity]) {
    const m = motion.panelSettleMotion(d, v);
    assert.ok(m.duration >= 0 && m.duration <= 420); assert.ok(m.controlY >= 0 && m.controlY <= 0.6);
  }
});

test('settings data activation is deferred until movement ends and both back entrypoints share hierarchy', () => {
  const code = fs.readFileSync(path.join(__dirname, '../src/app/chat/[id].tsx'), 'utf8');
  assert.match(code, /active=\{panel\.showing && !panel\.transitioning\}/);
  assert.match(code, /onPress=\{returnToParent\}/);
  assert.match(code, /hardwareBackPress[\s\S]*?returnToParent\(\)/);
});

test('native navigation excludes content below the header', () => {
  const h = harness({ gestureTop: 24, gestureBottom: 136 });
  assert.equal(h.capture(-60), false, 'fixture starts at y=200 in the body');
  let failed = false;
  h.handlers.onTouchesDown({ numberOfTouches: 1, allTouches: [{ absoluteX: 200, absoluteY: 800 }] }, { fail() { failed = true; } });
  assert.equal(failed, true, 'composer touches are not intercepted');
});

test('parent capture checks native page state, including an unfinished settings animation', () => {
  const h = harness();
  assert.equal(h.api.canReturnToList(), true);
  h.api.open(); assert.equal(h.api.canReturnToList(), false);
  h.animations.at(-1).finish(); assert.equal(h.api.canReturnToList(), false);
  h.api.close(); assert.equal(h.api.canReturnToList(), false);
  h.animations.at(-1).finish(); assert.equal(h.api.canReturnToList(), true);
});
