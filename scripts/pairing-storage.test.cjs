const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const { createLoader } = require('./remote-test-loader.cjs');
const link = createLoader()('official-link');
const QR = 'https://zcode.z.ai/remote/v4?sid=fixture&hash=fixture-only&t=1';
const KEY = 'zcpocket.officialPairing.v1', OLD = 'zcpocket.officialRemoteUrl';

function harness({ secure = {}, legacy = {}, failWrite = false } = {}) {
  const secured = new Map(Object.entries(secure)), plain = new Map(Object.entries(legacy)), writes = [];
  const modules = {
    '@react-native-async-storage/async-storage': {
      getItem: async key => plain.get(key) ?? null,
      removeItem: async key => { plain.delete(key); },
      multiRemove: async keys => { for (const key of keys) plain.delete(key); },
    },
    'expo-secure-store': {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
      getItemAsync: async key => secured.get(key) ?? null,
      setItemAsync: async (key, value, options) => { if (failWrite) throw new Error('secure write failed'); writes.push(options); secured.set(key, value); },
      deleteItemAsync: async key => { secured.delete(key); },
    },
    './remote/official-link': link,
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/pairing-storage.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: name => modules[name] });
  return { api: exports, secured, plain, writes };
}

test('legacy official link migrates securely, while obsolete LAN address and token are removed', async () => {
  const h = harness({ legacy: { [OLD]: QR, 'zcpocket.host': 'fixture-lan', 'zcpocket.token': 'fixture-token', 'zcpocket.appearanceMode': 'light' } });
  assert.equal(await h.api.loadPairing(), QR);
  assert.equal(h.secured.get(KEY), QR); assert.equal(h.plain.has(OLD), false);
  assert.equal(h.plain.has('zcpocket.token'), false); assert.equal(h.plain.has('zcpocket.host'), false);
  assert.equal(h.plain.get('zcpocket.appearanceMode'), 'light');
  assert.equal(h.writes[0].keychainAccessible, 'device-only');
});

test('failed secure migration preserves only the official link for retry, never the removed LAN token', async () => {
  const h = harness({ failWrite: true, legacy: { [OLD]: QR, 'zcpocket.token': 'fixture-token' } });
  await assert.rejects(h.api.loadPairing(), /secure write failed/);
  assert.equal(h.plain.get(OLD), QR); assert.equal(h.plain.has('zcpocket.token'), false);
});

test('secure pairing is authoritative and invalid links never trigger a LAN fallback', async () => {
  const h = harness({ secure: { [KEY]: QR }, legacy: { [OLD]: 'obsolete' } });
  assert.equal(await h.api.loadPairing(), QR); assert.equal(h.plain.has(OLD), false);
  await h.api.deletePairing(); assert.equal(h.secured.size, 0);
  const invalid = harness({ legacy: { [OLD]: 'http://fixture.invalid/' } });
  assert.equal(await invalid.api.loadPairing(), null); assert.equal(invalid.plain.size, 0);
});
