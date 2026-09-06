const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const babel = require('@babel/core');

test('native panel callbacks are compiled into UI worklets by the installed production plugin', () => {
  const result = babel.transformFileSync(path.join(__dirname, '../src/lib/session-panel.ts'), {
    babelrc: false, configFile: false,
    presets: [['babel-preset-expo', { jsxRuntime: 'automatic' }]],
    caller: { name: 'metro', platform: 'android', isDev: false, supportsStaticESM: true },
  });
  const code = result.code;
  assert.match(code, /__workletHash/);
  // Every native gesture lifecycle callback, not only an explicit helper, must
  // be workletized; otherwise RNGH would send that phase back through JS.
  const callbacks = ['onTouchesDown', 'onTouchesMove', 'onStart', 'onUpdate', 'onEnd', 'onFinalize'];
  for (const name of callbacks) assert.match(code, new RegExp(name + '[\\s\\S]{0,7000}__workletHash'));
  assert.doesNotMatch(code, /PanResponder|stopAnimation/);
});
