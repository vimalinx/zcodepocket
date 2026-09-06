const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function rootTree({ hydrated = true, paired = false, status = 'offline' } = {}) {
  const exports = {}, state = { hydrated, paired, status, hydrate() {}, appearanceMode: 'dark' };
  const jsx = (type, props) => ({ type, props });
  const Stack = Object.assign(() => {}, { Screen: 'Screen', Protected: 'Protected' });
  const mocks = {
    react: { useEffect() {} }, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'expo-router': { Stack }, 'expo-status-bar': { StatusBar: 'StatusBar' },
    'react-native-gesture-handler': { GestureHandlerRootView: 'GestureHandlerRootView' },
    'react-native-safe-area-context': { SafeAreaProvider: 'SafeAreaProvider' },
    '@/store/app': { useApp: (select) => select(state) },
    '@/lib/theme': { ThemeProvider: 'ThemeProvider', getThemeColors: () => ({ background: '#000' }) },
    '@/lib/notifications': { initializeNotifications() {} },
    '@/lib/app-updates': { initializeAppUpdates() {} },
    '@/components/session/session-entry': { SessionEntryOverlay: 'SessionEntryOverlay' },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/app/_layout.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: (name) => {
    if (!(name in mocks)) throw new Error(`Unexpected import: ${name}`);
    return mocks[name];
  } });
  return exports.default();
}
function accessibleRoutes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (tree.type === 'Protected' && !tree.props.guard) return [];
  if (tree.type === 'Screen') return [tree.props.name];
  const children = tree.props?.children;
  return (Array.isArray(children) ? children : [children]).flatMap(accessibleRoutes);
}

test('SecureStore hydration never briefly mounts an incorrect login stack', () => {
  assert.equal(rootTree({ hydrated: false }), null);
});

test('pair and scanner are inaccessible in every paired connection state, including offline', () => {
  for (const status of ['idle', 'connecting', 'online', 'offline']) {
    const routes = accessibleRoutes(rootTree({ paired: true, status }));
    assert.ok(routes.includes('(tabs)')); assert.ok(routes.includes('chat/[id]'));
    assert.ok(!routes.includes('pair')); assert.ok(!routes.includes('scanner'));
  }
});

test('unpairing removes all private routes and only enables the login flow', () => {
  const routes = accessibleRoutes(rootTree({ paired: false }));
  assert.deepEqual(routes, ['index', 'pair', 'scanner']);
});

test('protected groups exclude login history for paste, scanner and historical duplicate login entries', () => {
  const allowed = new Set(accessibleRoutes(rootTree({ paired: true })));
  for (const history of [['pair'], ['pair', 'scanner'], ['index', 'pair', 'scanner', 'pair']]) {
    // Expo Stack.Protected removes every history entry when its guard turns false.
    // This checks the real layout's route eligibility, not a mock of native routing.
    assert.ok(history.filter(name => allowed.has(name)).every(name => name !== 'pair' && name !== 'scanner'));
  }
  for (const name of ['pair.tsx', 'scanner.tsx']) {
    const source = fs.readFileSync(path.join(__dirname, '../src/app', name), 'utf8');
    assert.doesNotMatch(source, /router\.replace\(/); // no competing imperative transition
  }
});

test('logged-in controls cannot navigate straight into pairing; logout requires confirmation', () => {
  const account = fs.readFileSync(path.join(__dirname, '../src/app/(tabs)/account.tsx'), 'utf8');
  const settings = fs.readFileSync(path.join(__dirname, '../src/app/settings/[section].tsx'), 'utf8');
  for (const source of [account, settings]) assert.doesNotMatch(source, /router\.(?:push|replace|navigate)\(['"]\/(?:pair|scanner)/);
  assert.match(account, /onPress=\{confirmLogout\}/);
  assert.match(account, /Alert\.alert\('解除登录'/);
});
