const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks = {}, extra = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(`${__dirname}/../src/lib/${file}.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: name => mocks[name], setTimeout, clearTimeout, AbortController, ...extra });
  return exports;
}
const parser = load('app-update-release');
function fixture() {
  const name = 'zcodepocket-1.0.2-32-arm64-v8a.apk';
  return { tag_name: 'v1.0.2', draft: false, prerelease: false, body: '修复', assets: [{ name, state: 'uploaded', size: 100, browser_download_url: `https://github.com/vimalinx/zcodepocket/releases/download/v1.0.2/${name}` }] };
}
test('semantic versions compare numerically and reject ambiguous versions', () => {
  assert.equal(parser.compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(parser.compareVersions('1.0.1', '1.0.1'), 0);
  for (const invalid of ['1.0', '01.0.0', '1.0.0-beta', '999999999999999999.0.0']) assert.throws(() => parser.compareVersions(invalid, '1.0.0'));
});
test('only one uploaded version-matching APK from the exact repository is accepted', () => {
  assert.equal(parser.parseRelease(fixture()).build, 32);
  for (const change of [r => r.draft = true, r => r.prerelease = true, r => r.assets = [], r => r.assets.push(r.assets[0]), r => r.assets[0].browser_download_url += '?redirect=evil', r => r.assets[0].state = 'new', r => r.tag_name = 'v2.0.0']) {
    const release = fixture(); change(release); assert.throws(() => parser.parseRelease(release));
  }
});
function runtime({ status = 200, stored = null } = {}) {
  let requests = 0, listener, removed = false;
  const storage = { getItem: async () => stored, setItem: async () => {} };
  const api = load('app-updates', {
    '@react-native-async-storage/async-storage': storage,
    'expo-application': { nativeApplicationVersion: '1.0.1', nativeBuildVersion: '31' },
    'react-native': { Platform: { OS: 'android' }, AppState: { addEventListener: (_, fn) => { listener = fn; return { remove: () => removed = true }; } } },
    zustand: { create: init => { let state = init(); return { getState: () => state, setState: value => state = { ...state, ...value } }; } },
    './app-update-release': parser,
  }, { fetch: async () => { requests++; return { status, ok: status === 200, json: async () => fixture() }; } });
  return { api, count: () => requests, foreground: () => listener('active'), removed: () => removed };
}
test('deduplicates checks, throttles foreground, supports manual retry and cleans listener', async () => {
  const r = runtime(); const cleanup = r.api.initializeAppUpdates();
  await Promise.all([r.api.checkAppUpdate(), r.api.checkAppUpdate(true)]);
  assert.equal(r.count(), 1); assert.equal(r.api.useAppUpdates.getState().release.build, 32);
  r.foreground(); await r.api.checkAppUpdate(); assert.equal(r.count(), 1);
  await r.api.checkAppUpdate(true); assert.equal(r.count(), 2);
  cleanup(); assert.equal(r.removed(), true);
});
test('rate limit is not reported as up-to-date and automatic failures are throttled', async () => {
  const r = runtime({ status: 403 }); await r.api.checkAppUpdate();
  assert.match(r.api.useAppUpdates.getState().message, /限制/);
  assert.equal(r.api.useAppUpdates.getState().checkedAt, 0);
  await r.api.checkAppUpdate(); assert.equal(r.count(), 1);
});
test('persisted opt-out prevents automatic requests but allows manual check', async () => {
  const r = runtime({ stored: JSON.stringify({ automatic: false }) });
  await r.api.checkAppUpdate(); assert.equal(r.count(), 0);
  await r.api.checkAppUpdate(true); assert.equal(r.count(), 1);
});
test('cached update remains available during restart cooldown', async () => {
  const release = parser.parseRelease(fixture());
  const r = runtime({ stored: JSON.stringify({ automatic: true, nextCheck: Date.now() + 3600000, checkedAt: Date.now(), release }) });
  await r.api.checkAppUpdate();
  assert.equal(r.count(), 0); assert.equal(r.api.useAppUpdates.getState().release.build, 32);
});
test('cached foreign URL is discarded without making it downloadable', async () => {
  const release = { ...parser.parseRelease(fixture()), url: 'https://example.com/evil.apk' };
  const r = runtime({ stored: JSON.stringify({ nextCheck: Date.now() + 3600000, release }) });
  await r.api.checkAppUpdate(); assert.equal(r.api.useAppUpdates.getState().release, null);
});
test('missing release is distinguished from latest version', async () => {
  const r = runtime({ status: 404 }); await r.api.checkAppUpdate();
  assert.match(r.api.useAppUpdates.getState().message, /尚无/);
  assert.equal(r.api.useAppUpdates.getState().release, null);
});
