const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createLoader } = require('./remote-test-loader.cjs');
const load = createLoader();
const { parseOfficialLink, relayProof } = load('official-link');
const { encodeRpc, decodeRpc } = load('rpc-codec');
const { crc32, fragmentRpc, RpcAssembler, MAX_ENVELOPE, envelopeBytes } = load('rpc-frames');
const { OfficialRelay } = load('relay');
const { RpcChannel } = load('rpc-channel');
const LINK = 'https://zcode.z.ai/remote/v4?sid=fixture-sid&hash=fixture-not-a-real-credential&t=123&mid=fixture-device';
const ID = { bridgeSessionId: 'fixture-bridge', bridgeGeneration: 1 };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('cancelled bridge ACK arriving after a newer bridge cannot dispose it or publish old view state', async () => {
  let serial = 0, resolveOld; const published = [];
  const relay = new OfficialRelay({ id: () => String(++serial), onState() {} });
  relay.state = 'paired';
  relay.sendPayload = payload => published.push(payload);
  relay.appRequest = async (_type, data) => {
    const response = { bridge: { ...data, workspacePath: data.workspaceKey } };
    if (data.workspaceKey === '/old') return new Promise(resolve => { resolveOld = () => resolve(response); });
    const channel = relay.channels.get(data.bridgeSessionId);
    channel.accept(fragmentRpc(encodeRpc([200], undefined), data, 1, 1)[0]);
    return response;
  };
  const old = new AbortController();
  const result = relay.openBridge('/old', undefined, old.signal);
  const rejected = assert.rejects(result, { name: 'AbortError' });
  await tick(); old.abort(); await rejected;
  const current = await relay.openBridge('/new');
  resolveOld(); await tick();
  assert.equal(relay.channels.size, 1);
  assert.equal(relay.channels.get(current.bridge.bridgeSessionId), current.channel);
  assert.deepEqual(published.filter(p => p.zcode_type === 'mobile-view-state-update').map(p => p.viewState.activeWorkspaceKey), ['/new']);
  relay.disconnect();
});

