import { Buffer } from 'buffer';
import { crc32 } from './rpc-frames';
import { RpcChannel } from './rpc-channel';

type RecordValue = Record<string, any>;
const MAX_BYTES = 16 * 1024 * 1024;

// A short-lived, read-only V4 subscription supplies revision/logEpoch and row
// identity for CAS commands. Never guess a row or retry a rejected command.
export class SnapshotAssembler {
  private pending?: { id: string; ordinal: number; count: number; bytes: number; checksum: string; chunks: Buffer[]; size: number };
  constructor(private topic: string, private subscriptionId: string) {}

  accept(raw: unknown): RecordValue | null {
    const wire = raw as RecordValue;
    if (!wire || wire.topic !== this.topic || wire.subscriptionId !== this.subscriptionId) return null;
    if (wire.wireVersion !== 3 || !Number.isSafeInteger(wire.logicalFrameOrdinal) || wire.logicalFrameOrdinal < 1 || typeof wire.logicalFrameId !== 'string') throw new Error('官方会话帧格式无效');
    let frame: RecordValue;
    if (wire.kind === 'complete') {
      if (Buffer.byteLength(JSON.stringify(wire.frame) ?? '', 'utf8') > MAX_BYTES) throw new Error('官方会话快照过大');
      frame = wire.frame; this.pending = undefined;
    } else if (wire.kind === 'fragment') {
      if (!Number.isInteger(wire.fragmentCount) || wire.fragmentCount < 1 || wire.fragmentCount > 128 || !Number.isInteger(wire.fragmentIndex) || wire.fragmentIndex < 0 || wire.fragmentIndex >= wire.fragmentCount ||
        !Number.isInteger(wire.logicalBytes) || wire.logicalBytes < 1 || wire.logicalBytes > MAX_BYTES || wire.checksum?.algorithm !== 'crc32' || !/^[0-9a-f]{8}$/.test(wire.checksum.value) || typeof wire.dataBase64 !== 'string' || wire.dataBase64.length > MAX_BYTES * 1.4) throw new Error('官方会话分片格式无效');
      if (wire.fragmentIndex === 0) this.pending = { id: wire.logicalFrameId, ordinal: wire.logicalFrameOrdinal, count: wire.fragmentCount, bytes: wire.logicalBytes, checksum: wire.checksum.value, chunks: [], size: 0 };
      const assembly = this.pending;
      if (!assembly || assembly.id !== wire.logicalFrameId || assembly.ordinal !== wire.logicalFrameOrdinal || assembly.count !== wire.fragmentCount || assembly.bytes !== wire.logicalBytes || assembly.checksum !== wire.checksum.value || assembly.chunks.length !== wire.fragmentIndex) throw new Error('官方会话分片不连续');
      const bytes = Buffer.from(wire.dataBase64, 'base64');
      if (!bytes.length || bytes.toString('base64') !== wire.dataBase64 || assembly.size + bytes.length > assembly.bytes) throw new Error('官方会话分片长度无效');
      assembly.chunks.push(bytes); assembly.size += bytes.length;
      if (assembly.chunks.length !== assembly.count) return null;
      this.pending = undefined;
      const all = Buffer.concat(assembly.chunks);
      if (all.length !== assembly.bytes || crc32(all) !== assembly.checksum) throw new Error('官方会话快照校验失败');
      try { frame = JSON.parse(all.toString('utf8')); } catch { throw new Error('官方会话快照编码无效'); }
    } else throw new Error('未知官方会话帧');
    if (!frame || frame.topic !== this.topic || frame.subscriptionId !== this.subscriptionId) throw new Error('官方会话快照标识不一致');
    if (frame.payload?.kind !== 'snapshot') return null;
    const snapshot = frame.payload.snapshot;
    if (!snapshot || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 || typeof snapshot.logEpoch !== 'string' || !snapshot.logEpoch || !Array.isArray(snapshot.rows?.window)) throw new Error('官方会话快照缺少版本或消息位置');
    return snapshot;
  }
}

export async function captureSnapshot(channel: RpcChannel, scope: RecordValue, sessionId: string): Promise<RecordValue> {
  let subscriptionId: string | undefined, assembler: SnapshotAssembler | undefined, settled = false, stagedBytes = 0;
  const staged: unknown[] = [];
  let resolve!: (snapshot: RecordValue) => void, reject!: (error: Error) => void;
  const snapshot = new Promise<RecordValue>((res, rej) => { resolve = res; reject = rej; });
  void snapshot.catch(() => {});
  const accept = (raw: unknown) => {
    if (settled) return;
    try {
      if (!assembler) {
        stagedBytes += Buffer.byteLength(JSON.stringify(raw) ?? '', 'utf8');
        if (staged.length >= 128 || stagedBytes > MAX_BYTES * 1.5) throw new Error('官方会话初始数据过大');
        staged.push(raw); return;
      }
      const result = assembler.accept(raw);
      if (result) { settled = true; resolve(result); }
    } catch (error) { settled = true; reject(error instanceof Error ? error : new Error('官方会话快照无效')); }
  };
  const remove = await channel.listen('zcode-agent', 'onDynamicConversationFrame', scope, accept);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await channel.call<RecordValue>('zcode-agent', 'subscribeConversationV4', [{ ...scope, sessionId, visibility: 'foreground' }]);
    subscriptionId = response.ack?.subscriptionId;
    if (!subscriptionId) throw new Error('官方会话订阅未确认');
    assembler = new SnapshotAssembler(`conversation/${sessionId}`, subscriptionId);
    for (const frame of staged) accept(frame);
    staged.length = 0;
    timer = setTimeout(() => { settled = true; reject(new Error('读取官方会话快照超时，请重试')); }, 30_000);
    return await snapshot;
  } finally {
    settled = true; clearTimeout(timer); staged.length = 0;
    try { remove(); } catch { /* Connection may already have closed. */ }
    if (subscriptionId) void channel.call('zcode-agent', 'unsubscribeConversationV4', [{ ...scope, subscriptionId }]).catch(() => {});
  }
}

export function findRowTarget(rows: RecordValue[], messageId?: string) {
  const row = messageId
    ? rows.find(row => row.entityId === messageId && row.kind === 'assistantText') ?? rows.find(row => row.entityId === messageId)
      ?? [...rows].reverse().find(row => row.assistantResponseId === messageId && row.kind === 'assistantText')
    : [...rows].reverse().find(row => row.kind === 'assistantText');
  if (!row || !Number.isSafeInteger(row.rowId) || row.rowId < 0 || typeof row.entityId !== 'string' || !row.entityId) return null;
  return { rowId: row.rowId, entityId: row.entityId };
}
