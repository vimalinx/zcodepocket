const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness() {
  const animations = [], frames = [];
  class Value {
    constructor(value) { this.value = value; }
    setValue(value) { this.value = value; }
    stopAnimation(callback) { callback?.(this.value); }
  }
  const create = (init) => {
    let state = init(); const store = () => state;
    store.getState = () => state; store.setState = (patch) => { state = { ...state, ...patch }; };
    return store;
  };
  const api = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/session/session-entry.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports: api, setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: (callback) => frames.push(callback),
    require: (name) => name === 'zustand' ? { create } : name === 'react-native' ? {
      Animated: { Value, timing: (value, config) => ({ start: (callback) => animations.push(() => { value.value = config.toValue; callback?.({ finished: true }); }) }) },
      Easing: { bezier() {}, inOut() {}, quad: 0 },
    } : name === '@/lib/gesture-motion' ? { settleMotion: () => ({ duration: 300, controlY: 0.2 }) } : {},
  });
  const rect = { x: 0, y: 100, width: 400, height: 56 };
  api.beginSessionEntry({ id: 's', title: 'Test', row: rect, titleRect: rect, source: '/latest', open() {} });
  api.releaseSessionEntry(true); animations.shift()(); api.finishSessionEntry('s'); animations.shift()();
  return { api, animations, frames };
}

test('list progress changes before release and can be dragged back', () => {
  const { api } = harness(); assert.equal(api.beginInteractiveReturn('s'), true);
  api.moveInteractiveReturn(160, 400); assert.equal(api.entryProgress.value, 0.5);
  assert.equal(api.useSessionEntry.getState().entry.phase, 'return-dragging');
  api.moveInteractiveReturn(0, 400); assert.equal(api.entryProgress.value, 1);
});
test('cancel settles to the unchanged chat without navigation', () => {
  const { api, animations } = harness(); let navigation = 0, done = 0;
  api.beginInteractiveReturn('s'); api.moveInteractiveReturn(100, 400);
  api.releaseInteractiveReturn(false, { dx: 100, vx: -1, width: 400 }, () => navigation++, () => done++);
  assert.equal(api.entryProgress.value, 0.6875); animations.shift()();
  assert.equal(api.entryProgress.value, 1); assert.equal(navigation, 0); assert.equal(done, 1);
  assert.equal(api.useSessionEntry.getState().entry, null);
});
test('commit keeps its final frame until the correct source list acknowledges layout', () => {
  const { api, animations } = harness(); let navigation = 0;
  api.beginInteractiveReturn('s'); api.moveInteractiveReturn(200, 400);
  api.releaseInteractiveReturn(true, { dx: 200, vx: 1, width: 400 }, () => navigation++, () => {});
  assert.equal(navigation, 0); animations.shift()(); assert.equal(navigation, 1);
  assert.equal(api.entryProgress.value, 0); assert.equal(api.useSessionEntry.getState().entry.phase, 'return-handoff');
  api.finishInteractiveReturn('/sessions'); assert.notEqual(api.useSessionEntry.getState().entry, null);
  api.finishInteractiveReturn('/latest'); assert.equal(api.useSessionEntry.getState().entry, null); assert.equal(api.entryProgress.value, 0);
});

test('interruption releases the lock exactly once and invalidates stale completion', () => {
  const { api, animations } = harness(); let navigation = 0, done = 0;
  api.beginInteractiveReturn('s'); api.moveInteractiveReturn(200, 400);
  api.releaseInteractiveReturn(true, { dx: 200, vx: 1, width: 400 }, () => navigation++, () => done++);
  api.resetSessionEntry(); animations.shift()();
  assert.equal(navigation, 0); assert.equal(done, 1);
  assert.equal(api.useSessionEntry.getState().entry, null);
});

test('old handoff acknowledgements cannot reset a newly started gesture', () => {
  const { api, animations } = harness(); let done = 0;
  api.beginInteractiveReturn('s'); api.moveInteractiveReturn(200, 400);
  api.releaseInteractiveReturn(true, { dx: 200, vx: 1, width: 400 }, () => {}, () => done++);
  animations.shift()();
  api.resetSessionEntry(); assert.equal(done, 1);
  api.beginInteractiveReturn('s'); api.moveInteractiveReturn(80, 400);
  api.finishInteractiveReturn('/latest');
  assert.equal(api.useSessionEntry.getState().entry.phase, 'return-dragging');
  assert.equal(api.entryProgress.value, 0.75);
});

