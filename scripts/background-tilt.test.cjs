const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(`${__dirname}/../src/${file}.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: name => { if (!(name in mocks)) throw new Error(name); return mocks[name]; } });
  return exports;
}
const math = load('lib/background-tilt');
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness({ enabled = true, reduced = false, available = true } = {}) {
  let appChange, motionChange, sample, cleanup, subscriptions = 0, removals = 0;
  const api = load('hooks/use-background-tilt', {
    react: { useCallback: fn => fn },
    'expo-router': { useFocusEffect: fn => { cleanup = fn(); } },
    'react-native': { Platform: { OS: 'android' }, AppState: { currentState: 'active', addEventListener: (_, fn) => { appChange = fn; return { remove() {} }; } }, AccessibilityInfo: { isReduceMotionEnabled: async () => reduced, addEventListener: (_, fn) => { motionChange = fn; return { remove() {} }; } } },
    'expo-sensors': { Accelerometer: { isAvailableAsync: async () => available, setUpdateInterval: value => assert.equal(value, 40), addListener: fn => { subscriptions++; sample = fn; return { remove: () => removals++ }; } } },
    'react-native-reanimated': { useSharedValue: value => ({ value }), withTiming: value => value },
    '@/lib/background-tilt': math,
  });
  const values = api.useBackgroundTilt(enabled);
  return { values, sample: value => sample(value), app: value => appChange(value), reduced: value => motionChange(value), cleanup: () => cleanup(), subscriptions: () => subscriptions, removals: () => removals };
}
test('tilt is calibrated to initial posture, bounded, and ignores non-finite offsets', () => {
  assert.equal(math.tiltOffset({ x: 1, y: 0 }, { x: 1, y: 0 }).x, 0);
  assert.equal(math.tiltOffset({ x: 999, y: -999 }, { x: 0, y: 0 }).x, 1);
  assert.equal(math.tiltOffset({ x: NaN, y: 0 }, { x: 0, y: 0 }).x, 0);
});
test('sensor stops in background, recalibrates on resume, and is removed on screen blur', async () => {
  const h = harness(); await tick(); assert.equal(h.subscriptions(), 1);
  h.sample({ x: 0.2, y: 0.8 }); assert.equal(h.values.x.value, 0);
  h.sample({ x: 0.55, y: 0.8 }); assert.equal(h.values.x.value, 1);
  h.app('background'); assert.equal(h.values.x.value, 0); assert.equal(h.removals(), 1);
  h.app('active'); await tick(); assert.equal(h.subscriptions(), 2);
  h.sample({ x: 0.55, y: 0.8 }); assert.equal(h.values.x.value, 0);
  h.cleanup(); assert.equal(h.removals(), 2);
});
test('disabled, missing sensor and reduced-motion modes never start motion', async () => {
  for (const options of [{ enabled: false }, { reduced: true }, { available: false }]) {
    const h = harness(options); await tick(); assert.equal(h.subscriptions(), 0); h.cleanup();
  }
});
test('live reduced-motion setting stops motion and late async setup cannot survive cleanup', async () => {
  const h = harness(); await tick(); h.reduced(true); assert.equal(h.removals(), 1);
  h.reduced(false); h.cleanup(); await tick(); assert.equal(h.subscriptions(), 1);
});
