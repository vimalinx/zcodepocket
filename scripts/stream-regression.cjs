// Deterministic event replay; no network requests or model calls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');

function harness() {
  const reads = [];
  const gateway = {
    onStatus() {}, onDetail() {}, onEvent() {}, onRequest() {}, onInteractionResolved() {},
    request: () => new Promise((resolve, reject) => reads.push({ resolve, reject })),
  };
  const create = (init) => {
    let state;
    const store = () => state;
    store.getState = () => state;
    store.setState = (update) => { state = { ...state, ...(typeof update === 'function' ? update(state) : update) }; };
    state = init(store.setState, store.getState);
    return store;
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/store/app.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, { exports, setTimeout: () => 1, clearTimeout() {},
    require: (name) => {
      if (name === 'zustand') return { create };
      if (name === '@/lib/remote-client') return { remoteClient: gateway };
      if (name === '@/lib/pairing-storage') return {};
      if (name === '@/lib/notifications') return { notifySessionComplete: async () => {} };
      if (name === '@react-native-async-storage/async-storage') return {};
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const store = exports.useApp;
  return { store, reads, state: store.getState,
    display: () => exports.projectChatMessages(store.getState().chatCache.s?.messages ?? [], !!store.getState().running.s, store.getState().streams.s),
    event: (type, payload = {}) => store.getState().handleEvent({ method: 'session/event', params: { sessionId: 's', type, payload } }),
    messages: () => store.getState().chatCache.s?.messages ?? [],
  };
}
const delta = (h, text, id = 'a') => h.event('model.streaming', { kind: 'text_delta', delta: text, assistantMessageId: id });
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('each delta is visible immediately, even without turn.started', () => {
  const h = harness(); delta(h, '你');
  assert.equal(h.state().streams.s.text, '你'); assert.equal(h.state().running.s, true);
  h.event('turn.started'); delta(h, '好');
  assert.equal(h.state().streams.s.text, '你好');
  h.event('model.streaming', { kind: 'reasoning_delta', delta: '检查中' });
  assert.equal(h.state().streams.s.think, '检查中');
});

test('completion preserves text and key before, during and after history sync', async () => {
  const h = harness(); delta(h, '完整回复'); const key = h.state().streams.s.key;
  h.event('turn.completed');
  assert.equal(h.state().running.s, false); assert.equal(h.messages()[0].text, '完整回复');
  h.state().cacheMessages('s', [{ key: 'a', messageId: 'a', role: 'assistant', text: '完整' }]);
  assert.equal(h.messages()[0].text, '完整回复');
  h.reads[0].resolve({ messages: [{ info: { role: 'assistant', messageId: 'a' }, parts: [{ type: 'text', text: '完整回复' }] }] });
  await tick(); assert.equal(h.messages().length, 1); assert.equal(h.messages()[0].key, key);
  assert.equal(h.messages()[0].pendingFinal, undefined);
  h.state().cacheMessages('s', [{ key: 'a', messageId: 'a', role: 'assistant', text: '完整回复' }]);
  assert.equal(h.messages()[0].key, key);
});

for (const end of ['turn.failed', 'turn.cancelled', 'turn.stopped']) {
  test(`${end} plus failed history fetch retains partial output`, async () => {
    const h = harness(); delta(h, '已收到的内容'); h.event(end);
    h.reads[0].reject(new Error('offline')); await tick();
    assert.equal(h.messages()[0].text, '已收到的内容'); assert.equal(h.state().running.s, false);
  });
}

test('late previous-turn read cannot erase a new local message', async () => {
  const h = harness(); delta(h, '第一轮'); h.event('turn.completed');
  h.event('turn.started'); h.state().appendLocalMessage('s', { key: 'user2', role: 'user', text: '继续', local: true });
  delta(h, '第二轮', 'b'); h.reads[0].resolve({ messages: [] }); await tick();
  assert.equal(h.messages().some((m) => m.key === 'user2'), true);
  assert.equal(h.state().streams.s.text, '第二轮');
});

test('model message boundaries and tool progress are retained', () => {
  const h = harness(); delta(h, '先检查');
  h.event('tool.updated', { kind: 'started', toolCallId: 't', toolName: 'Bash' });
  h.event('tool.updated', { kind: 'progress', toolCallId: 't', stdoutTail: '正在执行' });
  assert.equal(h.state().streams.s.tools[0].output, '正在执行');
  h.event('tool.updated', { kind: 'result', toolCallId: 't', result: { success: true } });
  delta(h, '检查完毕', 'b');
  assert.equal(h.messages()[0].text, '先检查'); assert.equal(h.messages()[0].tools[0].status, 'completed');
  assert.equal(h.state().streams.s.text, '检查完毕');
  h.event('turn.completed'); assert.equal(h.messages().length, 2);
  assert.notEqual(h.messages()[0].key, h.messages()[1].key);
});

test('an old list response cannot hide freshly received deltas', async () => {
  const h = harness(); const refresh = h.state().refresh();
  delta(h, '正在写');
  h.reads[0].resolve({ sessions: [{ sessionId: 's', status: 'idle' }] }); await tick();
  h.reads[1].resolve({ workspaces: [] }); await tick();
  h.reads[2].resolve({ providers: [] }); await refresh;
  assert.equal(h.state().running.s, true);
  assert.equal(h.state().streams.s.text, '正在写');
});

function previousAnswer(h) {
  h.state().cacheMessages('s', [
    { key: 'question', messageId: 'question', role: 'user', text: '问' },
    { key: 'original-row', messageId: 'old-answer', role: 'assistant', text: '原来的很长回答' },
    { key: 'later-question', messageId: 'later-question', role: 'user', text: '后面的消息' },
  ]);
}

test('regeneration replaces the original row in place from waiting through deltas and completion', () => {
  const h = harness(); previousAnswer(h); h.state().beginRegeneration('s', 'old-answer');
  assert.equal(h.display().length, 3); assert.equal(h.display()[1].key, 'original-row'); assert.equal(h.display()[1].text, '');
  h.event('turn.started'); delta(h, '新', 'new-answer'); delta(h, '回答', 'new-answer');
  assert.equal(h.display().length, 3); assert.equal(h.display()[1].key, 'original-row'); assert.equal(h.display()[1].text, '新回答');
  h.event('turn.completed');
  assert.equal(h.messages().length, 3); assert.equal(h.messages()[1].text, '新回答');
  assert.equal(h.messages()[2].key, 'later-question');
});

test('a stale history read cannot resurrect the replaced answer or append the new answer below later messages', () => {
  const h = harness(); previousAnswer(h); const stale = [...h.messages()];
  h.state().beginRegeneration('s', 'old-answer'); delta(h, '新回答', 'new-answer'); h.event('turn.completed');
  h.state().cacheMessages('s', stale);
  assert.equal(h.messages().length, 3); assert.equal(h.messages()[1].text, '新回答');
  h.state().cacheMessages('s', [stale[0], stale[1], { key: 'new-answer', messageId: 'new-answer', role: 'assistant', text: '新回答' }, stale[2]]);
  assert.equal(h.messages().length, 3); assert.equal(h.messages()[1].key, 'original-row'); assert.equal(h.messages()[1].pendingFinal, undefined);
  h.state().cacheMessages('s', [stale[0], stale[1], { key: 'new-answer', messageId: 'new-answer', role: 'assistant', text: '新回答' }, stale[2]]);
  assert.equal(h.messages().length, 3);
  h.state().cacheMessages('s', stale);
  assert.equal(h.messages().length, 3); assert.equal(h.messages()[1].text, '新回答');
});

test('retry failure restores the old answer before output, but preserves a partially regenerated answer', () => {
  const h = harness(); previousAnswer(h);
  h.state().beginRegeneration('s', 'old-answer'); h.state().cancelRegeneration('s');
  assert.equal(h.display().length, 3); assert.equal(h.display()[1].text, '原来的很长回答');
  h.state().beginRegeneration('s', 'old-answer'); delta(h, '部分新回答', 'new-answer'); h.state().cancelRegeneration('s');
  assert.equal(h.display().length, 3); assert.equal(h.display()[1].text, '部分新回答');
});

test('retrying twice keeps one stable row and suppresses both obsolete answer IDs', () => {
  const h = harness(); previousAnswer(h); const original = [...h.messages()];
  h.state().beginRegeneration('s', 'old-answer'); delta(h, '第二版', 'answer-2'); h.event('turn.completed');
  h.state().beginRegeneration('s', 'answer-2'); delta(h, '第三版', 'answer-3'); h.event('turn.completed');
  h.state().cacheMessages('s', [original[0], original[1], { key: 'answer-2', messageId: 'answer-2', role: 'assistant', text: '第二版' }, { key: 'answer-3', messageId: 'answer-3', role: 'assistant', text: '第三版' }, original[2]]);
  assert.equal(h.messages().length, 3); assert.equal(h.messages()[1].key, 'original-row'); assert.equal(h.messages()[1].text, '第三版');
});

test('live history echo and the active stream render as one answer, not two', () => {
  const h = harness(); delta(h, '正在输出', 'answer');
  const key = h.display()[0].key;
  h.state().cacheMessages('s', [{ key: 'answer', messageId: 'answer', role: 'assistant', text: '正在' }]);
  assert.equal(h.display().length, 1); assert.equal(h.display()[0].text, '正在输出');
  assert.equal(h.display()[0].key, key);
  h.event('turn.completed'); assert.equal(h.messages().length, 1);
});

test('same-ID regeneration accepts a shorter new reply without restoring an older longer reply', () => {
  const h = harness(); previousAnswer(h);
  h.state().beginRegeneration('s', 'old-answer'); delta(h, '原来', 'old-answer'); h.event('turn.completed');
  h.state().cacheMessages('s', [{ key: 'old-answer', messageId: 'old-answer', role: 'assistant', text: '原来的很长回答' }]);
  assert.equal(h.messages().length, 1); assert.equal(h.messages()[0].text, '原来');
  h.state().cacheMessages('s', [{ key: 'old-answer', messageId: 'old-answer', role: 'assistant', text: '原来' }]);
  assert.equal(h.messages()[0].pendingFinal, undefined);
});
