import { decodeRpc, encodeRpc } from './rpc-codec';
import { BridgeIdentity, envelopeBytes, fragmentRpc, RpcAck, RpcAssembler, RpcFrame, sameBridge } from './rpc-frames';

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
export class RpcChannel {
  private assembler: RpcAssembler;
  private seq = 1;
  private messageSeq = 1;
  private lastAck = 0;
  private queuedBytes = 0;
  private retained = new Map<number, { bytes: number; at: number }>();
  private requestId = 0;
  private pending = new Map<number, Pending>();
  private events = new Map<number, (value: unknown) => void>();
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private initialized = false;
  private closed = false;
  private watchdog: ReturnType<typeof setInterval>;
  readonly ready: Promise<void>;

  constructor(readonly identity: BridgeIdentity, private send: (payload: RpcFrame | RpcAck) => void, private onFault: (error: Error) => void) {
    this.assembler = new RpcAssembler(identity);
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    // The bridge may fail before its owner awaits ready.
    void this.ready.catch(() => {});
    const started = Date.now();
    this.watchdog = setInterval(() => {
      const now = Date.now(), oldest = this.retained.values().next().value;
      if ((!this.initialized && now - started > 15_000) || (oldest && now - oldest.at > 45_000)
        || (this.assembler.expiresAt !== null && now >= this.assembler.expiresAt)) this.fail(new Error('官方工作区通道响应超时'));
    }, 1000);
  }

  async call<T = unknown>(channel: string, method: string, args: unknown[] = []): Promise<T> {
    await this.ready;
    if (this.closed) throw new Error('官方工作区连接已关闭');
    if (this.pending.size >= 256) throw new Error('等待中的请求过多');
    const id = this.requestId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('请求超时，执行结果尚未确认，请勿重复提交'));
      }, 70_000);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      try { this.write([100, id, channel, method], args); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  async listen(channel: string, event: string, args: unknown, callback: (value: unknown) => void): Promise<() => void> {
    await this.ready;
    if (this.closed) throw new Error('官方工作区连接已关闭');
    const id = this.requestId++;
    this.events.set(id, callback);
    try { this.write([102, id, channel, event], args); }
    catch (error) { this.events.delete(id); throw error; }
    return () => {
      if (!this.events.delete(id) || this.closed) return;
      this.write([103, id], undefined);
    };
  }

  accept(payload: RpcFrame | RpcAck): void {
    if (this.closed || !sameBridge(this.identity, payload)) return;
    try {
      if (payload.zcode_type === 'rpc-frame-ack') {
        const ack = payload.ackMessageSeq;
        if (!Number.isSafeInteger(ack) || ack < 1 || ack >= this.messageSeq) throw new Error('官方 RPC 确认序号无效');
        if (ack <= this.lastAck) return;
        this.lastAck = ack;
        for (const [seq, record] of this.retained) if (seq <= ack) { this.queuedBytes -= record.bytes; this.retained.delete(seq); }
        return;
      }
      const result = this.assembler.accept(payload);
      if (result?.bytes) this.deliver(result.bytes);
      if (result?.ack && !this.closed) this.send({ zcode_type: 'rpc-frame-ack', ...this.identity, ackMessageSeq: result.ack });
    } catch (error) { this.fail(error instanceof Error ? error : new Error('官方 RPC 数据无效')); }
  }

  private deliver(bytes: Uint8Array) {
    const { header, body } = decodeRpc(bytes);
    const [type, id] = header;
    if (type === 200) { this.initialized = true; this.readyResolve(); return; }
    if (!Number.isSafeInteger(id)) throw new Error('官方 RPC 响应标识无效');
    if (type === 204) { this.events.get(id as number)?.(body); return; }
    if (![201, 202, 203].includes(type as number)) throw new Error('未知官方 RPC 响应');
    const pending = this.pending.get(id as number);
    if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(id as number);
    if (type === 201) pending.resolve(body);
    else {
      const detail = body as { message?: unknown; code?: unknown } | null;
      // Do not dump the server object, stack, credentials or request arguments.
      const message = typeof detail?.message === 'string' ? detail.message.slice(0, 300) : '官方工作区拒绝了请求';
      pending.reject(new Error(message));
    }
  }

  private write(header: unknown[], body: unknown) {
    if (this.closed) throw new Error('官方工作区连接已关闭');
    const frames = fragmentRpc(encodeRpc(header, body), this.identity, this.messageSeq, this.seq);
    const bytes = frames.reduce((sum, frame) => sum + envelopeBytes(frame), 0);
    if (this.queuedBytes + bytes > 8 * 1024 * 1024) throw new Error('官方连接繁忙，请等待传输完成');
    this.retained.set(this.messageSeq, { bytes, at: Date.now() }); this.queuedBytes += bytes;
    this.messageSeq++; this.seq += frames.length;
    for (const frame of frames) this.send(frame);
  }

  private fail(error: Error) { if (!this.closed) { this.dispose(error); this.onFault(error); } }
  dispose(error = new Error('连接已断开；未完成请求的结果尚未确认')) {
    if (this.closed) return;
    this.closed = true; clearInterval(this.watchdog); this.readyReject(error);
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.events.clear(); this.retained.clear(); this.queuedBytes = 0;
  }
}
