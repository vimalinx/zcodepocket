import { Buffer } from 'buffer';
import { OfficialLink, parseOfficialLink, RELAY_URL, relayProof } from './official-link';
import { BridgeIdentity, MAX_ENVELOPE, RpcAck, RpcFrame, sameBridge } from './rpc-frames';
import { RpcChannel } from './rpc-channel';
import { checkCancelled, waitForRequest } from './cancellation';

export type RelayState = 'idle' | 'connecting' | 'authenticating' | 'waiting' | 'paired' | 'offline' | 'error';
export type RemoteWorkspace = { workspaceKey?: string; workspacePath?: string; path?: string; workspaceIdentity?: string; kind?: string; remoteSessionId?: string; [key: string]: unknown };
export type Bootstrap = { workspaces: RemoteWorkspace[]; tasks?: Record<string, unknown>[]; initialViewState?: { activeWorkspaceKey?: string; activeTaskId?: string }; mobileViewState?: { activeWorkspaceKey?: string; activeTaskId?: string } };
export type Bridge = BridgeIdentity & { workspaceKey: string; workspacePath: string; workspaceIdentity?: string; initialTaskId?: string };
type Payload = Record<string, unknown> & { zcode_type: string; requestId?: string };
type AppPending = { expected: string; bridgeSessionId?: string; resolve: (value: Payload) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type SocketLike = Pick<WebSocket, 'readyState' | 'send' | 'close' | 'onopen' | 'onmessage' | 'onclose' | 'onerror'>;

export const workspaceKey = (workspace: RemoteWorkspace) => String(workspace.workspaceIdentity || workspace.workspaceKey || workspace.workspacePath || workspace.path || '');

export class OfficialRelay {
  private socket: SocketLike | null = null;
  private link: OfficialLink | null = null;
  private generation = 0;
  private counter = 0;
  private pending = new Map<string, AppPending>();
  private channels = new Map<string, RpcChannel>();
  private heartbeat?: ReturnType<typeof setInterval>;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private lastAck = 0;
  private pairedResolve?: () => void;
  private pairedReject?: (error: Error) => void;
  state: RelayState = 'idle';

  constructor(private options: {
    socket?: (url: string) => SocketLike;
    onState: (state: RelayState, error?: Error) => void;
    onPayload?: (payload: Payload) => void;
    id: () => string;
  }) {}

  async connect(raw: string): Promise<Bootstrap> {
    const link = parseOfficialLink(raw);
    this.disconnect(); this.link = link;
    const generation = ++this.generation;
    const paired = new Promise<void>((resolve, reject) => { this.pairedResolve = resolve; this.pairedReject = reject; });
    const url = new URL(RELAY_URL);
    if (link.mid) url.searchParams.set('mid', link.mid);
    this.setState('connecting');
    let socket: SocketLike;
    try { socket = (this.options.socket ?? (address => new WebSocket(address)))(url.toString()); }
    catch { this.fail(new Error('无法连接官方中转服务')); await paired; throw new Error('无法连接官方中转服务'); }
    this.socket = socket;
    const current = () => generation === this.generation && this.socket === socket;
    this.connectTimer = setTimeout(() => { if (current()) this.fail(new Error('官方配对超时，请确认电脑已开启远程控制')); }, 30_000);
    socket.onopen = () => {
      if (!current()) return;
      this.setState('authenticating');
      try { this.send({ type: 'auth_init', role: 'terminal', device_sid: link.sid,
        meta: { platform: 'web', version: link.appVersion ?? 'web', name: 'ZCode Pocket' }, client_ts: Date.now() }); }
      catch { this.fail(new Error('官方鉴权发送失败，请检查网络')); }
    };
    socket.onmessage = event => {
      if (!current()) return;
      try {
        if (typeof event.data !== 'string' || Buffer.byteLength(event.data, 'utf8') > MAX_ENVELOPE) throw new Error('官方中转消息格式无效');
        this.receive(JSON.parse(event.data));
      } catch (error) { this.fail(error instanceof Error ? error : new Error('官方中转协议错误')); }
    };
    socket.onerror = () => { if (current()) this.fail(new Error('官方中转连接出错，请检查网络')); };
    socket.onclose = () => { if (current()) this.fail(new Error('官方连接已断开；未完成请求的结果尚未确认')); };
    await paired;
    if (!current()) throw new Error('官方配对已取消');
    const response = await this.appRequest('bootstrap-request', {}, 'bootstrap-response');
    if (!current()) throw new Error('官方配对已取消');
    const result = response.result as Bootstrap | undefined;
    if (!result || !Array.isArray(result.workspaces)) throw new Error('官方电脑未返回有效的工作区列表');
    return result;
  }

  appRequest(type: string, data: Record<string, unknown>, expected: string): Promise<Payload> {
    if (this.state !== 'paired') return Promise.reject(new Error('官方电脑尚未连接'));
    const requestId = `pocket-${++this.counter}-${this.options.id()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('官方电脑响应超时，操作结果尚未确认')); }, 15_000);
      this.pending.set(requestId, { expected, bridgeSessionId: typeof data.bridgeSessionId === 'string' ? data.bridgeSessionId : undefined, resolve, reject, timer });
      try { this.sendPayload({ zcode_type: type, ...data, requestId }); }
      catch (error) { this.pending.delete(requestId); clearTimeout(timer); reject(error); }
    });
  }

  async openBridge(key: string, taskId?: string, signal?: AbortSignal): Promise<{ bridge: Bridge; channel: RpcChannel }> {
    checkCancelled(signal);
    const generation = this.generation;
    const identity: BridgeIdentity = { bridgeSessionId: `pocket-${this.options.id()}`, bridgeGeneration: ++this.counter };
    const channel = new RpcChannel(identity, frame => this.sendPayload(frame), error => this.fail(error));
    // Register before sending: the desktop can initialize RPC before the open ACK.
    this.channels.set(identity.bridgeSessionId, channel);
    try {
      const response = await waitForRequest(this.appRequest('workspace-bridge-open', { ...identity, workspaceKey: key, ...(taskId ? { taskId } : {}) }, 'workspace-bridge-ready'), signal);
      checkCancelled(signal);
      const bridge = response.bridge as Bridge;
      if (!bridge || !sameBridge(identity, bridge) || !bridge.workspacePath || !bridge.workspaceKey) throw new Error('官方工作区握手数据不匹配');
      await waitForRequest(channel.ready, signal);
      checkCancelled(signal);
      if (generation !== this.generation || this.channels.get(identity.bridgeSessionId) !== channel) throw new Error('官方工作区连接已取消');
      for (const [id, previous] of this.channels) if (id !== identity.bridgeSessionId) { previous.dispose(); this.channels.delete(id); }
      this.sendPayload({ zcode_type: 'mobile-view-state-update', viewState: { activeWorkspaceKey: bridge.workspaceKey, ...(taskId ? { activeTaskId: taskId } : {}), updatedAt: Date.now() },
        deviceInfo: { platform: 'web', name: 'ZCode Pocket', version: this.link?.appVersion ?? 'web', updatedAt: Date.now() } });
      return { bridge, channel };
    } catch (error) { channel.dispose(); this.channels.delete(identity.bridgeSessionId); throw error; }
  }

  private receive(message: Record<string, unknown>) {
    switch (message.type) {
      case 'auth_challenge':
        if (!this.link || typeof message.nonce !== 'string' || this.state !== 'authenticating') throw new Error('官方鉴权顺序无效');
        this.send({ type: 'auth_response', device_sid: this.link.sid, proof: relayProof(this.link, message.nonce), client_ts: Date.now() });
        return;
      case 'auth_ack': case 'pair_status_ack': {
        this.lastAck = Date.now();
        if (message.pair_status !== 'matched' && message.pair_status !== 'waiting') throw new Error('官方配对状态无效');
        this.setState(message.pair_status === 'matched' ? 'paired' : 'waiting');
        if (message.pair_status === 'matched') {
          clearTimeout(this.connectTimer); this.connectTimer = undefined;
          this.pairedResolve?.(); this.pairedResolve = undefined; this.pairedReject = undefined;
        }
        this.heartbeat ??= setInterval(() => {
          if (Date.now() - this.lastAck > 30_000) { this.fail(new Error('官方连接心跳超时')); return; }
          try { if (this.link) this.send({ type: 'pair_status_query', device_sid: this.link.sid, client_ts: Date.now() }); }
          catch { this.fail(new Error('官方连接心跳发送失败')); }
        }, 10_000);
        return;
      }
      case 'error': {
        const descriptions: Record<string, string> = { KICKED: '连接已被另一台设备接管，请重新扫码', AUTH_FAILED: '官方配对已失效，请重新扫码', WRONG_PARAM: '官方配对参数无效，请重新扫码', DEVICE_OFFLINE: '电脑 ZCode 已离线，请开启官方远程控制' };
        this.fail(new Error(descriptions[String(message.code)] ?? '官方中转服务暂时不可用'));
        return;
      }
      case 'data': {
        const payload = message.payload as Payload;
        if (!payload || typeof payload !== 'object' || typeof payload.zcode_type !== 'string') throw new Error('官方中转数据无效');
        if (payload.zcode_type === 'rpc-frame' || payload.zcode_type === 'rpc-frame-ack') {
          this.channels.get(String(payload.bridgeSessionId))?.accept(payload as unknown as RpcFrame | RpcAck); return;
        }
        // The official bridge-ready response is matched by bridgeSessionId,
        // unlike app-level replies which echo requestId.
        const matchId = payload.requestId ?? [...this.pending].find(([, value]) => value.bridgeSessionId && value.bridgeSessionId === payload.bridgeSessionId)?.[0];
        const pending = matchId && this.pending.get(matchId);
        if (pending && (payload.zcode_type === pending.expected || payload.zcode_type === 'app-error' || payload.zcode_type === 'workspace-bridge-error')) {
          clearTimeout(pending.timer); this.pending.delete(matchId!);
          if (payload.zcode_type === pending.expected) pending.resolve(payload);
          else pending.reject(new Error('官方电脑拒绝了远程请求，请确认工作区仍然打开'));
          return;
        }
        if (payload.zcode_type === 'bridge-degraded' || payload.zcode_type === 'workspace-bridge-error') {
          if (payload.bridgeSessionId && !this.channels.has(String(payload.bridgeSessionId))) return;
          this.fail(new Error('官方工作区连接已失效')); return;
        }
        this.options.onPayload?.(payload);
      }
    }
  }

  private sendPayload(payload: unknown) {
    if (this.state !== 'paired') throw new Error('官方电脑尚未连接');
    this.send({ type: 'data', payload, client_ts: Date.now() });
  }
  private send(message: unknown) {
    if (!this.socket || this.socket.readyState !== 1) throw new Error('官方中转未连接');
    const text = JSON.stringify(message);
    if (Buffer.byteLength(text, 'utf8') > MAX_ENVELOPE) throw new Error('官方中转消息过大');
    this.socket.send(text);
  }
  private setState(state: RelayState, error?: Error) { this.state = state; this.options.onState(state, error); }
  private fail(error: Error) { this.disconnect(error); this.setState('error', error); }
  disconnect(error = new Error('官方连接已关闭')) {
    this.generation++;
    const socket = this.socket; this.socket = null; this.link = null;
    clearTimeout(this.connectTimer); clearInterval(this.heartbeat); this.connectTimer = undefined; this.heartbeat = undefined;
    this.pairedReject?.(error); this.pairedReject = undefined; this.pairedResolve = undefined;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    for (const channel of this.channels.values()) channel.dispose(error);
    this.channels.clear(); socket?.close(); this.setState('idle');
  }
}