test('official QR parser rejects alternate origins, userinfo, duplicates and missing authentication parameters', () => {
  assert.equal(parseOfficialLink(LINK).sid, 'fixture-sid');
  for (const value of [LINK.replace('https:', 'http:'), LINK.replace('zcode.z.ai', 'zcode.z.ai.evil.test'), LINK.replace('zcode.z.ai', 'user@zcode.z.ai'), LINK + '&hash=other', LINK.replace('&t=123', ''), LINK.replace('/remote/v4?', '/remote/v4/fake?')]) assert.throws(() => parseOfficialLink(value));
});
test('challenge proof matches standard HMAC-SHA256, never transmits the QR secret', () => {
  const link = parseOfficialLink(LINK);
  assert.equal(relayProof(link, 'nonce-测试'), crypto.createHmac('sha256', link.passHash).update('nonce-测试|terminal|fixture-sid').digest('base64url'));
  assert.notEqual(relayProof(link, 'one'), relayProof(link, 'two'));
});
test('channel serialization matches the wire golden vector and roundtrips Unicode/binary/undefined/int32', () => {
  assert.equal(Buffer.from(encodeRpc([100, 0, 'setting', 'get'], [])).toString('hex'), '040406640600010773657474696e6701036765740400');
  const value = [undefined, -2147483648, 2147483647, 1.5, '中文🙂', new Uint8Array([0, 255]), { nested: new Uint8Array([4, 5]) }, null];
  assert.deepEqual(decodeRpc(encodeRpc([201, 3], value)), { header: [201, 3], body: value });
  assert.throws(() => decodeRpc(Uint8Array.from([4, 255, 255, 255, 255, 127])));
  assert.throws(() => decodeRpc(Buffer.concat([encodeRpc([200], undefined), Buffer.from([0])])));
});
test('RPC frames use CRC32 and reassemble a multi-frame payload below the physical limit', () => {
  assert.equal(crc32(Buffer.from('123456789')), 'cbf43926');
  const data = crypto.randomBytes(1_700_000), frames = fragmentRpc(data, ID, 1, 1), assembler = new RpcAssembler(ID);
  assert.equal(frames.length, 4);
  for (const frame of frames) assert.ok(envelopeBytes(frame) <= MAX_ENVELOPE);
  let result;
  for (const frame of frames) result = assembler.accept(frame);
  assert.deepEqual(Buffer.from(result.bytes), data);
  assert.equal(result.ack, 1);
  assert.deepEqual(assembler.accept(frames[0]), { ack: 1 });
});
test('RPC assembly rejects gaps, corruption, conflicting replay and stale identity without delivery', () => {
  const [frame] = fragmentRpc(Buffer.from('payload'), ID, 1, 1);
  assert.equal(new RpcAssembler(ID).accept({ ...frame, bridgeGeneration: 99 }), null);
  assert.throws(() => new RpcAssembler(ID).accept({ ...frame, seq: 2 }));
  assert.throws(() => new RpcAssembler(ID).accept({ ...frame, checksum: { algorithm: 'crc32', value: '00000000' } }));
  const assembler = new RpcAssembler(ID); assembler.accept(frame);
  assert.throws(() => assembler.accept({ ...frame, dataBase64: Buffer.from('changed').toString('base64') }));
});
test('RPC channel waits for Initialize, routes replies/events, ACKs data, and rejects outstanding work on close', async () => {
  const sent = [], channel = new RpcChannel(ID, frame => sent.push(frame), error => { throw error; });
  try {
    const request = channel.call('setting', 'get');
    assert.equal(sent.length, 0);
    channel.accept(fragmentRpc(encodeRpc([200], undefined), ID, 1, 1)[0]);
    await tick();
    const outgoing = sent.find(frame => frame.zcode_type === 'rpc-frame');
    assert.deepEqual(decodeRpc(Buffer.from(outgoing.dataBase64, 'base64')), { header: [100, 0, 'setting', 'get'], body: [] });
    channel.accept(fragmentRpc(encodeRpc([201, 0], { locale: 'zh-CN' }), ID, 2, 2)[0]);
    assert.deepEqual(await request, { locale: 'zh-CN' });
    let event;
    const stop = await channel.listen('zcode-agent', 'onDynamicConversationFrame', { workspacePath: '/fixture' }, value => { event = value; });
    channel.accept(fragmentRpc(encodeRpc([204, 1], { fixture: true }), ID, 3, 3)[0]);
    assert.deepEqual(event, { fixture: true }); stop();
    const pending = channel.call('setting', 'get'); await tick(); channel.dispose(); await assert.rejects(pending, /未完成请求/);
  } finally { channel.dispose(); }
});
test('official relay performs challenge/bootstrap/bridge RPC, never scans LAN or accepts mere socket-open as ready', async () => {
  let socket, endpoint, serial = 0; const sent = [], states = [];
  const relay = new OfficialRelay({ id: () => String(++serial), onState: state => states.push(state), socket: url => {
    endpoint = url;
    return socket = { readyState: 1, send: text => sent.push(JSON.parse(text)), close() {}, onopen: null, onmessage: null, onerror: null, onclose: null };
  } });
  const receive = message => socket.onmessage({ data: JSON.stringify(message) });
  try {
    let connected = false;
    const connection = relay.connect(LINK).then(value => { connected = true; return value; });
    socket.onopen(); await tick();
    assert.equal(connected, false); assert.equal(relay.state, 'authenticating');
    assert.equal(endpoint, 'wss://zcode.z.ai/ws?mid=fixture-device');
    receive({ type: 'auth_challenge', nonce: 'fixture-nonce' });
    assert.equal(sent.at(-1).type, 'auth_response');
    assert.ok(!JSON.stringify(sent).includes(parseOfficialLink(LINK).passHash));
    receive({ type: 'auth_ack', pair_status: 'matched' }); await tick();
    assert.equal(connected, false);
    const bootstrap = sent.at(-1).payload;
    receive({ type: 'data', payload: { zcode_type: 'bootstrap-response', requestId: bootstrap.requestId, result: { workspaces: [{ workspacePath: '/fixture' }] } } });
    assert.equal((await connection).workspaces.length, 1);
    const opening = relay.openBridge('/fixture'); await tick();
    const open = sent.at(-1).payload;
    const identity = { bridgeSessionId: open.bridgeSessionId, bridgeGeneration: open.bridgeGeneration };
    receive({ type: 'data', payload: fragmentRpc(encodeRpc([200], undefined), identity, 1, 1)[0] });
    receive({ type: 'data', payload: { zcode_type: 'workspace-bridge-ready', bridgeSessionId: open.bridgeSessionId, bridge: { ...identity, workspaceKey: '/fixture', workspacePath: '/fixture' } } });
    assert.equal((await opening).bridge.workspacePath, '/fixture');
    assert.ok(states.includes('paired'));
  } finally { relay.disconnect(); }
});
test('official authentication failure is terminal and never falls back to LAN', async () => {
  let socket, attempts = 0;
  const relay = new OfficialRelay({ id: () => 'fixture', onState() {}, socket: () => { attempts++; return socket = { readyState: 1, send() {}, close() {}, onopen: null, onmessage: null, onerror: null, onclose: null }; } });
  const connection = relay.connect(LINK);
  socket.onopen(); socket.onmessage({ data: JSON.stringify({ type: 'error', code: 'AUTH_FAILED' }) });
  await assert.rejects(connection, /配对已失效/); assert.equal(attempts, 1); assert.equal(relay.state, 'error'); relay.disconnect();
});
