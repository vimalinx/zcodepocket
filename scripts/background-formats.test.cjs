const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function harness({ animated = false, failure = '', width = 4000, height = 3000 } = {}) {
  const events = [], exports = {};
  const decoded = { width, height, release: () => events.push('decoded.release') };
  const context = {
    resize: size => events.push(size), release: () => events.push('context.release'),
    renderAsync: async () => {
      if (failure === 'render') throw new Error('bad format');
      return { release: () => events.push('rendered.release'), saveAsync: async options => {
        events.push(options); if (failure === 'save') throw new Error('disk full');
        return { uri: 'file:///cache/normalized.png' };
      } };
    },
  };
  const mocks = {
    'expo-file-system': { File: class { open() { return { readBytes: () => new Uint8Array(8), close() {} }; } }, FileMode: { ReadOnly: 'r' } },
    'expo-crypto': {}, './apng-poster': { isPng: () => false },
    'expo-image': { Image: { loadAsync: async (source, options) => { events.push(source, options); if (failure === 'decode') throw new Error('unsupported'); return decoded; } } },
    'expo-image-manipulator': { SaveFormat: { PNG: 'png' }, ImageManipulator: { manipulate: source => { if (animated && source === decoded) throw new Error('not bitmap'); events.push(typeof source === 'string' ? 'uri-frame' : 'decoded-ref'); return context; } } },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(`${__dirname}/../src/lib/normalize-background-image.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: name => mocks[name] });
  return { normalize: exports.normalizeBackgroundImage, events };
}
test('format-neutral pipeline normalizes decoded sources to a bounded transparent PNG', async () => {
  // These exercise routing and cleanup, not native codec support for real fixtures.
  for (const extension of ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif', 'avif', '']) {
    const h = harness(); assert.equal(await h.normalize(`file:///picker/photo.${extension}`), 'file:///cache/normalized.png');
    assert.ok(h.events.some(e => e?.width === 2048 && e?.height === 1536));
    assert.ok(h.events.some(e => e?.format === 'png'));
    assert.deepEqual(h.events.slice(-3), ['rendered.release', 'context.release', 'decoded.release']);
  }
});
test('animated Drawable falls back to a URI-decoded static frame', async () => {
  const h = harness({ animated: true }); await h.normalize('file:///picker/a.gif');
  assert.ok(h.events.includes('uri-frame'));
});
test('conversion errors reject without hiding failure and release native resources', async () => {
  for (const failure of ['decode', 'render', 'save']) {
    const h = harness({ failure }); await assert.rejects(h.normalize('file:///picker/a.avif'));
    if (failure !== 'decode') assert.ok(h.events.includes('decoded.release'));
    if (failure === 'save') assert.ok(h.events.includes('rendered.release'));
  }
});
test('small images are never enlarged', async () => {
  const h = harness({ width: 120, height: 80 }); await h.normalize('file:///picker/a.png');
  assert.ok(h.events.some(e => e?.width === 120 && e?.height === 80));
});