test('entry starts routing before the animation ends, then waits for real layout', () => {
  const { api, animations } = harness(); let opened = 0;
  api.beginReopenSessionEntry('s', '/latest', () => opened++);
  api.moveSessionEntry(-130, 400); assert.equal(api.entryProgress.value, 0.5);
  api.releaseSessionEntry(true);
  assert.equal(opened, 1, 'network loading starts during motion');
  animations.shift()();
  assert.equal(api.useSessionEntry.getState().entry.phase, 'opening');
  assert.equal(animations.length, 0, 'no opacity handoff before layout');
  api.finishSessionEntry('wrong'); assert.equal(animations.length, 0);
  api.finishSessionEntry('s'); api.finishSessionEntry('s');
  assert.equal(animations.length, 1, 'duplicate layout events do not restart fade');
  animations.shift()(); assert.equal(api.useSessionEntry.getState().entry, null);
});

test('fast cached layout during motion is retained and stale completion cannot reopen', () => {
  const { api, animations } = harness();
  api.beginReopenSessionEntry('s', '/latest', () => {}); api.releaseSessionEntry(true);
  api.finishSessionEntry('s'); assert.equal(animations.length, 1);
  animations.shift()(); assert.equal(animations.length, 1);
  api.resetSessionEntry(); api.beginInteractiveReturn('s');
  animations.shift()(); assert.equal(api.useSessionEntry.getState().entry.phase, 'return-dragging');
});

test('reorder, scroll and resize invalidation forbids old geometry for both directions', () => {
  const { api } = harness();
  api.invalidateSessionLayout('/latest');
  assert.equal(api.beginInteractiveReturn('s', '/latest'), false);
  assert.equal(api.beginReopenSessionEntry('s', '/latest', () => {}), false);
});

test('layout changes during a return cancel it instead of navigating to the old row', () => {
  const { api, animations } = harness(); let navigated = 0, done = 0;
  api.beginInteractiveReturn('s');
  api.releaseInteractiveReturn(true, { dx: 150, vx: 1, width: 400 }, () => navigated++, () => done++);
  api.invalidateSessionLayout('/latest'); animations.shift()();
  assert.equal(navigated, 0); assert.equal(done, 1); assert.equal(api.useSessionEntry.getState().entry, null);
});

test('return button uses the same interactive settlement and layout handoff', () => {
  const { api, animations } = harness(); let navigated = 0;
  api.returnSessionEntry('s', () => navigated++, undefined, '/latest');
  assert.equal(api.useSessionEntry.getState().entry.phase, 'return-settling');
  animations.shift()(); assert.equal(navigated, 1);
  assert.equal(api.useSessionEntry.getState().entry.phase, 'return-handoff');
  api.finishInteractiveReturn('/latest'); assert.equal(api.useSessionEntry.getState().entry, null);
});

test('last row press owns asynchronous measurements', () => {
  const { api } = harness();
  const first = api.reserveEntryMeasurement(), second = api.reserveEntryMeasurement();
  assert.equal(api.isCurrentEntryMeasurement(first), false);
  assert.equal(api.isCurrentEntryMeasurement(second), true);
});

test('a different source tab never reuses old row geometry or overrides navigation', () => {
  const { api } = harness();
  assert.equal(api.beginInteractiveReturn('s', '/sessions'), false);
  let destination;
  api.returnSessionEntry('s', (source) => { destination = source; }, undefined, '/sessions');
  assert.equal(destination, '/sessions');
  assert.equal(api.useSessionEntry.getState().entry, null);
});

test('closing a session invalidates its row and model cache', () => {
  const { api } = harness(); api.sessionEntryModels.set('s', 'model');
  api.forgetSessionEntry('s');
  assert.equal(api.beginInteractiveReturn('s'), false);
  assert.equal(api.sessionEntryModels.has('s'), false);
});
