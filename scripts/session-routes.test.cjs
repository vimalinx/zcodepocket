const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { StackRouter, StackActions } = require('../node_modules/expo-router/build/react-navigation/routers/StackRouter.js');
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/session-routes.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: api });

function harness() {
  const router = StackRouter({ initialRouteName: '(tabs)' });
  const options = { routeNames: ['(tabs)', 'chat/[id]', 'session-settings/[id]', 'new-session'], routeParamList: {}, routeGetIdList: {} };
  let state = router.getInitialState(options);
  state.routes[0].state = { index: 0, routes: [{ name: 'latest', key: 'latest-kept' }, { name: 'sessions', key: 'sessions-kept' }] };
  const action = (value) => { state = router.getStateForAction(state, value, options); };
  return { getState: () => state, reset: (next) => {
    action({ type: 'RESET', payload: next }); state = router.getRehydratedState(state, options);
  }, push: (name, params) => action(StackActions.push(name, params)) };
}
const target = { id: 'B', title: 'New', workspacePath: '/project', returnTo: 'sessions' };

test('new and branch replace the entire chat flow, retaining the real tabs route', () => {
  for (const entry of ['new-session', 'session-settings/[id]', null]) {
    const nav = harness(); const key = nav.getState().routes[0].key;
    nav.push('chat/[id]', { id: 'A' }); if (entry) nav.push(entry, { id: 'A' });
    api.replaceWithSession(nav, target);
    const state = nav.getState();
    assert.equal(state.index, 1); assert.equal(state.routes.length, 2);
    assert.equal(state.routes[0].key, key); assert.equal(state.routes[0].state.index, 1);
    assert.equal(state.routes[0].state.routes[1].key, 'sessions-kept');
    assert.equal(state.routes[1].params.id, 'B'); assert.equal(state.routes[1].params.returnTo, 'sessions');
    assert.ok(!state.routes.some(route => route.params?.id === 'A'));
  }
});
test('close removes every old chat and settings route, leaving only its source tab', () => {
  const nav = harness(); nav.push('chat/[id]', { id: 'A' }); nav.push('session-settings/[id]', { id: 'A' });
  api.resetToSessionList(nav, 'sessions');
  assert.equal(nav.getState().routes.length, 1); assert.equal(nav.getState().routes[0].name, '(tabs)');
  assert.equal(nav.getState().routes[0].state.index, 1);
});
test('legacy settings link targets the embedded settings panel with a clean stack', () => {
  const nav = harness(); api.replaceWithSession(nav, target, 'settings');
  assert.equal(nav.getState().routes[1].params.panel, 'settings');
  assert.equal(nav.getState().routes.length, 2);
});
test('unknown source is normalized and new source tabs can be initialized', () => {
  assert.equal(api.sessionList('sessions'), 'sessions'); assert.equal(api.sessionList('bogus'), 'latest');
  let state;
  api.replaceWithSession({ getState: () => undefined, reset: (value) => { state = value; } }, target);
  assert.equal(state.routes[0].state.routes[0].name, 'sessions');
});
