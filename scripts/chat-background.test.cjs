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
  }).outputText, { exports, setTimeout: () => 1, clearTimeout() {}, require: (name) => {
    if (!(name in mocks)) throw new Error(`Unexpected import: ${name}`);
    return mocks[name];
  } });
  return exports;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness({ normalize = false } = {}) {
  const document = 'file:///documents/', old = document + 'zcpocket-chat-background.jpg';
  const files = new Map([[old, 'OLD'], ['file:///picker/a.jpg', 'A'], ['file:///picker/b.jpg', 'B']]);
  const writes = [], deletions = [], decoded = []; let uuid = 0, failWrite = false, failCopy = false, failDelete = false, failDecode = false, emptyCopy = false, pending;
  const create = (init) => {
    let state;
    const store = select => select(state);
    store.getState = () => state;
    store.setState = update => { state = { ...state, ...(typeof update === 'function' ? update(state) : update) }; };
    state = init(store.setState, store.getState);
    return store;
  };
  let persisted;
  const storage = { async setItem(key, value) {
    writes.push(JSON.parse(value));
    if (pending) { const current = pending; pending = null; await current.promise; }
    if (failWrite) throw new Error('storage full');
    persisted = JSON.parse(value);
  } };
  const storeModule = load('../src/store/app.ts', {
    zustand: { create }, '@react-native-async-storage/async-storage': storage,
    '@/lib/remote-client': { remoteClient: { onStatus() {}, onDetail() {}, onEvent() {}, onRequest() {}, onInteractionResolved() {} } },
    '@/lib/pairing-storage': {}, '@/lib/notifications': { notifySessionComplete() {} },
  });
  const store = storeModule.useApp;
  store.setState({ chatBackground: { ...store.getState().chatBackground, uri: old } });
  persisted = { ...store.getState().chatBackground };
  class File {
    constructor(root, name) { this.uri = name ? root.uri + name : root; }
    get extension() { return path.extname(this.uri); }
    get exists() { return files.has(this.uri); }
    get size() { return files.get(this.uri)?.length ?? 0; }
    async copy(to) {
      if (files.has(to.uri)) throw new Error('must never overwrite an existing image');
      files.set(to.uri, emptyCopy ? '' : files.get(this.uri));
      if (failCopy) throw new Error('copy failed');
    }
    delete() {
      if (failDelete) throw new Error('cleanup failed');
      deletions.push({ uri: this.uri, persistedUri: persisted.uri, shownUri: store.getState().chatBackground.uri });
      files.delete(this.uri);
    }
  }
  const api = load('../src/lib/chat-background-files.ts', {
    './normalize-background-image': { normalizeBackgroundImage: async uri => {
      if (!normalize) return uri;
      const normalized = 'file:///cache/converted.png'; files.set(normalized, files.get(uri)); return normalized;
    } },
    'expo-crypto': { randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}` },
    'expo-image': { Image: { async loadAsync({ uri }) {
      decoded.push(uri);
      if (failDecode) throw new Error('unsupported format');
      return { width: 100, height: 100, release() {} };
    } } },
    'expo-file-system': { File, Paths: { document: { uri: document }, cache: { uri: 'file:///cache/' } } }, '@/store/app': storeModule,
  });
  return {
    ...api, store, files, writes, deletions, decoded, old, document,
    state: () => store.getState().chatBackground, persisted: () => persisted,
    failWrite: value => { failWrite = value; }, failCopy: value => { failCopy = value; }, failDelete: value => { failDelete = value; },
    failDecode: value => { failDecode = value; }, emptyCopy: value => { emptyCopy = value; },
    holdNextWrite() { let resolve; const promise = new Promise(r => { resolve = r; }); pending = { promise }; return resolve; },
  };
}

test('two JPEG selections get different source identities and display the new bytes', async () => {
  const h = harness();
  await h.changeBackgroundImage('file:///picker/a.jpg'); const a = h.state().uri;
  assert.notEqual(a, h.old); assert.equal(h.files.get(a), 'A');
  await h.changeBackgroundImage('file:///picker/b.jpg'); const b = h.state().uri;
  assert.notEqual(b, a); assert.equal(h.files.get(b), 'B'); assert.equal(h.persisted().uri, b);
  assert.equal(h.files.has(a), false); assert.equal(h.files.has(h.old), false);
  assert.equal(h.files.get('file:///picker/a.jpg'), 'A'); assert.equal(h.files.get('file:///picker/b.jpg'), 'B');
  for (const deletion of h.deletions) { assert.notEqual(deletion.uri, deletion.persistedUri); assert.notEqual(deletion.uri, deletion.shownUri); }
});

test('converted PNG is durably copied and converter cache is cleaned without touching picker source', async () => {
  for (const fails of [false, true]) {
    const h = harness({ normalize: true }); h.failWrite(fails);
    if (fails) await assert.rejects(h.changeBackgroundImage('file:///picker/a.jpg'));
    else { await h.changeBackgroundImage('file:///picker/a.jpg'); assert.match(h.state().uri, /\.png$/); assert.equal(h.files.get(h.state().uri), 'A'); }
    assert.equal(h.files.has('file:///cache/converted.png'), false);
    assert.equal(h.files.get('file:///picker/a.jpg'), 'A');
  }
});

test('old image remains displayed and intact until the new URI is durably saved', async () => {
  const h = harness(), release = h.holdNextWrite();
  const changing = h.changeBackgroundImage('file:///picker/a.jpg'); await tick();
  assert.equal(h.state().uri, h.old); assert.equal(h.files.get(h.old), 'OLD'); assert.equal(h.deletions.length, 0);
  release(); await changing;
  assert.notEqual(h.state().uri, h.old); assert.equal(h.files.has(h.old), false);
});

test('empty copies and decoder rejection never commit or delete the old background', async () => {
  for (const failure of ['emptyCopy', 'failDecode']) {
    const h = harness(); h[failure](true);
    await assert.rejects(h.changeBackgroundImage('file:///picker/a.jpg'), /原背景未更改/);
    assert.equal(h.state().uri, h.old); assert.equal(h.persisted().uri, h.old);
    assert.equal(h.files.get(h.old), 'OLD'); assert.equal(h.writes.length, 0);
    assert.equal([...h.files.keys()].filter(uri => uri.startsWith(h.document)).length, 1);
    h[failure](false); await h.changeBackgroundImage('file:///picker/b.jpg');
    assert.equal(h.decoded.at(-1), h.state().uri); assert.equal(h.files.get(h.state().uri), 'B');
  }
});

test('copy or storage failure preserves the old background and removes only the failed new copy', async () => {
  for (const failure of ['failCopy', 'failWrite']) {
    const h = harness(); h[failure](true);
    await assert.rejects(h.changeBackgroundImage('file:///picker/a.jpg'));
    assert.equal(h.state().uri, h.old); assert.equal(h.persisted().uri, h.old); assert.equal(h.files.get(h.old), 'OLD');
    assert.equal([...h.files.keys()].filter(uri => uri.startsWith(h.document)).length, 1);
    h[failure](false); await h.changeBackgroundImage('file:///picker/b.jpg');
    assert.equal(h.files.get(h.state().uri), 'B');
  }
});

test('concurrent replacements and slider changes cannot restore an earlier URI or lose settings', async () => {
  const h = harness(), release = h.holdNextWrite();
  const first = h.changeBackgroundImage('file:///picker/a.jpg'); await tick();
  const slider = h.store.getState().setChatBackground({ brightness: 1.2 });
  const second = h.changeBackgroundImage('file:///picker/b.jpg');
  release(); await Promise.all([first, slider, second]);
  assert.equal(h.files.get(h.state().uri), 'B'); assert.equal(h.state().brightness, 1.2);
  assert.deepEqual(h.persisted(), JSON.parse(JSON.stringify(h.state())));
  assert.equal([...h.files.keys()].filter(uri => uri.startsWith(h.document)).length, 1);
});

test('failed removal keeps the current image, successful reset persists defaults before cleanup', async () => {
  const h = harness(); h.failWrite(true);
  await assert.rejects(h.changeBackgroundImage(null));
  assert.equal(h.state().uri, h.old); assert.equal(h.files.has(h.old), true);
  h.failWrite(false); await h.changeBackgroundImage(null, true);
  assert.equal(h.state().uri, null); assert.equal(h.persisted().uri, null); assert.equal(h.files.has(h.old), false);
  assert.equal(h.deletions[0].persistedUri, null);
});

test('cleanup is strictly limited to app-owned background files and cannot break a committed change', async () => {
  for (const uri of ['file:///documents/personal.jpg', 'file:///documents/sub/zcpocket-chat-background.jpg', 'file:///documents/../zcpocket-chat-background.jpg', 'file:///elsewhere/zcpocket-chat-background.jpg']) {
    const h = harness(); h.files.set(uri, 'PRIVATE'); h.store.setState({ chatBackground: { ...h.state(), uri } });
    await h.changeBackgroundImage('file:///picker/a.jpg'); assert.equal(h.files.get(uri), 'PRIVATE');
  }
  const h = harness(); h.failDelete(true);
  await h.changeBackgroundImage('file:///picker/a.jpg'); assert.equal(h.files.get(h.state().uri), 'A');
});

test('background controls use the replacement helper and serialize picker/removal/reset actions', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/components/settings/appearance-settings.tsx'), 'utf8');
  assert.match(source, /changeBackgroundImage\(result\.assets\[0\]\.uri\)/);
  assert.match(source, /if \(choosingLock\.current\) return/);
  assert.match(source, /!result\.canceled && result\.assets\[0\]/);
  assert.doesNotMatch(source, /overwrite: true|new ExpoFile/);
  assert.match(source, /label="移除图片"[^\n]*disabled=\{choosing\}/);
  assert.match(source, /label="恢复默认背景设置"[^\n]*disabled=\{choosing\}/);
});

test('render failures are visible and each replacement has a fresh native image identity', () => {
  const background = fs.readFileSync(path.join(__dirname, '../src/components/chat/chat-background.tsx'), 'utf8');
  const appearance = fs.readFileSync(path.join(__dirname, '../src/components/settings/appearance-settings.tsx'), 'utf8');
  assert.match(background, /key=\{background\.uri\}/);
  assert.match(background, /onError=\{\(\) => onLoadError/);
  assert.match(background, /transition=\{0\}/);
  assert.match(appearance, /onLoadError=\{setFailedImageUri\}/);
  assert.match(appearance, /failedImageUri === chatBackground\.uri/);
  assert.match(appearance, /accessibilityLiveRegion="polite"/);
});
