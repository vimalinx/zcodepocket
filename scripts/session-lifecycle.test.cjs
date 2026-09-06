const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createLoader } = require('./remote-test-loader.cjs');
const load = createLoader();
const { OfficialClient } = load('client');
const cancellation = load('cancellation');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function loader(client) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/load-session.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require(name) {
    if (name === './remote-client') return { remoteClient: client };
    if (name === './remote/cancellation') return cancellation;
    throw Error(name);
  } });
  return exports.loadSession;
}

async function harness() {
  const workspaces = ['home', 'a', 'b', 'c'].map(id => ({ workspaceKey: '/' + id, workspacePath: '/' + id }));
  const calls = [], opens = [], channels = [], resumeGates = new Map(), openGates = new Map();
  let serial = 0, opening = 0, maxOpening = 0;
  const relay = {
    async connect() { return { workspaces }; },
    disconnect() { channels.forEach(c => c.dispose()); },
    async openBridge(key, _taskId, signal) {
      opens.push(key); opening++; maxOpening = Math.max(maxOpening, opening);
      try {
        if (openGates.has(key)) await cancellation.waitForRequest(openGates.get(key).promise, signal);
        cancellation.checkCancelled(signal);
        channels.forEach(c => c.dispose());
        const channel = {
          closed: false,
          dispose() { this.closed = true; },
          async call(service, method, args = []) {
            if (this.closed) throw Error('used disposed channel ' + key);
            calls.push({ key, service, method, session: args[0]?.sessionId });
            if (method === 'helloConversationV4') return { protocolVersion: 3 };
            if (method === 'initializeConversationV4' || method === 'subscribeControllerV4') return {};
            if (method === 'listTaskList') return { items: args[0].kind === 'pinned' ? [] : ['home', 'a', 'b', 'c'].map(id => ({ taskId: id, title: id, workspacePath: '/' + id })) };
            if (method === 'resumeSession') { if (resumeGates.has(args[0].sessionId)) await resumeGates.get(args[0].sessionId).promise; return {}; }
            if (method === 'readSession') return { settings: { mode: 'auto' }, messages: [{ info: { role: 'assistant', messageId: 'm' }, parts: [{ type: 'text', text: 'Actual history' }] }] };
            throw Error('unexpected ' + method);
          },
          async listen(_service, event, args) { calls.push({ key, method: event, session: args?.sessionId }); return () => {}; },
        };
        channels.push(channel);
        return { bridge: { workspaceKey: key, workspacePath: key }, channel };
      } finally { opening--; }
    },
  };
  const client = new OfficialClient(() => String(++serial), () => relay);
  await client.connect('fixture-link'); await client.request('session/list');
  return { client, calls, opens, resumeGates, openGates, loadSession: loader(client), maxOpening: () => maxOpening };
}

test('blur during real client resume lets the new workspace load, with no stale subscribe/read/mode write', async () => {
  const h = await harness(), old = new AbortController(), current = new AbortController();
  const gate = deferred(); h.resumeGates.set('a', gate);
  const a = h.loadSession('a', old.signal); const rejected = assert.rejects(a, { name: 'AbortError' });
  await tick(); old.abort(); await rejected;
  const b = await h.loadSession('b', current.signal);
  gate.resolve(); await tick();
  assert.equal(b.messages[0].parts[0].text, 'Actual history');
  assert.equal(h.client.active.bridge.workspaceKey, '/b');
  assert.equal(h.calls.filter(c => c.session === 'a' && ['onDynamicSessionEvent', 'readSession'].includes(c.method)).length, 0);
  assert.equal(h.calls.filter(c => c.session === 'b' && c.method === 'readSession').length, 1);
  assert.equal(h.calls.filter(c => c.method === 'setMode').length, 0);
  h.client.disconnect();
});

test('cancelled in-flight bridge and queued middle intent cannot steal the newest workspace', async () => {
  const h = await harness(), a = new AbortController(), b = new AbortController(), c = new AbortController();
  const gate = deferred(); h.openGates.set('/a', gate);
  const pa = assert.rejects(h.loadSession('a', a.signal), { name: 'AbortError' });
  await tick();
  const pb = assert.rejects(h.loadSession('b', b.signal), { name: 'AbortError' });
  const pc = h.loadSession('c', c.signal);
  b.abort(); a.abort();
  await Promise.all([pa, pb, pc]); gate.resolve(); await tick();
  assert.equal(h.client.active.bridge.workspaceKey, '/c');
  assert.equal(h.opens.includes('/b'), false, 'cancelled queued intent never opens a bridge');
  assert.equal(h.maxOpening(), 1, 'bridge handshakes stay serialized');
  assert.equal(h.calls.filter(c => ['a', 'b'].includes(c.session)).length, 0);
  h.client.disconnect();
});

test('cancellation at each load boundary sends no following operation and never replays', async () => {
  for (const blocked of ['session/resume', 'session/subscribe', 'session/read']) {
    const signal = new AbortController(), gate = deferred(), calls = [];
    const open = loader({ request: async method => { calls.push(method); if (method === blocked) await gate.promise; return { messages: [] }; } });
    const result = open('s', signal.signal); const rejected = assert.rejects(result, { name: 'AbortError' });
    await tick(); signal.abort(); gate.resolve(); await rejected;
    assert.deepEqual(calls, ['session/resume', 'session/subscribe', 'session/read'].slice(0, ['session/resume', 'session/subscribe', 'session/read'].indexOf(blocked) + 1));
  }
});

test('already blurred load does no work and a failed read does not retry or write mode', async () => {
  const signal = new AbortController(), calls = []; signal.abort();
  const open = loader({ request: async method => { calls.push(method); if (method === 'session/read') throw Error('offline'); return {}; } });
  await assert.rejects(open('s', signal.signal), { name: 'AbortError' }); assert.equal(calls.length, 0);
  await assert.rejects(open('s', new AbortController().signal), /offline/);
  assert.deepEqual(calls, ['session/resume', 'session/subscribe', 'session/read']);
});

test('production chat uses one snapshot, abort cleanup, layout acknowledgements and a separate retry error', () => {
  const code = fs.readFileSync(path.join(__dirname, '../src/app/chat/[id].tsx'), 'utf8');
  assert.match(code, /loadSession\(sessionId, controller.signal\)/);
  assert.match(code, /parseSessionMessages\(detail\)/);
  assert.match(code, /return \(\) => controller.abort\(\)/);
  assert.doesNotMatch(code, /fetchSessionMessages|\bloadedMode\b|session\/setMode\b|key: 'err'/);
  assert.match(code, /onLayout=\{\(\) => markChatLayout\('viewport'\)\}/);
  assert.match(code, /markChatLayout\('content'\)/);
  assert.match(code, /ListFooterComponent=\{openError/);
  assert.match(code, /style=\{styles.header\} \{\.\.\.horizontalNavigation.panHandlers\}/);
  assert.doesNotMatch(code, /<AnimatedSafeAreaView[^>]*panHandlers/);
});
