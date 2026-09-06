import { Buffer } from 'buffer';
import { sha256 } from '@noble/hashes/sha2.js';
import { Bridge, Bootstrap, OfficialRelay, RemoteWorkspace, workspaceKey } from './relay';
import { RpcChannel } from './rpc-channel';
import { captureSnapshot, findRowTarget } from './conversation-snapshot';
import { checkCancelled, waitForRequest } from './cancellation';

export type EngineEvent = { method: string; params: Record<string, unknown> };
export type EngineRequest = { id: string; method: string; params: Record<string, unknown> };
export type ConnectionStatus = 'idle' | 'connecting' | 'online' | 'offline';
type RecordValue = Record<string, any>; // Runtime RPC objects are validated at their use sites.
type ActiveBridge = { bridge: Bridge; channel: RpcChannel };

// UI compatibility lives entirely on the PHONE. No gw.* operation crosses the
// network: each is translated into the official desktop channel service below.
export class OfficialClient {
  private relay: OfficialRelay;
  private bootstrap: Bootstrap = { workspaces: [] };
  private active: ActiveBridge | null = null;
  private switching: Promise<ActiveBridge> | null = null;
  private sessions = new Map<string, RecordValue>();
  private subscriptions = new Map<string, Promise<void>>();
  private interactions = new Map<string, { sessionId: string; request: RecordValue }>();
  private eventSequences = new Map<string, number>();
  private eventListeners = new Set<(event: EngineEvent) => void>();
  private requestListeners = new Set<(event: EngineRequest) => void>();
  private resolvedListeners = new Set<(id: string) => void>();
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private detailListeners = new Set<(detail: string) => void>();
  private rawLink: string | null = null;
  private generation = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempt = 0;
  private reconnectAllowed = false;
  private clientId: string;
  status: ConnectionStatus = 'idle';
  detail = '未配对';

  constructor(private id: () => string, relayFactory?: (options: ConstructorParameters<typeof OfficialRelay>[0]) => OfficialRelay) {
    this.clientId = `pocket-${id()}`;
    const options: ConstructorParameters<typeof OfficialRelay>[0] = {
      id,
      onState: (state, error) => {
        const labels: Record<string, string> = { idle: '未连接', connecting: '正在连接官方中转…', authenticating: '正在验证官方二维码…', waiting: '等待电脑 ZCode 配对…', paired: '已配对，正在连接工作区…' };
        this.setDetail(error?.message ?? (state === 'paired' && this.status === 'online' ? '已连接官方公网' : labels[state]) ?? '连接已断开');
        if (error) {
          this.active = null; this.subscriptions.clear(); this.setStatus('offline');
          // Kicked/expired QR needs human re-pairing, never a reconnect takeover loop.
          if (/接管|配对已失效|参数无效/.test(error.message)) { this.reconnectAllowed = false; clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }
          else this.scheduleReconnect();
        } else if (state === 'waiting' && this.status === 'online') {
          this.active = null; this.subscriptions.clear(); this.setStatus('offline'); this.scheduleReconnect();
        }
      },
      onPayload: payload => {
        if (payload.zcode_type === 'workspace-list-updated' && payload.result && typeof payload.result === 'object') {
          const result = payload.result as Bootstrap;
          if (Array.isArray(result.workspaces)) this.bootstrap = result;
        }
      },
    };
    this.relay = relayFactory ? relayFactory(options) : new OfficialRelay(options);
  }

