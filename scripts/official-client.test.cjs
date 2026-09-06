const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./remote-test-loader.cjs');
const { OfficialClient } = createLoader()('client');

const QR = 'https://zcode.z.ai/remote/v4?sid=fixture-device&hash=fixture-proof&t=1';
const workspace = { kind: 'local', workspaceKey: '/shared', workspacePath: '/shared' };

test('unsupported auto mode is rejected locally without a workspace switch or remote write', async () => {
  const h = harness(); await h.client.connect(QR);
  const before = h.calls.length;
  await assert.rejects(h.client.request('session/setMode', { sessionId: 'session', mode: 'auto' }), /不支持/);
  assert.equal(h.calls.length, before);
  h.client.disconnect();
});
function harness() {
  const calls = [], listeners = new Map();
  let options, serial = 0;
  const fake = {
    disconnects: 0,
    async connect() { return { workspaces: [workspace] }; },
    disconnect() { this.disconnects++; },
    async openBridge() { return { bridge: { ...workspace, bridgeSessionId: 'bridge-1' }, channel }; },
  };
  const channel = {
    async call(service, method, args = []) {
      calls.push({ service, method, args });
      if (method === 'helloConversationV4') return { protocolVersion: 3, clientMode: 'web-remote-replayable' };
      if (method === 'initializeConversationV4') return {};
      if (method === 'subscribeControllerV4') return { ack: { subscriptionId: 'controller' } };
      if (method === 'listTaskList') return { items: args[0].kind === 'pinned'
        ? [{ taskId: 'pinned', workspacePath: '/shared', title: 'Pinned', updatedAt: 3 }]
        : [{ taskId: 'session', workspacePath: '/shared', title: 'Example', updatedAt: 2, liveStatus: 'running' },
          { taskId: 'private', workspacePath: '/unshared', title: 'Never expose', updatedAt: 4 }] };
      if (method === 'sendConversationCommandV4') return { status: 'accepted', result: { sessionId: 'created' } };
      if (method === 'readSession') return { messages: [], settings: {} };
      throw new Error('Unexpected official method: ' + method);
    },
    async listen(service, event, arg, listener) { listeners.set(event === 'onDynamicControllerFrame' ? 'controller' : arg?.sessionId, listener); return () => {}; },
    dispose() {},
  };
  const client = new OfficialClient(() => `fixture-id-${++serial}`, (value) => { options = value; return fake; });
  return { client, calls, channel, fake, listeners, state: (state, error) => options.onState(state, error) };
}

test('native list includes official pinned tasks, scopes both queries and rejects unshared workspaces', async () => {
  const h = harness(); await h.client.connect(QR);
  const result = await h.client.request('session/list');
  assert.deepEqual(result.sessions.map(s => s.sessionId), ['pinned', 'session']);
  assert.equal(result.sessions[1].status, 'running');
  for (const call of h.calls.filter(c => c.method === 'listTaskList')) assert.deepEqual(call.args[0].workspaceScopes, [{ workspacePath: '/shared' }]);
  await assert.rejects(h.client.request('session/read', { sessionId: 'private' }), /共享/);
  h.client.disconnect();
});

test('native send and live deltas use official RPC only, with no compatibility selectors on the wire', async () => {
  const h = harness(); await h.client.connect(QR); await h.client.request('session/list');
  const events = []; h.client.onEvent(event => events.push(event));
  await h.client.request('gw.send', { sessionId: 'session', content: 'fixture text' });
  h.listeners.get('session')({ type: 'session.event', event: { type: 'model.streaming', payload: { kind: 'text_delta', delta: 'hello' } } });
  assert.equal(events[0].params.payload.delta, 'hello');
  const sent = h.calls.find(c => c.method === 'sendConversationCommandV4');
  assert.equal(sent.service, 'zcode-agent'); assert.equal(sent.args[0].workspacePath, '/shared');
  assert.equal(sent.args[0].envelope.type, 'sendText'); assert.equal(sent.args[0].envelope.payload.text, 'fixture text');
  assert.ok(h.calls.every(c => !c.method.startsWith('gw.') && !c.method.includes('/')));
  h.client.disconnect();
});

test('unknown send outcome is surfaced once and is never replayed', async () => {
  const h = harness(); await h.client.connect(QR); await h.client.request('session/list');
  let sent = 0; const original = h.channel.call;
  h.channel.call = async (...args) => { if (args[1] === 'sendConversationCommandV4') { sent++; throw new Error('timeout; outcome unknown'); } return original(...args); };
  await assert.rejects(h.client.request('gw.send', { sessionId: 'session', content: 'fixture' }), /unknown/);
  assert.equal(sent, 1); h.client.disconnect();
});

test('new sessions keep the requested default yolo and the official selected workspace', async () => {
  const h = harness(); await h.client.connect(QR);
  const result = await h.client.request('gw.create', { workspacePath: '/shared' });
  assert.equal(result.session.sessionId, 'created');
  const command = h.calls.find(c => c.method === 'sendConversationCommandV4').args[0].envelope;
  assert.equal(command.payload.config.mode, 'yolo'); assert.equal(command.payload.workspaceId, '/shared');
  h.client.disconnect();
});

