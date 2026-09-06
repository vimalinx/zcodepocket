const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./remote-test-loader.cjs');
const load = createLoader();
const { SnapshotAssembler, captureSnapshot, findRowTarget } = load('conversation-snapshot');
const { crc32 } = load('rpc-frames');
const snapshot = { revision: 8, logEpoch: 'fixture-epoch', rows: { window: [{ rowId: 3, entityId: 'row-entity', assistantResponseId: 'message', kind: 'assistantText' }] } };
const frame = { topic: 'conversation/session', subscriptionId: 'subscription', payload: { kind: 'snapshot', snapshot } };
const wire = { wireVersion: 3, kind: 'complete', deliveryKind: 'live', logicalFrameId: 'frame-1', logicalFrameOrdinal: 1, topic: frame.topic, subscriptionId: frame.subscriptionId, frame };

test('snapshot enforces subscription ownership and preserves authoritative CAS version and row identity', () => {
  const assembler = new SnapshotAssembler(frame.topic, frame.subscriptionId);
  assert.equal(assembler.accept({ ...wire, subscriptionId: 'other' }), null);
  assert.deepEqual(assembler.accept(wire), snapshot);
  assert.deepEqual(findRowTarget(snapshot.rows.window, 'message'), { rowId: 3, entityId: 'row-entity' });
  assert.equal(findRowTarget(snapshot.rows.window, 'missing'), null);
});

test('logical snapshot fragments require continuous metadata and valid CRC', () => {
  const bytes = Buffer.from(JSON.stringify(frame)), pieces = [bytes.subarray(0, 80), bytes.subarray(80)];
  const parts = pieces.map((chunk, fragmentIndex) => ({ ...wire, kind: 'fragment', frame: undefined, fragmentIndex, fragmentCount: 2, logicalBytes: bytes.length, checksum: { algorithm: 'crc32', value: crc32(bytes) }, dataBase64: chunk.toString('base64') }));
  const assembler = new SnapshotAssembler(frame.topic, frame.subscriptionId);
  assert.equal(assembler.accept(parts[0]), null); assert.deepEqual(assembler.accept(parts[1]), snapshot);
  assert.throws(() => new SnapshotAssembler(frame.topic, frame.subscriptionId).accept(parts[1]), /不连续/);
  const broken = new SnapshotAssembler(frame.topic, frame.subscriptionId);
  broken.accept(parts[0]); assert.throws(() => broken.accept({ ...parts[1], checksum: { algorithm: 'crc32', value: '00000000' } }), /不连续/);
});

test('snapshot may arrive before subscribe ACK; temporary subscription is always released', async () => {
  let listener, removed = false; const calls = [];
  const channel = {
    async listen(service, event, scope, receive) { listener = receive; return () => { removed = true; }; },
    async call(service, method, args) {
      calls.push({ service, method, args });
      if (method === 'subscribeConversationV4') { listener(wire); return { ack: { subscriptionId: 'subscription' } }; }
      if (method === 'unsubscribeConversationV4') return {};
      throw new Error('Unexpected command');
    },
  };
  assert.deepEqual(await captureSnapshot(channel, { workspacePath: '/shared' }, 'session'), snapshot);
  assert.equal(removed, true);
  assert.equal(calls[1].method, 'unsubscribeConversationV4'); assert.equal(calls[1].args[0].subscriptionId, 'subscription');
});
