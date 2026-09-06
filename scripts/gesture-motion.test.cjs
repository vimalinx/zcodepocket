const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/gesture-motion.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: api });

test('slow release takes longer than a flick over the same distance', () => {
  assert.ok(api.settleMotion(200, 0.1).duration > api.settleMotion(200, 2).duration);
});
test('remaining distance affects settling time', () => {
  assert.ok(api.settleMotion(250, 1).duration > api.settleMotion(30, 1).duration);
});
test('touch velocity sets easing slope, resting taps start smoothly', () => {
  assert.equal(api.settleMotion(200).controlY, 0);
  assert.ok(api.settleMotion(200, 1).controlY > 0);
  assert.equal(api.settleMotion(200, -1).controlY, 0);
});
test('extreme or invalid values cannot produce instant or unbounded animations', () => {
  for (const distance of [0, 1, 100, 10000, NaN, Infinity]) {
    for (const speed of [-2, 0, 0.5, 1000, NaN, Infinity]) {
      const result = api.settleMotion(distance, speed);
      assert.ok(result.duration >= 220 && result.duration <= 520);
      assert.ok(result.controlY >= 0 && result.controlY <= 0.6);
    }
  }
});