  async connect(raw: string): Promise<void> {
    this.disconnect();
    this.rawLink = raw;
    const generation = ++this.generation;
    try { await this.establish(generation); this.reconnectAllowed = true; }
    catch (error) {
      if (generation === this.generation) {
        this.relay.disconnect(); this.setDetail(error instanceof Error ? error.message : '官方连接失败，请重试'); this.setStatus('offline');
      }
      throw error;
    }
  }
  private async establish(generation: number) {
    this.setStatus('connecting');
    const result = await this.relay.connect(this.rawLink!);
    if (generation !== this.generation) throw new Error('配对已取消');
    this.bootstrap = result;
    const preferred = result.mobileViewState?.activeWorkspaceKey ?? result.initialViewState?.activeWorkspaceKey;
    const workspace = result.workspaces.find(item => workspaceKey(item) === preferred) ?? result.workspaces.find(item => item.kind !== 'remote' || (item.workspaceIdentity && item.remoteSessionId));
    if (!workspace) throw new Error('电脑没有可远程访问的已打开工作区');
    await this.ensureBridge(workspaceKey(workspace));
    if (generation !== this.generation) throw new Error('配对已取消');
    this.reconnectAttempt = 0; this.setDetail('已连接官方公网'); this.setStatus('online');
  }
  disconnect() {
    this.generation++; this.reconnectAllowed = false; clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined;
    this.rawLink = null; this.active = null; this.switching = null; this.subscriptions.clear(); this.sessions.clear(); this.interactions.clear(); this.eventSequences.clear();
    this.bootstrap = { workspaces: [] }; this.relay.disconnect(); this.setStatus('idle');
  }
  private scheduleReconnect() {
    if (!this.reconnectAllowed || !this.rawLink || this.reconnectTimer) return;
    const generation = this.generation;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (generation !== this.generation || !this.rawLink) return;
      this.active = null; this.switching = null; this.subscriptions.clear();
      void this.establish(generation).catch(() => { if (generation === this.generation) { this.setStatus('offline'); this.scheduleReconnect(); } });
    }, Math.min(15_000, 1000 * 2 ** this.reconnectAttempt++));
  }

  private async ensureBridge(key?: string, signal?: AbortSignal): Promise<ActiveBridge> {
    const generation = this.generation;
    const check = () => {
      checkCancelled(signal);
      if (generation !== this.generation) throw new Error('连接已取消');
    };
    check();
    // Recheck the lock after every await: several queued callers can wake in
    // the same microtask turn. A rejected/obsolete switch must not poison them.
    while (this.switching) {
      try { await this.switching; } catch { /* Each caller validates its own lifetime. */ }
      check();
    }
    const target = key || this.active?.bridge.workspaceKey || workspaceKey(this.bootstrap.workspaces[0] ?? {});
    if (this.active?.bridge.workspaceKey === target) return this.active;
    if (!this.bootstrap.workspaces.some(item => workspaceKey(item) === target || item.workspacePath === target || item.path === target)) throw new Error('只能访问电脑官方远程已共享的工作区');
    const workspace = this.bootstrap.workspaces.find(item => workspaceKey(item) === target || item.workspacePath === target || item.path === target)!;
    if (this.active?.bridge.workspaceKey === workspaceKey(workspace)) return this.active;
    const switching = (async () => {
      const connection = await this.relay.openBridge(workspaceKey(workspace), undefined, signal);
      if (generation === this.generation) { this.active = null; this.subscriptions.clear(); }
      try {
        check();
        const hello = await waitForRequest(connection.channel.call<RecordValue>('zcode-agent', 'helloConversationV4'), signal);
        check();
        if (hello.protocolVersion !== 3) throw new Error('当前官方协议版本尚不兼容');
        await waitForRequest(connection.channel.call('zcode-agent', 'initializeConversationV4', [{ kind: 'clientHello', protocolVersion: 3, clientId: this.clientId,
          clientKind: hello.clientMode === 'desktop-continuous' ? 'desktop' : 'web', appVersion: 'ZCode Pocket', capabilities: { workspaceHookReviewUi: false } }]), signal);
        check();
        this.active = connection; this.subscriptions.clear();
        void this.observeTaskList(connection).catch(() => { /* Manual refresh remains available when the optional index observer is unavailable. */ });
        return connection;
      } catch (error) { connection.channel.dispose(); throw error; }
    })();
    this.switching = switching;
    try { return await switching; } finally { if (this.switching === switching) this.switching = null; }
  }
  private scope(connection: ActiveBridge) {
    return { workspacePath: connection.bridge.workspacePath, ...(connection.bridge.workspaceIdentity ? { workspaceIdentity: connection.bridge.workspaceIdentity } : {}) };
  }
  private async observeTaskList(connection: ActiveBridge) {
    const remove = await connection.channel.listen('window-controller', 'onDynamicControllerFrame', undefined, () => {
      if (this.active !== connection) return;
      for (const listener of this.eventListeners) listener({ method: 'controller/changed', params: {} });
    });
    try { await connection.channel.call('window-controller', 'subscribeControllerV4', [{ topic: 'controller/tasks-index', visibility: 'foreground' }]); }
    catch (error) { try { remove(); } catch { /* Already disposed. */ } throw error; }
  }
  private async forSession(sessionId: string, signal?: AbortSignal) {
    checkCancelled(signal);
    if (!sessionId) throw new Error('缺少会话标识');
    if (!this.sessions.has(sessionId)) await this.listSessions(signal);
    checkCancelled(signal);
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('该会话不在电脑已共享的工作区中');
    return this.ensureBridge(session.workspace?.workspaceKey ?? session.workspace?.workspacePath, signal);
  }
  private remember(value: RecordValue, fallback?: RemoteWorkspace) {
    const record = value.task ?? value.meta ?? value;
    const sessionId = record.sessionId ?? record.taskId ?? record.address?.taskId;
    if (typeof sessionId !== 'string') return null;
    const ws = record.workspace ?? record.address ?? record;
    const path = ws.workspacePath ?? ws.path ?? fallback?.workspacePath ?? fallback?.path;
    const identity = ws.workspaceIdentity ?? record.workspaceIdentity ?? fallback?.workspaceIdentity;
    if (typeof path !== 'string') return null;
    const shared = this.bootstrap.workspaces.find(item => (item.workspacePath ?? item.path) === path && (!identity || item.workspaceIdentity === identity));
    if (!shared) return null;
    const session = { sessionId, title: record.title ?? '', mode: record.mode ?? 'yolo', updatedAt: record.updatedAt ?? record.lastActivityAt ?? record.createdAt ?? 0,
      status: record.liveStatus ?? record.status ?? (record.phase === 'running' ? 'running' : 'idle'), workspace: { workspaceKey: workspaceKey(shared), workspacePath: path } };
    this.sessions.set(sessionId, session); return session;
  }
  private async listSessions(signal?: AbortSignal) {
    const connection = await this.ensureBridge(undefined, signal);
    checkCancelled(signal);
    const workspaceScopes = this.bootstrap.workspaces.map(item => ({ workspacePath: item.workspacePath ?? item.path,
      ...(item.workspaceIdentity ? { workspaceIdentity: item.workspaceIdentity } : {}) }));
    const responses = await Promise.all(['timeline', 'pinned'].map(kind => connection.channel.call<RecordValue>('window-controller', 'listTaskList', [{ kind, workspaceScopes, sortBy: 'updated', limit: 200 }])));
    checkCancelled(signal);
    if (responses.some(response => !Array.isArray(response.items))) throw new Error('官方会话列表格式无效');
    const sessions = new Map<string, RecordValue>();
    for (const item of responses.flatMap(response => response.items)) {
      const session = this.remember(item);
      if (session) sessions.set(session.sessionId, session);
    }
    return { sessions: [...sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt) };
  }
  private async subscribe(sessionId: string, signal?: AbortSignal) {
    const connection = await this.forSession(sessionId, signal);
    checkCancelled(signal);
    const existing = this.subscriptions.get(sessionId);
    if (existing) return existing;
    const afterSeq = this.eventSequences.get(sessionId);
    const promise = connection.channel.listen('zcode-agent', 'onDynamicSessionEvent', { ...this.scope(connection), sessionId, deliveryKind: 'web-remote-replayable', includeSnapshot: false, ...(afterSeq !== undefined ? { afterSeq } : {}) }, raw => {
      if (this.active !== connection) return;
      const value = raw as RecordValue;
      if (['permission.request', 'userInput.request'].includes(value?.type) && typeof value.request?.requestId === 'string') {
        this.emitInteraction(sessionId, value.request, value.type === 'permission.request');
      }
      if (value?.type === 'session.event' && value.event) {
        const event = value.event as RecordValue;
        if (Number.isSafeInteger(event.seq) && event.seq > 0) {
          if (event.seq <= (this.eventSequences.get(sessionId) ?? 0)) return;
          this.eventSequences.set(sessionId, event.seq);
        }
        if (['permission.requested', 'userInput.requested'].includes(event.type)) this.emitInteraction(sessionId, event.payload, event.type === 'permission.requested');
        if (['permission.resolved', 'userInput.resolved'].includes(event.type) && typeof event.payload?.requestId === 'string') {
          this.interactions.delete(event.payload.requestId);
          for (const listener of this.resolvedListeners) listener(event.payload.requestId);
        }
        for (const listener of this.eventListeners) listener({ method: 'session/event', params: { ...event, sessionId } });
      }
    }).then(() => {});
    this.subscriptions.set(sessionId, promise);
    try { await promise; } catch (error) { if (this.subscriptions.get(sessionId) === promise) this.subscriptions.delete(sessionId); throw error; }
  }

  private emitInteraction(sessionId: string, request: RecordValue, permission: boolean) {
    if (!request || typeof request.requestId !== 'string') return;
    this.interactions.set(request.requestId, { sessionId, request });
    const event = { id: request.requestId, method: permission ? 'interaction/requestPermission' : 'interaction/requestUserInput', params: { ...request, sessionId } };
    for (const listener of this.requestListeners) listener(event);
  }

  private async command(connection: ActiveBridge, sessionId: string | null, type: string, payload: RecordValue, context: RecordValue = {}) {
    const result = await connection.channel.call<RecordValue>('zcode-agent', 'sendConversationCommandV4', [{ ...this.scope(connection),
      envelope: { commandId: this.id(), clientId: this.clientId, sessionId, type, payload, issuedAt: Date.now(), ...context } }]);
    if (!['accepted', 'duplicate', 'noop'].includes(result.status)) throw new Error(typeof result.message === 'string' ? result.message : `官方操作未执行：${result.reasonCode ?? result.status}`);
    return result;
  }
  private async upload(connection: ActiveBridge, sessionId: string, attachment: RecordValue) {
    if (typeof attachment.dataBase64 !== 'string' || attachment.dataBase64.length > 28 * 1024 * 1024) throw new Error('附件过大');
    const bytes = Buffer.from(attachment.dataBase64, 'base64');
    if (!bytes.length || bytes.length > 20 * 1024 * 1024 || bytes.toString('base64') !== attachment.dataBase64) throw new Error('附件编码或长度无效');
    const scope = { ...this.scope(connection), sessionId, uploadId: `upload-${this.id()}` }, chunkBytes = 512 * 1024, totalChunks = Math.ceil(bytes.length / chunkBytes);
    const begin = await connection.channel.call<RecordValue>('zcode-agent', 'attachmentBeginV4', [{ ...scope, fileName: attachment.filename, mime: attachment.mimeType,
      totalBytes: bytes.length, totalChunks, checksum: `sha256:${Buffer.from(sha256(bytes)).toString('hex')}` }]);
    if (begin.state === 'committed') return { ref: begin.ref };
    if (!Number.isInteger(begin.nextChunkIndex) || begin.nextChunkIndex < 0 || begin.nextChunkIndex > totalChunks) throw new Error('官方附件进度无效');
    for (let index = begin.nextChunkIndex; index < totalChunks; index++) {
      const result = await connection.channel.call<RecordValue>('zcode-agent', 'attachmentChunkV4', [{ ...scope, chunkIndex: index,
        dataBase64: Buffer.from(bytes.subarray(index * chunkBytes, (index + 1) * chunkBytes)).toString('base64') }]);
      if (result.nextChunkIndex !== index + 1) throw new Error('官方附件进度不一致');
    }
    return connection.channel.call('zcode-agent', 'attachmentCommitV4', [scope]);
  }

  async request<T = unknown>(method: string, params: RecordValue = {}, options: { signal?: AbortSignal } = {}): Promise<T> {
    checkCancelled(options.signal);
    const result = await waitForRequest(this.dispatch(method, params, options.signal), options.signal);
    checkCancelled(options.signal);
    return result as T;
  }
  private async dispatch(method: string, params: RecordValue, signal?: AbortSignal): Promise<unknown> {
    if (this.status !== 'online') throw new Error(this.detail || '官方电脑未连接');
    if (method === 'session/setMode' && !['build', 'plan', 'edit', 'yolo'].includes(params.mode)) throw new Error('不支持此会话模式，请选择构建、规划、编辑或全自动');
    if (method === 'session/list') return this.listSessions(signal);
    if (method === 'gw.workspaces') return { workspaces: this.bootstrap.workspaces.map(item => {
      const key = workspaceKey(item), sessions = [...this.sessions.values()].filter(session => session.workspace?.workspaceKey === key);
      return { workspaceKey: key, workspacePath: item.workspacePath ?? item.path ?? key, sessionCount: sessions.length, lastActive: Math.max(0, ...sessions.map(session => session.updatedAt)) };
    }) };
    if (method === 'session/subscribe') { await this.subscribe(String(params.sessionId), signal); return { ok: true }; }
    if (method === 'gw.respondInteraction') {
      const pending = this.interactions.get(params.requestId);
      if (!pending) throw new Error('此交互已失效，请重新打开会话');
      const connection = await this.forSession(pending.sessionId);
      const result = await this.command(connection, pending.sessionId, 'resolveInteraction', { interactionId: params.requestId, answer: params.result });
      this.interactions.delete(params.requestId);
      for (const listener of this.resolvedListeners) listener(params.requestId);
      return result;
    }
    const connection = params.sessionId ? await this.forSession(String(params.sessionId), signal) : await this.ensureBridge(params.workspacePath, signal);
    checkCancelled(signal);
    const scope = this.scope(connection);
    if (method === 'session/close') {
      await connection.channel.call('zcode-task', 'closeTask', [{ ...scope, taskId: params.sessionId }]);
      this.sessions.delete(String(params.sessionId));
      return { ok: true };
    }
    const sessionMethods: Record<string, string> = { 'session/read': 'readSession', 'session/resume': 'resumeSession', 'session/messages': 'readSessionMessages', 'session/setModel': 'setModel', 'session/setMode': 'setMode' };
    if (sessionMethods[method]) {
      const args = { ...params, ...scope, ...(method === 'session/read' ? { deliveryKind: 'web-remote-replayable' } : {}) };
      const result = await connection.channel.call<RecordValue>('zcode-session', sessionMethods[method], [args]);
      if (method === 'session/messages') return { messages: result };
      return result;
    }
    switch (method) {
      case 'gw.models': {
        const state = await connection.channel.call<RecordValue>('zcode-session', 'readWorkspaceState', [scope]);
        return { providers: state.modelCatalog?.providers ?? [] };
      }
      case 'gw.usage': {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const [period, all] = await Promise.all(['7d', 'all'].map(range => connection.channel.call<RecordValue>('usage-stats', 'getAppUsageSnapshot', [{ range, timeZone }])));
        const summary = period.summary;
        if (!summary || !all.summary || !Array.isArray(period.models) || !Array.isArray(all.models)) throw new Error('官方用量数据格式无效');
        const requests = (value: RecordValue) => value.models.reduce((sum: number, model: RecordValue) => sum + Number(model.requestCount ?? 0), 0);
        return { days: 7, stats: { requestCount: requests(period), sessionCount: summary.totalSessions, inputTokens: summary.inputTokens, outputTokens: summary.outputTokens,
          reasoningTokens: summary.reasoningTokens, cacheReadTokens: summary.cacheReadTokens, cacheWriteTokens: summary.cacheCreationTokens, totalTokens: summary.totalTokens },
          allTime: { requestCount: requests(all), totalTokens: all.summary.totalTokens },
          models: period.models.map((model: RecordValue) => ({ modelId: model.modelId ?? '未知模型', providerId: '', requestCount: model.requestCount, totalTokens: model.totalTokens })),
          daily: (all.heatmap?.weeks ?? []).flatMap((week: RecordValue) => (week.days ?? []).filter(Boolean).map((day: RecordValue) => ({ date: day.date, totalTokens: day.totalTokens }))) };
      }
      case 'gw.create': {
        const config: RecordValue = { mode: 'yolo' };
        if (params.model?.providerId && params.model?.modelId) { config.provider = params.model.providerId; config.model = params.model.modelId; }
        const created = await this.command(connection, null, 'createSession', { workspaceId: connection.bridge.workspaceKey, config });
        const sessionId = created.result?.sessionId;
        if (!sessionId) throw new Error('官方未返回新会话标识');
        const session = this.remember({ sessionId, title: '', mode: 'yolo', updatedAt: Date.now(), workspace: scope });
        return { session };
      }
      case 'gw.send': {
        const sessionId = String(params.sessionId);
        await this.subscribe(sessionId);
        const attachments = [];
        for (const item of params.attachments ?? []) attachments.push(await this.upload(connection, sessionId, item));
        return this.command(connection, sessionId, 'sendText', { text: params.content ?? '', ...(attachments.length ? { attachments } : {}) });
      }
      case 'gw.stop': return this.command(connection, String(params.sessionId), 'stop', {});
      case 'session/compact': return this.command(connection, String(params.sessionId), 'compact', {});
      case 'gw.retry':
      case 'session/fork': {
        const sessionId = String(params.sessionId), messageId = method === 'gw.retry' ? params.messageId : params.target?.messageId;
        const snapshot = await captureSnapshot(connection.channel, scope, sessionId);
        let rows = snapshot.rows.window, target = findRowTarget(rows, messageId);
        for (let page = 0; !target && rows.length && page < 20; page++) {
          const result = await connection.channel.call<RecordValue>('zcode-agent', 'conversationRowsRangeV4', [{ ...scope, sessionId, beforeRowId: Math.min(...rows.map((row: RecordValue) => row.rowId)), limit: 200 }]);
          rows = Array.isArray(result.rows) ? result.rows : [];
          target = findRowTarget(rows, messageId);
          if (!result.hasMore) break;
        }
        if (!target) throw new Error('找不到可操作的官方回复位置，请刷新会话');
        const result = await this.command(connection, sessionId, method === 'gw.retry' ? 'retryTurn' : 'forkAssistant', { target }, { baseRevision: snapshot.revision, baseLogEpoch: snapshot.logEpoch });
        if (method === 'gw.retry') return result;
        const forkedSessionId = result.result?.sessionId;
        if (!forkedSessionId) throw new Error('官方未返回分支会话标识，请刷新列表确认结果');
        this.remember({ sessionId: forkedSessionId, workspace: scope, updatedAt: Date.now() });
        return { forkedSessionId };
      }
      case 'gw.settingsSection': {
        const section = String(params.section);
        const settings = await connection.channel.call<RecordValue>('setting', 'get');
        const base = { section, workspacePath: scope.workspacePath, settings };
        if (section === 'models' || section === 'commands') {
          const state = await connection.channel.call<RecordValue>('zcode-session', 'readWorkspaceState', [scope]);
          return { ...base, providers: state.modelCatalog?.providers ?? [], workspaceState: state, commands: state.slashCommands ?? [] };
        }
        if (['general', 'appearance', 'browser', 'memory', 'indexes', 'onboarding'].includes(section)) return base;
        if (section === 'usage') return { ...base, usage: await connection.channel.call('usage-stats', 'getAppUsageSnapshot', [{ range: '30d', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }]) };
        if (['plugins', 'plugin-market', 'hooks'].includes(section)) return { ...base, overview: await connection.channel.call('plugin-management', 'getPluginsOverview', [scope]) };
        if (section === 'skills') return { ...base, skills: await connection.channel.call('zcode-agent', 'getSkillReferenceCatalog', [scope]) };
        if (section === 'mcp') return { ...base, mcp: await connection.channel.call('zcode-agent', 'listMcpServerStatuses', [{ ...scope, mode: 'status' }]) };
        if (section === 'subagents') {
          const plugins = await connection.channel.call<RecordValue>('plugin-management', 'listPlugins', [scope]);
          const agents = (plugins.plugins ?? []).flatMap((plugin: RecordValue) => (plugin.components ?? []).filter((component: RecordValue) => component.kind === 'agent')
            .flatMap((component: RecordValue) => (component.items ?? []).map((agent: RecordValue) => ({ ...agent, pluginName: plugin.name, pluginId: plugin.id }))));
          return { ...base, agents, sessions: (await this.listSessions()).sessions };
        }
        throw new Error('未知设置页面');
      }
      case 'gw.pluginAction': {
        const overview = await connection.channel.call<RecordValue>('plugin-management', 'getPluginsOverview', [scope]);
        const installed = (overview.installedPlugins ?? []).find((plugin: RecordValue) => plugin.id === params.pluginId);
        if (params.action === 'install') {
          const plugin = (overview.availablePlugins ?? []).find((item: RecordValue) => item.id === params.pluginId && item.installed !== true);
          if (!plugin) throw new Error('插件不存在或已安装');
          return connection.channel.call('plugin-management', 'installPlugin', [{ ...scope, pluginName: plugin.name, marketplace: plugin.marketplace }]);
        }
        if (!installed) throw new Error('找不到已安装插件');
        if (params.action === 'setEnabled' && typeof params.enabled === 'boolean') return connection.channel.call('plugin-management', 'setPluginEnabled', [{ ...scope, pluginId: params.pluginId, enabled: params.enabled }]);
        const actions: Record<string, string> = { uninstall: 'uninstallPlugin', update: 'updatePlugin' };
        if (!actions[params.action]) throw new Error('不支持的插件操作');
        return connection.channel.call('plugin-management', actions[params.action], [{ ...scope, pluginId: params.pluginId }]);
      }
      case 'gw.mcpSetEnabled': {
        if (typeof params.enabled !== 'boolean') throw new Error('MCP 启用状态无效');
        const result = await connection.channel.call<RecordValue>('mcp-sync', 'loadMcpFromUserDirectory', [scope]);
        const matches = (result.servers ?? []).filter((server: RecordValue) => server.name === params.name);
        if (matches.length !== 1) throw new Error('MCP 来源不唯一或由插件管理，请在电脑端修改');
        const server = matches[0];
        await connection.channel.call('mcp-sync', 'saveMcpToUserDirectory', [{ action: 'set-enabled', name: server.name, enabled: params.enabled,
          ...(server.projectPath ? { projectPath: server.projectPath } : {}), location: server.location }]);
        return { ok: true, restartRequired: true };
      }
      case 'gw.settingsUpdate': {
        const allowed = new Set(['locale', 'terminalInheritSystemProfile', 'keepAwakeWhileRunning', 'taskAutoArchiveEnabled', 'taskAutoArchiveOlderThanDays', 'messageStreamShowReasoning', 'messageStreamShowTodos', 'toolGroupingExploreEnabled', 'toolGroupingTerminalEnabled', 'toolGroupingChangesEnabled', 'askUserQuestionAutoResolutionEnabled', 'embeddedBrowserAllowInsecureCertificates', 'computerUseComposerEntryHidden', 'desktopChromiumHardwareAccelerationEnabled', 'memoryEnabled', 'repoSnapshotIndexingEnabled', 'instantGrepIndexingEnabled', 'nativeSearchEnhancementsEnabled', 'modelIoFullRetentionEnabled', 'optimizeAgentExperienceEnabled']);
        if (!allowed.has(params.key)) throw new Error('不支持此设置');
        await connection.channel.call('setting', 'update', [{ [params.key]: params.value }]);
        return { settings: await connection.channel.call('setting', 'get') };
      }
      case 'gw.setDefaultModel': return connection.channel.call('zcode-session', 'setWorkspaceDefaultModel', [{ ...scope, model: { providerId: params.providerId, modelId: params.modelId } }]);
      default: throw new Error(`此操作的官方公网接口尚未接入：${method}`);
    }
  }

  onEvent(listener: (event: EngineEvent) => void) { this.eventListeners.add(listener); return () => { this.eventListeners.delete(listener); }; }
  onRequest(listener: (event: EngineRequest) => void) { this.requestListeners.add(listener); return () => { this.requestListeners.delete(listener); }; }
  onInteractionResolved(listener: (id: string) => void) { this.resolvedListeners.add(listener); return () => { this.resolvedListeners.delete(listener); }; }
  onStatus(listener: (status: ConnectionStatus) => void) { this.statusListeners.add(listener); return () => { this.statusListeners.delete(listener); }; }
  onDetail(listener: (detail: string) => void) { this.detailListeners.add(listener); return () => { this.detailListeners.delete(listener); }; }
  private setStatus(status: ConnectionStatus) { this.status = status; for (const listener of this.statusListeners) listener(status); }
  private setDetail(detail: string) { this.detail = detail; for (const listener of this.detailListeners) listener(detail); }
}
