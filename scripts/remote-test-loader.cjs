const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

// Load the production, platform-independent protocol implementation, not a mock
// copy. Native APIs are injected by its caller.
function createLoader() {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const mod = new Module(file, module);
    cache.set(file, mod);
    const nativeRequire = Module.createRequire(file);
    mod.require = (name) => name.startsWith('.')
      ? load(path.resolve(path.dirname(file), name + (path.extname(name) ? '' : '.ts')))
      : nativeRequire(name);
    mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText, file);
    return mod.exports;
  }
  return name => load(path.join(__dirname, '../src/lib/remote', name + '.ts'));
}
module.exports = { createLoader };
