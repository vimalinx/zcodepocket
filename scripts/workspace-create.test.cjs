const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require(name) { if (!(name in mocks)) throw Error('Unexpected import ' + name); return mocks[name]; } });
  return exports;
}

function harness({ screen = 'sessions', params = {} } = {}) {
  const slots = [], calls = [], pushes = [], resets = []; let cursor = 0, cleanup, focused = false, response;
  const memo = (fn, deps) => {
    const i = cursor++;
    if (!slots[i] || deps.some((v, j) => v !== slots[i].deps[j])) slots[i] = { value: fn(), deps };
    return slots[i].value;
  };
  const state = {
    workspaces: [{ workspaceKey: '/alpha', workspacePath: '/alpha' }, { workspaceKey: '/beta', workspacePath: '/beta' }],
    sessions: [], running: {}, pendingInteractions: [], pinnedSessionIds: [], status: 'online',
    providers: [{ providerId: 'coding-plan', models: [{ modelId: 'glm-5.3-flash' }] }],
    refresh: async () => {}, togglePinnedSession: async () => {},
  };
  const create = load('src/lib/create-session.ts', {
    './remote-client': { remoteClient: { request: async (method, args) => { calls.push({ method, args }); return response ?? { session: { sessionId: 'created', title: 'New' } }; } } },
    './models': load('src/lib/models.ts'),
  });
  const jsx = (type, props) => ({ type, props });
  const react = {
    useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps),
    useRef: initial => memo(() => ({ current: initial }), []),
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }];
    },
    useLayoutEffect(fn, deps) { memo(fn, deps); },
  };
  const navigation = { getState: () => ({ routes: [{ key: 'existing-tabs', name: '(tabs)', state: { routes: [{ name: 'latest' }, { name: 'sessions' }] } }] }), reset: value => resets.push(value) };
  const mocks = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Platform: { OS: 'android' }, Pressable: 'Pressable', View: 'View', ScrollView: 'ScrollView', RefreshControl: 'RefreshControl', StyleSheet: { create: s => s }, useWindowDimensions: () => ({ width: 400, height: 900 }) },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-router': { router: { push: value => pushes.push(value), dismiss() {} }, useNavigation: () => navigation, useLocalSearchParams: () => params,
      useFocusEffect: fn => { if (!focused) { focused = true; cleanup = fn(); } } },
    '@expo/vector-icons/Ionicons': { default: 'Ionicons', __esModule: true },
    '@/components/session/session-entry': { invalidateSessionLayout() {}, useSessionListHandoff: () => ({}) },
    '@/components/session/session-row': { SessionRow: 'SessionRow' }, '@/components/ui/text': { Text: 'Text' }, '@/components/ui/input': { Input: 'Input' },
    '@/lib/theme': { radius: {}, spacing: {}, useTheme: () => ({ colors: {}, isDark: true }), useThemeStyles: fn => fn({}) },
    '@/lib/util': { baseName: value => value.split('/').at(-1) },
    '@/lib/create-session': create, '@/lib/session-routes': load('src/lib/session-routes.ts'), '@/store/app': { useApp: fn => fn(state) },
  };
  const component = load(screen === 'sessions' ? 'src/app/(tabs)/sessions.tsx' : 'src/app/new-session.tsx', mocks).default;
  const render = () => { cursor = 0; return component(); };
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  const find = label => nodes(render()).find(node => node.props?.accessibilityLabel === label);
  return { calls, pushes, resets, state, render, nodes, find, blur: () => cleanup?.(), respond: value => { response = value; } };
}

test('workspace group creates directly in that workspace, without visiting the picker', async () => {
  const h = harness(); h.find('在 beta 新建会话').props.onPress(); await tick();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].method, 'gw.create');
  assert.equal(h.calls[0].args.workspacePath, '/beta');
  assert.equal(h.calls[0].args.model.providerId, 'coding-plan');
  assert.equal(h.pushes.length, 0, 'no new-session picker route');
  assert.equal(h.resets[0].routes[0].key, 'existing-tabs');
  const chat = h.resets[0].routes[1];
  assert.equal(chat.name, 'chat/[id]'); assert.equal(chat.params.id, 'created');
  assert.equal(chat.params.workspacePath, '/beta'); assert.equal(chat.params.returnTo, 'sessions');
});

test('top new-session entry keeps workspace selection and does not create anything', () => {
  const h = harness(); h.find('新建会话').props.onPress();
  assert.equal(h.calls.length, 0); assert.equal(h.pushes[0].pathname, '/new-session');
  assert.equal(h.pushes[0].params.workspace, undefined);
});

test('stale double taps and another group are locked while creation is pending', async () => {
  const h = harness(), gate = deferred(); h.respond(gate.promise);
  const a = h.find('在 alpha 新建会话'), b = h.find('在 beta 新建会话');
  a.props.onPress(); a.props.onPress(); b.props.onPress();
  assert.equal(h.calls.length, 1);
  assert.equal(h.find('在 alpha 新建会话').props.accessibilityState.busy, true);
  assert.equal(h.find('在 beta 新建会话').props.disabled, true);
  assert.equal(h.find('新建会话').props.disabled, true);
  gate.resolve({ session: { sessionId: 'once' } }); await tick();
  assert.equal(h.resets.length, 1);
});

test('unknown creation result is shown without navigating or automatically retrying', async () => {
  const h = harness(); h.respond({}); h.find('在 alpha 新建会话').props.onPress(); await tick();
  assert.equal(h.calls.length, 1); assert.equal(h.resets.length, 0);
  assert.equal(h.find('在 alpha 新建会话').props.disabled, false);
  const error = h.nodes(h.render()).find(node => node.props?.variant === 'destructive');
  assert.match(error.props.children, /刷新列表确认/);
  await tick(); assert.equal(h.calls.length, 1);
});

test('finishing after the user leaves does not pull them into a different conversation', async () => {
  const h = harness(), gate = deferred(); h.respond(gate.promise);
  h.find('在 alpha 新建会话').props.onPress(); h.blur();
  gate.resolve({ session: { sessionId: 'late' } }); await tick();
  assert.equal(h.calls.length, 1); assert.equal(h.resets.length, 0);
});

test('generic picker still requires selection and shares the single-create guard', async () => {
  const h = harness({ screen: 'new' }), gate = deferred(); h.respond(gate.promise);
  assert.equal(h.find('创建会话').props.disabled, true);
  const beta = h.nodes(h.render()).find(node => node.props?.sub === '/beta'); beta.props.onPress();
  const button = h.find('创建会话'); assert.equal(button.props.disabled, false);
  button.props.onPress(); button.props.onPress(); assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].args.workspacePath, '/beta');
  gate.resolve({ session: { sessionId: 'picked' } }); await tick();
  assert.equal(h.resets[0].routes[1].params.id, 'picked');
});
