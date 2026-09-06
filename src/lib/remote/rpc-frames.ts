import { Buffer } from 'buffer';

export const MAX_ENVELOPE = 1024 * 1024;
export const MAX_MESSAGE = 16 * 1024 * 1024;
export type BridgeIdentity = { bridgeSessionId: string; bridgeGeneration?: number; recoveryId?: string };
export type RpcFrame = BridgeIdentity & {
  zcode_type: 'rpc-frame'; seq: number; messageSeq: number;
  fragmentIndex: number; fragmentCount: number; messageBytes: number;
  checksum: { algorithm: 'crc32'; value: string }; dataBase64: string;
};
export type RpcAck = BridgeIdentity & { zcode_type: 'rpc-frame-ack'; ackMessageSeq: number };

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
export function crc32(bytes: Uint8Array): string {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 255] ^ (value >>> 8);
  return ((value ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}
export const envelopeBytes = (payload: unknown) => Buffer.byteLength(JSON.stringify({ type: 'data', payload, client_ts: Number.MAX_SAFE_INTEGER, server_ts: Number.MAX_SAFE_INTEGER }), 'utf8');
export const sameBridge = (a: BridgeIdentity, b: BridgeIdentity) => a.bridgeSessionId === b.bridgeSessionId && a.bridgeGeneration === b.bridgeGeneration && a.recoveryId === b.recoveryId;

export function fragmentRpc(bytes: Uint8Array, identity: BridgeIdentity, messageSeq: number, firstSeq: number): RpcFrame[] {
  if (!bytes.length || bytes.length > MAX_MESSAGE) throw new Error('RPC 消息长度无效');
  const chunkSize = 512 * 1024, count = Math.ceil(bytes.length / chunkSize);
  if (!Number.isSafeInteger(messageSeq) || messageSeq < 1 || !Number.isSafeInteger(firstSeq) || firstSeq < 1 || !Number.isSafeInteger(firstSeq + count)) throw new Error('RPC 序号无效');
  const checksum = { algorithm: 'crc32' as const, value: crc32(bytes) };
  return Array.from({ length: count }, (_, index) => {
    const frame: RpcFrame = { zcode_type: 'rpc-frame', ...identity, seq: firstSeq + index, messageSeq,
      fragmentIndex: index, fragmentCount: count, messageBytes: bytes.length, checksum,
      dataBase64: Buffer.from(bytes.subarray(index * chunkSize, (index + 1) * chunkSize)).toString('base64') };
    if (envelopeBytes(frame) > MAX_ENVELOPE) throw new Error('RPC 分片过大');
    return frame;
  });
}

type Assembly = { first: RpcFrame; started: number; chunks: Uint8Array[]; length: number; seen: Map<number, string> };
export class RpcAssembler {
  private seq = 1;
  private messageSeq = 1;
  private active: Assembly | null = null;
  private settled = new Map<number, string>();
  constructor(readonly identity: BridgeIdentity) {}
  get expiresAt() { return this.active ? this.active.started + 30_000 : null; }
  accept(frame: RpcFrame, now = Date.now()): { bytes?: Uint8Array; ack?: number } | null {
    if (!sameBridge(this.identity, frame)) return null;
    if (this.expiresAt !== null && now >= this.expiresAt) throw new Error('RPC 分片组装超时');
    if (frame.zcode_type !== 'rpc-frame' || ![frame.seq, frame.messageSeq, frame.fragmentCount, frame.messageBytes].every(n => Number.isSafeInteger(n) && n > 0)
      || !Number.isSafeInteger(frame.fragmentIndex) || frame.fragmentIndex < 0 || frame.fragmentIndex >= frame.fragmentCount
      || frame.fragmentCount > 64 || frame.messageBytes > MAX_MESSAGE || frame.fragmentCount > frame.messageBytes
      || frame.checksum?.algorithm !== 'crc32' || !/^[a-f0-9]{8}$/.test(frame.checksum.value)
      || typeof frame.dataBase64 !== 'string' || !frame.dataBase64 || frame.dataBase64.length > MAX_ENVELOPE || envelopeBytes(frame) > MAX_ENVELOPE) throw new Error('RPC 分片元数据无效');
    const bytes = Buffer.from(frame.dataBase64, 'base64');
    if (!bytes.length || bytes.toString('base64') !== frame.dataBase64) throw new Error('RPC 分片编码无效');
    const fingerprint = JSON.stringify([frame.messageSeq, frame.fragmentIndex, frame.fragmentCount, frame.messageBytes, frame.checksum.value, frame.dataBase64]);
    const previous = this.active?.seen.get(frame.seq) ?? this.settled.get(frame.seq);
    if (previous !== undefined && previous !== fingerprint) throw new Error('RPC 重复分片冲突');
    if (frame.seq < this.seq) return this.messageSeq > 1 ? { ack: this.messageSeq - 1 } : {};
    if (frame.seq !== this.seq || frame.messageSeq !== this.messageSeq || frame.fragmentIndex !== (this.active?.chunks.length ?? 0)) throw new Error('RPC 分片序号不连续');
    const active = this.active ?? { first: frame, started: now, chunks: [], length: 0, seen: new Map<number, string>() };
    if (active.first.fragmentCount !== frame.fragmentCount || active.first.messageBytes !== frame.messageBytes || active.first.checksum.value !== frame.checksum.value) throw new Error('RPC 分片元数据冲突');
    if (active.length + bytes.length > frame.messageBytes) throw new Error('RPC 分片长度超限');
    active.chunks.push(bytes); active.length += bytes.length; active.seen.set(frame.seq, fingerprint);
    this.active = active; this.seq++;
    if (active.chunks.length < frame.fragmentCount) return {};
    const result = Buffer.concat(active.chunks, active.length);
    if (active.length !== frame.messageBytes || crc32(result) !== frame.checksum.value) throw new Error('RPC 完整性校验失败');
    this.settled = active.seen; this.active = null; this.messageSeq++;
    return { bytes: result, ack: frame.messageSeq };
  }
}
