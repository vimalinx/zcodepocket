// Run installed React Native gesture bookkeeping instead of approximating its
// capture/grant/end ordering in hook tests. No device or app side effects.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const modules = new Map();
function nativeInteraction(name) {
  if (modules.has(name)) return modules.get(name);
  const exports = {};
  const code = babel.transformSync(fs.readFileSync(path.join(__dirname, '../node_modules/react-native/Libraries/Interaction', name + '.js'), 'utf8'), {
    babelrc: false, configFile: false,
    plugins: [[require.resolve('babel-plugin-syntax-hermes-parser'), { parseLangTypes: 'flow' }], require.resolve('@babel/plugin-transform-flow-strip-types'), require.resolve('@babel/plugin-transform-modules-commonjs')],
  }).code;
  vm.runInNewContext(code, { exports, require: (relative) => ({ default: nativeInteraction(relative.slice(2)) }) });
  modules.set(name, exports.default);
  return exports.default;
}
function nativeEvents() {
  let x = 40, time = 1;
  return (nextX = x, touches = 1) => {
    const previousX = x; x = nextX; time += 100;
    return { nativeEvent: { touches: touches ? [{}] : [] }, touchHistory: {
      numberActiveTouches: touches, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: time,
      touchBank: [{ touchActive: !!touches, currentTimeStamp: time, currentPageX: x, previousPageX: previousX, currentPageY: 300, previousPageY: 300 }],
    } };
  };
}
module.exports = { nativeInteraction, nativeEvents };
