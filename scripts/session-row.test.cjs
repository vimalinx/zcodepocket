const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Render the real row; evaluate its native style at each transition boundary.
function harness() {
  let entry = null, progress = 0, reducedMotion = false;
  const instances = new Map(); let slots, cursor;
  const api = {};
  const jsx = (type, props) => ({ type, props });
  const interpolate = (value, { inputRange: x, outputRange: y }) => {
    let i = 0;
    while (i < x.length - 2 && value > x[i + 1]) i++;
    const t = Math.max(0, Math.min(1, (value - x[i]) / (x[i + 1] - x[i])));
    return y[i] + (y[i + 1] - y[i]) * t;
  };
  class Node {
    constructor(read) { this.read = read; }
    valueOf() { return this.read(); }
    interpolate(config) { return new Node(() => interpolate(Number(this), config)); }
  }
  class Value extends Node {
    constructor(value) { super(() => this.current); this.current = value; }
    setValue(value) { this.current = value; }
  }
  const animated = { View: 'AnimatedView', Value,
    add: (a,b) => new Node(() => Number(a) + Number(b)),
    subtract: (a,b) => new Node(() => Number(a) - Number(b)),
    multiply: (a,b) => new Node(() => Number(a) * Number(b)),
  };
  const useMemo = (f, deps) => {
    const i = cursor++;
    if (!slots[i] || deps.some((d,j) => d !== slots[i].deps[j])) slots[i] = { value: f(), deps };
    return slots[i].value;
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/session/session-row.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports: api, require(name) {
    if (name === 'react') return { memo: (f) => f, useMemo, useLayoutEffect: (f) => f(), useCallback: (f) => f, useEffect() {}, useRef: () => ({ current: null }), useState: (f) => [typeof f === 'function' ? f() : f, () => {}] };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-native') return { Animated: animated, Pressable: 'Pressable', View: 'View', StyleSheet: { create: (s) => s }, useWindowDimensions: () => ({ height: 900 }) };
    if (name === '@/lib/theme') return { useTheme: () => ({ colors: {} }), useThemeStyles: (f) => f({}), spacing: {} };
    if (name === '@/lib/util') return { relTime: () => 'now' };
    if (name === './session-entry') return { useSessionEntry: (selector) => selector({ entry, reducedMotion }), entryProgress: new Node(() => progress) };
    if (name === 'expo-router') throw Error('Rows must not derive their source from the foreground pathname');
    return {};
  } });
  return {
    state(nextEntry, nextProgress, reduced = false) { entry = nextEntry; progress = nextProgress; reducedMotion = reduced; },
    render(id = 'selected', source = '/latest') {
      const key = source + id;
      if (!instances.has(key)) instances.set(key, []);
      slots = instances.get(key); cursor = 0;
      return api.SessionRow({ item: { sessionId: id, title: id }, source, running: false, pending: false, pinned: false, onPress() {}, onTogglePin() {} }).props.style;
    },
  };
}
function visible(style) {
  assert.equal(Number(style.opacity), 1, 'row must explicitly be opaque');
  assert.ok(Number(style.transform[0].translateY) === 0, 'row must explicitly return to its layout position');
}
const entry = (phase) => ({ id: 'selected', source: '/latest', row: { y: 100 }, phase });

test('selected and sibling rows restore native props after entry, cancellation and interruption', () => {
  const h = harness();
  for (const phase of ['settling', 'opening', 'return-dragging', 'return-settling']) {
    h.state(entry(phase), 1);
    assert.equal(Number(h.render().opacity), 0);
    assert.equal(Number(h.render('sibling').opacity), 0);
    h.state(null, 1); // The overlay intentionally retains its last frame.
    visible(h.render()); visible(h.render('sibling'));
  }
});
test('reverse animation restores every row before handoff and keeps them visible after cleanup', () => {
  const h = harness();
  h.state(entry('return-dragging'), 0.5);
  assert.notEqual(Number(h.render('sibling').transform[0].translateY), 0);
  h.state(entry('return-handoff'), 0);
  visible(h.render()); visible(h.render('sibling'));
  h.state(null, 0);
  visible(h.render()); visible(h.render('sibling'));
});
test('hidden tabs keep their source and never animate another list entries', () => {
  const h = harness(); h.state(entry('opening'), 1);
  visible(h.render('selected', '/sessions'));
  visible(h.render('sibling', '/sessions'));
  assert.equal(Number(h.render('selected', '/latest').opacity), 0);
});
test('reduced motion always renders rows in their visible resting state', () => {
  const h = harness(); h.state(entry('return-settling'), 1, true);
  visible(h.render()); visible(h.render('sibling'));
});
test('native opacity and transform nodes stay attached across every phase and cleanup', () => {
  const h = harness(); const idle = h.render('sibling');
  for (const phase of ['dragging', 'settling', 'opening', 'return-dragging', 'return-settling', 'return-handoff']) {
    h.state(entry(phase), 0.75);
    assert.equal(h.render('sibling'), idle, 'must not replace the native props graph');
  }
  h.state(null, 1);
  assert.equal(h.render('sibling'), idle); visible(idle);
  h.state(null, 0.6); visible(idle); // A late overlay update cannot hide idle rows.
});
test('latest list keeps transformed native children attached without disabling virtualization', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/app/(tabs)/latest.tsx'), 'utf8');
  assert.match(source, /removeClippedSubviews=\{false\}/);
  assert.match(source, /windowSize=\{5\}/);
  assert.match(source, /source="\/latest"/);
});