test('takeover cancels scheduled reconnect and requires explicit re-pairing', async () => {
  const h = harness(); await h.client.connect(QR);
  h.state('offline', new Error('网络暂时断开'));
  assert.ok(h.client.reconnectTimer);
  h.state('offline', new Error('连接已被其他手机接管，请重新配对'));
  assert.equal(h.client.reconnectTimer, undefined); assert.equal(h.client.reconnectAllowed, false);
  h.client.disconnect();
});

test('replayed event sequences are deduplicated and official permission choices retain their exact option ID', async () => {
  const h = harness(); await h.client.connect(QR); await h.client.request('session/subscribe', { sessionId: 'session' });
  const events = [], requests = [], resolved = [];
  h.client.onEvent(event => events.push(event)); h.client.onRequest(event => requests.push(event)); h.client.onInteractionResolved(id => resolved.push(id));
  const receive = h.listeners.get('session');
  const delta = { type: 'session.event', event: { seq: 1, type: 'model.streaming', payload: { delta: 'once' } } };
  receive(delta); receive(delta); assert.equal(events.length, 1);
  receive({ type: 'session.event', event: { seq: 2, type: 'permission.requested', payload: { requestId: 'permission', options: [{ optionId: 'allow-once', label: 'Allow once' }] } } });
  assert.equal(requests[0].method, 'interaction/requestPermission');
  await h.client.request('gw.respondInteraction', { requestId: 'permission', result: { optionId: 'allow-once' } });
  const command = h.calls.find(c => c.method === 'sendConversationCommandV4').args[0].envelope;
  assert.equal(command.type, 'resolveInteraction'); assert.deepEqual(command.payload.answer, { optionId: 'allow-once' });
  assert.deepEqual(resolved, ['permission']); h.client.disconnect();
});

test('retry uses a real temporary official snapshot and its exact CAS revision and row target', async () => {
  const h = harness(); await h.client.connect(QR); await h.client.request('session/list');
  const original = h.channel.call;
  h.channel.call = async (service, method, args) => {
    if (method === 'subscribeConversationV4') {
      h.listeners.get(undefined)({ wireVersion: 3, kind: 'complete', logicalFrameId: 'snapshot', logicalFrameOrdinal: 1, topic: 'conversation/session', subscriptionId: 'sub',
        frame: { topic: 'conversation/session', subscriptionId: 'sub', payload: { kind: 'snapshot', snapshot: { revision: 13, logEpoch: 'epoch', rows: { window: [{ kind: 'assistantText', rowId: 7, entityId: 'row', assistantResponseId: 'reply' }] } } } } });
      return { ack: { subscriptionId: 'sub' } };
    }
    if (method === 'unsubscribeConversationV4') return {};
    return original(service, method, args);
  };
  await h.client.request('gw.retry', { sessionId: 'session', messageId: 'reply' });
  const envelope = h.calls.find(c => c.method === 'sendConversationCommandV4').args[0].envelope;
  assert.equal(envelope.type, 'retryTurn'); assert.equal(envelope.baseRevision, 13); assert.equal(envelope.baseLogEpoch, 'epoch');
  assert.deepEqual(envelope.payload.target, { rowId: 7, entityId: 'row' }); h.client.disconnect();
});

test('usage reads the desktop official app database service, without provider credential or billing calls', async () => {
  const h = harness(); await h.client.connect(QR); const original = h.channel.call;
  h.channel.call = async (service, method, args) => {
    if (method !== 'getAppUsageSnapshot') return original(service, method, args);
    assert.equal(service, 'usage-stats'); assert.ok(['7d', 'all'].includes(args[0].range));
    return { summary: { totalTokens: 100, totalSessions: 2 }, models: [{ modelId: 'fixture-model', requestCount: 3, totalTokens: 100 }], heatmap: { weeks: [{ days: [null, { date: '2026-01-01', totalTokens: 100 }] }] } };
  };
  const usage = await h.client.request('gw.usage');
  assert.equal(usage.stats.requestCount, 3); assert.equal(usage.stats.sessionCount, 2); assert.equal(usage.daily.length, 1);
  h.client.disconnect();
});

test('close delegates to the official task close operation so both session and task list are updated', async () => {
  const h = harness(); await h.client.connect(QR); await h.client.request('session/list'); const original = h.channel.call;
  let closed;
  h.channel.call = async (service, method, args) => { if (method === 'closeTask') { closed = { service, args }; return; } return original(service, method, args); };
  await h.client.request('session/close', { sessionId: 'session' });
  assert.equal(closed.service, 'zcode-task'); assert.equal(closed.args[0].taskId, 'session'); assert.equal(h.client.sessions.has('session'), false);
  h.client.disconnect();
});
