import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { remoteClient as gateway, type EngineEvent, type EngineRequest, type ConnectionStatus as GatewayStatus } from '@/lib/remote-client';
import { deletePairing, loadPairing, pairingDeviceName, savePairing } from '@/lib/pairing-storage';
import { notifySessionComplete } from '@/lib/notifications';
import type { AppearanceMode } from '@/lib/theme';

export type SessionInfo = {
  sessionId: string;
  title: string;
  mode: string;
  status: string;
  updatedAt: number;
  workspace?: { workspaceKey: string; workspacePath: string };
};

export type WorkspaceInfo = {
  workspaceKey: string;
  workspacePath: string;
  sessionCount: number;
  lastActive: number;
};

export type ModelRef = { providerId: string; modelId: string };
export type ProviderInfo = { providerId: string; label?: string; models: { modelId: string; label?: string }[] };

export type ToolCall = {
  callId: string;
  tool: string;
  status: string;
  title?: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
};

export type OutgoingAttachment = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
};

export type ChatMsg = {
  key: string;
  role: 'user' | 'assistant';
  text: string;
  think?: string;
  streaming?: boolean;
  local?: boolean;
  messageId?: string;
  parentMessageId?: string;
  tools?: ToolCall[];
  failed?: boolean;
  retryText?: string;
  retryAttachments?: OutgoingAttachment[];
  pendingFinal?: boolean;
  knownHistoryKeys?: string[];
  replacedMessageIds?: string[];
  replacementBaseline?: string;
};

export type PendingInteraction = EngineRequest;

export type StreamState = { key: string; messageId?: string; text: string; think: string; tools: ToolCall[]; started: boolean; replacesMessageId?: string; replacedMessageIds?: string[]; replacementBaseline?: string };
let streamSequence = 0;
const newStream = (): StreamState => ({ key: `stream-${Date.now()}-${++streamSequence}`, text: '', think: '', tools: [], started: true });

function retainStream(messages: ChatMsg[], stream?: StreamState): ChatMsg[] {
  if (!stream || (!stream.text && !stream.think && !stream.tools.length)) return messages;
  const pending: ChatMsg = { key: stream.key, messageId: stream.messageId, role: 'assistant', text: stream.text,
    think: stream.think || undefined, tools: stream.tools, pendingFinal: true,
    replacementBaseline: stream.replacementBaseline,
    replacedMessageIds: [...new Set([...(stream.replacedMessageIds ?? []), ...(stream.replacesMessageId && stream.replacesMessageId !== stream.messageId ? [stream.replacesMessageId] : [])])],
    knownHistoryKeys: messages.map((message) => message.key) };
  const index = messages.findIndex(message => message.key === stream.key || (!!stream.messageId && message.messageId === stream.messageId));
  if (index < 0) return [...messages, pending];
  return messages.flatMap((message, position) => position === index ? [pending] : message.messageId && (message.messageId === stream.messageId || pending.replacedMessageIds?.includes(message.messageId)) ? [] : [message]);
}

function reconcileMessages(previous: ChatMsg[], incoming: ChatMsg[]): ChatMsg[] {
  const retiredIds = new Set(previous.flatMap(message => message.replacedMessageIds ?? []));
  const next = incoming.filter(message => !message.messageId || !retiredIds.has(message.messageId)).map((message) => {
    const existing = message.messageId && previous.find((item) => item.messageId === message.messageId);
    return existing ? { ...message, key: existing.key, replacedMessageIds: existing.replacedMessageIds } : message;
  });
  for (const pending of previous.filter((message) => message.pendingFinal || (message.replacedMessageIds?.length && !next.some(item => item.messageId === message.messageId)))) {
    const index = next.findIndex((message) => message.role === 'assistant' && (
      pending.messageId ? message.messageId === pending.messageId
        : !pending.knownHistoryKeys?.includes(message.key) &&
          (!pending.text || message.text === pending.text) &&
          (!pending.think || message.think === pending.think) &&
          (pending.tools ?? []).every((tool) => message.tools?.some((item) => item.callId === tool.callId))
    ));
    if (index < 0) {
      if (pending.replacedMessageIds?.length) {
        const previousIndex = previous.findIndex(message => message.key === pending.key);
        const nextSibling = previous.slice(previousIndex + 1).find(message => next.some(item => item.key === message.key));
        const insertion = nextSibling ? next.findIndex(message => message.key === nextSibling.key) : next.length;
        next.splice(insertion, 0, pending);
      } else next.push(pending);
      continue;
    }
    const message = next[index];
    // An eventually-consistent read may still contain only a prefix of the stream.
    const oldVersion = pending.replacementBaseline !== undefined && message.text === pending.replacementBaseline && message.text !== pending.text;
    const caughtUp = !oldVersion && message.text.startsWith(pending.text) &&
      (message.think ?? '').startsWith(pending.think ?? '') &&
      (pending.tools ?? []).every((tool) => message.tools?.some((item) => item.callId === tool.callId));
    next[index] = caughtUp ? { ...message, key: pending.key, replacedMessageIds: pending.replacedMessageIds }
      : { ...pending, parentMessageId: message.parentMessageId };
  }
  return next;
}

export function projectChatMessages(messages: ChatMsg[], running: boolean, stream?: StreamState): ChatMsg[] {
  if (!running) return messages;
  const live: ChatMsg = stream?.started ? { key: stream.key, messageId: stream.messageId, role: 'assistant', text: stream.text, think: stream.think || undefined, tools: stream.tools, streaming: true }
    : { key: '__waiting', role: 'assistant', text: '', streaming: true };
  const replacementIndex = stream?.replacesMessageId ? messages.findIndex(message => message.key === stream.key || message.messageId === stream.replacesMessageId) : -1;
  if (replacementIndex >= 0) return messages.flatMap((message, index) => index === replacementIndex ? [live]
    : message.messageId && (message.messageId === stream?.messageId || stream?.replacedMessageIds?.includes(message.messageId)) ? [] : [message]);
  const existingIndex = stream?.messageId ? messages.findIndex(message => message.messageId === stream.messageId) : -1;
  if (existingIndex >= 0) return messages.map((message, index) => index === existingIndex ? live : message);
  return [...messages, live];
}
export type ChatBackgroundSettings = {
  uri: string | null;
  overlayColor: string;
  overlayOpacity: number;
  brightness: number;
  parallaxEnabled: boolean;
  parallaxStrength: number;
};

export const DEFAULT_CHAT_BACKGROUND: ChatBackgroundSettings = {
  uri: null,
  overlayColor: '#09090b',
  overlayOpacity: 0.32,
  brightness: 1,
  parallaxEnabled: true,
  parallaxStrength: 0.5,
};

const PINNED_SESSIONS_KEY = 'zcpocket.pinnedSessions';
const CHAT_BACKGROUND_KEY = 'zcpocket.chatBackground';
let backgroundSaveQueue: Promise<void> = Promise.resolve();
const APPEARANCE_MODE_KEY = 'zcpocket.appearanceMode';

type AppState = {
  hydrated: boolean;
  paired: boolean;
  deviceName: string | null;
  connectionDetail: string;
  syncError: string;
  status: GatewayStatus;
  sessions: SessionInfo[];
  pinnedSessionIds: string[];
  chatBackground: ChatBackgroundSettings;
  appearanceMode: AppearanceMode;
  workspaces: WorkspaceInfo[];
  providers: ProviderInfo[];
  running: Record<string, boolean>;
  streams: Record<string, StreamState>;
  chatCache: Record<string, { messages: ChatMsg[]; cachedAt: number }>;
  pendingInteractions: PendingInteraction[];
  hydrate: () => Promise<void>;
  pair: (officialUrl: string) => Promise<void>;
  reconnect: () => Promise<void>;
  unpair: () => Promise<void>;
  setStatus: (s: GatewayStatus) => void;
  refresh: () => Promise<void>;
  togglePinnedSession: (sessionId: string) => Promise<void>;
  setChatBackground: (settings: Partial<ChatBackgroundSettings>) => Promise<void>;
  setAppearanceMode: (mode: AppearanceMode) => Promise<void>;
  setRunning: (sessionId: string, v: boolean) => void;
  beginRegeneration: (sessionId: string, messageId: string) => void;
  cancelRegeneration: (sessionId: string) => void;
  cacheMessages: (sessionId: string, messages: ChatMsg[]) => void;
  appendLocalMessage: (sessionId: string, msg: ChatMsg) => void;
  refreshSessionCache: (sessionId: string) => Promise<void>;
  handleEvent: (e: EngineEvent) => void;
  handleRequest: (r: EngineRequest) => void;
  resolveInteraction: (requestId: string, result: Record<string, unknown>) => Promise<void>;
};

export type SessionRead = {
  settings?: { mode?: string | { current?: string }; model?: { current?: ModelRef; providerId?: string; modelId?: string } };
  messages?: {
    info?: { role?: string; messageId?: string; parentMessageId?: string };
    parts?: {
      type?: string;
      text?: string;
      thinking?: string;
      callId?: string;
      tool?: string;
      state?: { status?: string; title?: string; input?: unknown; output?: unknown; error?: unknown };
    }[];
  }[];
};

async function fetchMessages(sessionId: string): Promise<ChatMsg[]> {
  return parseSessionMessages(await gateway.request<SessionRead>('session/read', { sessionId }));
}

export function parseSessionMessages(r: SessionRead): ChatMsg[] {
  const out: ChatMsg[] = [];
  for (const m of r.messages ?? []) {
    const role = m.info?.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const text = (m.parts ?? [])
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text)
      .join('\n');
    const think = (m.parts ?? [])
      .filter((p) => (p.type === 'thinking' || p.type === 'reasoning') && (p.thinking || p.text))
      .map((p) => p.thinking ?? p.text ?? '')
      .join('\n');
    const tools: ToolCall[] = (m.parts ?? [])
      .filter((p) => p.type === 'tool')
      .map((p, index) => ({
        callId: p.callId ?? `${m.info?.messageId ?? out.length}-${index}`,
        tool: p.tool ?? '工具',
        status: p.state?.status ?? 'running',
        title: p.state?.title,
        input: p.state?.input,
        output: p.state?.output,
        error: p.state?.error,
      }));
    if (!text && !think && tools.length === 0) continue;
    out.push({
      key: m.info?.messageId ?? `h${out.length}`,
      role,
      text,
      think: think || undefined,
      messageId: m.info?.messageId,
      parentMessageId: m.info?.parentMessageId,
      tools: tools.length ? tools : undefined,
    });
  }
  return out;
}

export const fetchSessionMessages = fetchMessages;

export const useApp = create<AppState>((set, get) => ({
  hydrated: false,
  paired: false,
  deviceName: null,
  connectionDetail: '未配对',
  syncError: '',
  status: 'idle',
  sessions: [],
  pinnedSessionIds: [],
  chatBackground: DEFAULT_CHAT_BACKGROUND,
  appearanceMode: 'dark',
  workspaces: [],
  providers: [],
  running: {},
  streams: {},
  chatCache: {},
  pendingInteractions: [],

  async hydrate() {
    const [officialUrl, storedPins, storedBackground, storedAppearance] = await Promise.all([
      loadPairing().catch(() => { set({ connectionDetail: '无法读取安全配对信息，请重新扫码' }); return null; }),
      AsyncStorage.getItem(PINNED_SESSIONS_KEY), AsyncStorage.getItem(CHAT_BACKGROUND_KEY), AsyncStorage.getItem(APPEARANCE_MODE_KEY),
    ]);
    let pinnedSessionIds: string[] = [];
    let chatBackground = DEFAULT_CHAT_BACKGROUND;
    try {
      const parsed = JSON.parse(storedPins ?? '[]');
      if (Array.isArray(parsed)) pinnedSessionIds = parsed.filter((value): value is string => typeof value === 'string');
    } catch {
      // 损坏的本地置顶数据不应阻止应用启动
    }
    try {
      const parsed = JSON.parse(storedBackground ?? '{}') as Partial<ChatBackgroundSettings>;
      chatBackground = {
        uri: typeof parsed.uri === 'string' ? parsed.uri : null,
        overlayColor: typeof parsed.overlayColor === 'string' && /^#[0-9a-f]{6}$/i.test(parsed.overlayColor) ? parsed.overlayColor : DEFAULT_CHAT_BACKGROUND.overlayColor,
        overlayOpacity: typeof parsed.overlayOpacity === 'number' ? Math.min(1, Math.max(0, parsed.overlayOpacity)) : DEFAULT_CHAT_BACKGROUND.overlayOpacity,
        brightness: typeof parsed.brightness === 'number' ? Math.min(1.5, Math.max(0.4, parsed.brightness)) : DEFAULT_CHAT_BACKGROUND.brightness,
        parallaxEnabled: parsed.parallaxEnabled !== false,
        parallaxStrength: typeof parsed.parallaxStrength === 'number' && Number.isFinite(parsed.parallaxStrength) ? Math.max(0, Math.min(1, parsed.parallaxStrength)) : DEFAULT_CHAT_BACKGROUND.parallaxStrength,
      };
    } catch {
      // 背景设置损坏时恢复默认值
    }
    const appearanceMode: AppearanceMode = storedAppearance === 'light' ? 'light' : 'dark';
    set({ pinnedSessionIds, chatBackground, appearanceMode, paired: !!officialUrl, deviceName: officialUrl ? pairingDeviceName(officialUrl) : null, hydrated: true });
    if (officialUrl) void gateway.connect(officialUrl).catch((error) => set({ connectionDetail: error instanceof Error ? error.message : '连接失败，请重新扫码' }));
  },

  async pair(officialUrl) {
    await gateway.connect(officialUrl);
    try { await savePairing(officialUrl); }
    catch { gateway.disconnect(); throw new Error('无法安全保存配对，请重试'); }
    set({ paired: true, deviceName: pairingDeviceName(officialUrl) });
  },

  async reconnect() {
    const officialUrl = await loadPairing();
    if (!officialUrl) throw new Error('没有有效的本机配对信息，请重新扫描官方二维码');
    await gateway.connect(officialUrl);
  },

  async unpair() {
    gateway.disconnect();
    await deletePairing();
    set({
      paired: false,
      deviceName: null,
      connectionDetail: '未配对',
      syncError: '',
      sessions: [],
      workspaces: [],
      providers: [],
      running: {},
      streams: {},
      chatCache: {},
      pendingInteractions: [],
    });
  },

  setStatus(s) {
    set({ status: s });
    // Only the focused chat restores its stream. Restoring every cached chat
    // would repeatedly switch the official single active workspace bridge.
    if (s === 'online') void get().refresh();
  },

  async refresh() {
    const runningAtRequest = get().running;
    const streamsAtRequest = get().streams;
    try {
      const list = await gateway.request<{ sessions: SessionInfo[] }>('session/list');
      const ws = await gateway.request<{ workspaces: WorkspaceInfo[] }>('gw.workspaces');
      const reg = await gateway.request<{ providers: ProviderInfo[] }>('gw.models').catch(() => ({ providers: get().providers }));
      const previousRunning = get().running;
      const currentStreams = get().streams;
      const running = { ...previousRunning, ...Object.fromEntries(list.sessions.map((session) => {
        const id = session.sessionId;
        const changedDuringRead = previousRunning[id] !== runningAtRequest[id] || currentStreams[id] !== streamsAtRequest[id];
        return [id, changedDuringRead ? previousRunning[id] : session.status === 'running'];
      })) };
      set({ sessions: list.sessions, workspaces: ws.workspaces, providers: reg.providers, running, syncError: '' });
      for (const session of list.sessions) {
        if (previousRunning[session.sessionId] && !running[session.sessionId]) {
          void notifySessionComplete(session.sessionId, session.title || 'ZCode 回复完成').catch(() => {});
        }
      }
    } catch (error) {
      set({ syncError: error instanceof Error ? error.message : '会话同步失败，请下拉重试' });
    }
  },

  async togglePinnedSession(sessionId) {
    const current = get().pinnedSessionIds;
    const next = current.includes(sessionId) ? current.filter((id) => id !== sessionId) : [sessionId, ...current];
    set({ pinnedSessionIds: next });
    await AsyncStorage.setItem(PINNED_SESSIONS_KEY, JSON.stringify(next));
  },

  async setChatBackground(settings) {
    const patch = { ...settings };
    const save = backgroundSaveQueue.then(async () => {
      const current = get().chatBackground;
      const next: ChatBackgroundSettings = {
        ...current, ...patch,
        overlayOpacity: Math.min(1, Math.max(0, patch.overlayOpacity ?? current.overlayOpacity)),
        brightness: Math.min(1.5, Math.max(0.4, patch.brightness ?? current.brightness)),
        parallaxStrength: Number.isFinite(patch.parallaxStrength ?? current.parallaxStrength) ? Math.max(0, Math.min(1, patch.parallaxStrength ?? current.parallaxStrength)) : DEFAULT_CHAT_BACKGROUND.parallaxStrength,
      };
      // Keep the old displayed image if persistence fails. Serialize slider and
      // image writes so a late settings save cannot resurrect an older image URI.
      await AsyncStorage.setItem(CHAT_BACKGROUND_KEY, JSON.stringify(next));
      set({ chatBackground: next });
    });
    backgroundSaveQueue = save.catch(() => {});
    return save;
  },

  async setAppearanceMode(mode) {
    set({ appearanceMode: mode });
    await AsyncStorage.setItem(APPEARANCE_MODE_KEY, mode);
  },

  setRunning(sessionId, v) {
    set((s) => ({ running: { ...s.running, [sessionId]: v } }));
  },

  beginRegeneration(sessionId, messageId) {
    const target = get().chatCache[sessionId]?.messages.find(message => message.role === 'assistant' && message.messageId === messageId);
    if (!target) throw new Error('找不到原回答，请刷新会话');
    set(s => ({ running: { ...s.running, [sessionId]: true }, streams: { ...s.streams, [sessionId]: { ...newStream(), key: target.key, replacesMessageId: messageId, replacedMessageIds: target.replacedMessageIds, replacementBaseline: target.text } } }));
  },

  cancelRegeneration(sessionId) {
    set(s => {
      const stream = s.streams[sessionId], cache = s.chatCache[sessionId];
      return { running: { ...s.running, [sessionId]: false }, streams: { ...s.streams, [sessionId]: { ...(stream ?? newStream()), started: false } },
        chatCache: cache ? { ...s.chatCache, [sessionId]: { ...cache, messages: retainStream(cache.messages, stream) } } : s.chatCache };
    });
  },

  cacheMessages(sessionId, messages) {
    set((s) => ({ chatCache: { ...s.chatCache, [sessionId]: { messages: reconcileMessages(s.chatCache[sessionId]?.messages ?? [], messages), cachedAt: Date.now() } } }));
  },

  appendLocalMessage(sessionId, msg) {
    set((s) => {
      const cache = s.chatCache[sessionId] ?? { messages: [], cachedAt: 0 };
      return { chatCache: { ...s.chatCache, [sessionId]: { ...cache, messages: [...cache.messages, msg] } } };
    });
  },

  async refreshSessionCache(sessionId) {
    const streamAtRequest = get().streams[sessionId];
    try {
      const messages = await fetchMessages(sessionId);
      // A read from the previous turn must not overwrite a new turn's local data.
      if (get().streams[sessionId] !== streamAtRequest) return;
      get().cacheMessages(sessionId, messages);
    } catch {
      // 会话未激活（例如引擎重启后）：保留旧缓存
    }
  },

  handleEvent(e: EngineEvent) {
    if (e.method === 'controller/changed') { scheduleListRefresh(); return; }
    const p = e.params ?? {};
    const type = p.type as string | undefined;
    const sid = p.sessionId as string | undefined;
    const payload = (p.payload ?? {}) as {
      kind?: string; delta?: string; title?: string; toolCallId?: string; toolName?: string; description?: string;
      input?: unknown; result?: unknown; error?: unknown; stdoutTail?: string; stderrTail?: string; assistantMessageId?: string;
    };
    if (!sid) return;
    const state = get();

    if (type === 'turn.started') {
      set((s) => ({ running: { ...s.running, [sid]: true }, streams: { ...s.streams, [sid]: s.streams[sid]?.started ? s.streams[sid] : newStream() } }));
      return;
    }
    if (type === 'model.streaming') {
      const kind = payload.kind;
      const delta = payload.delta ?? '';
      if (typeof delta !== 'string' || !delta || (kind !== 'text_delta' && kind !== 'reasoning_delta')) return;
      set((s) => {
        let cur = s.streams[sid]?.started ? s.streams[sid] : newStream();
        const cache = s.chatCache[sid] ?? { messages: [], cachedAt: 0 };
        let messages = cache.messages;
        if (payload.assistantMessageId && cur.messageId && payload.assistantMessageId !== cur.messageId) {
          messages = retainStream(messages, cur);
          cur = newStream();
        }
        return { running: { ...s.running, [sid]: true },
          chatCache: messages === cache.messages ? s.chatCache : { ...s.chatCache, [sid]: { ...cache, messages } },
          streams: { ...s.streams, [sid]: { ...cur, messageId: payload.assistantMessageId || cur.messageId,
            text: cur.text + (kind === 'text_delta' ? delta : ''), think: cur.think + (kind === 'reasoning_delta' ? delta : '') } } };
      });
      return;
    }
    if (type === 'tool.updated') {
      const toolCallId = typeof payload.toolCallId === 'string' ? payload.toolCallId : '';
      if (!toolCallId || payload.kind === 'batch') return;
      state.setRunning(sid, true);
      set((s) => {
        const cur = s.streams[sid]?.started ? s.streams[sid] : newStream();
        const previous = cur.tools.find((tool) => tool.callId === toolCallId);
        const status = payload.kind === 'scheduled' ? 'pending'
          : payload.kind === 'started' || payload.kind === 'progress' ? 'running'
            : payload.kind === 'error' || (payload.kind === 'result' && (payload.result as { success?: boolean } | undefined)?.success === false) ? 'failed'
              : 'completed';
        const progressOutput = payload.kind === 'progress'
          ? [payload.stdoutTail, payload.stderrTail].filter((value): value is string => typeof value === 'string' && value.length > 0).join('\n')
          : undefined;
        const next: ToolCall = {
          callId: toolCallId,
          tool: typeof payload.toolName === 'string' ? payload.toolName : previous?.tool ?? '工具',
          title: typeof payload.description === 'string' ? payload.description : previous?.title,
          status,
          input: payload.kind === 'scheduled' ? payload.input : previous?.input,
          output: payload.kind === 'result' ? payload.result : progressOutput || previous?.output,
          error: payload.kind === 'error' ? payload.error : previous?.error,
        };
        const tools = previous ? cur.tools.map((tool) => tool.callId === toolCallId ? next : tool) : [...cur.tools, next];
        return { streams: { ...s.streams, [sid]: { ...cur, tools, started: true } } };
      });
      return;
    }
    if (type && ['turn.completed', 'turn.failed', 'turn.cancelled', 'turn.stopped'].includes(type)) {
      set((s) => {
        const cache = s.chatCache[sid] ?? { messages: [], cachedAt: 0 };
        const stream = s.streams[sid];
        return { running: { ...s.running, [sid]: false },
          streams: { ...s.streams, [sid]: { ...(stream ?? newStream()), started: false } },
          chatCache: { ...s.chatCache, [sid]: { ...cache, messages: retainStream(cache.messages, stream) } } };
      });
      void state.refreshSessionCache(sid);
      if (type === 'turn.completed') {
        const title = state.sessions.find((x) => x.sessionId === sid)?.title ?? 'ZCode 回复完成';
        void notifySessionComplete(sid, title).catch(() => {});
      }
      scheduleListRefresh();
      return;
    }
    if (type === 'session.titleUpdated' && payload.title) {
      set((s) => ({
        sessions: s.sessions.map((x) => (x.sessionId === sid ? { ...x, title: payload.title! } : x)),
      }));
      scheduleListRefresh();
    }
  },

  handleRequest(request) {
    set((s) => ({
      pendingInteractions: [request, ...s.pendingInteractions.filter((item) => item.id !== request.id)],
    }));
  },

  async resolveInteraction(requestId, result) {
    const existing = get().pendingInteractions.find((item) => item.id === requestId);
    set((s) => ({ pendingInteractions: s.pendingInteractions.filter((item) => item.id !== requestId) }));
    try {
      await gateway.request('gw.respondInteraction', { requestId, result });
    } catch (error) {
      if (existing) set((s) => ({ pendingInteractions: [existing, ...s.pendingInteractions] }));
      throw error;
    }
  },
}));

let listRefreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleListRefresh() {
  if (listRefreshTimer) clearTimeout(listRefreshTimer);
  listRefreshTimer = setTimeout(() => void useApp.getState().refresh(), 1500);
}

// 官方公网事件/状态接进 store（单例订阅，随 App 生命周期）
gateway.onStatus((s) => useApp.getState().setStatus(s));
gateway.onDetail((connectionDetail) => useApp.setState({ connectionDetail }));
gateway.onEvent((e) => useApp.getState().handleEvent(e));
gateway.onRequest((r) => useApp.getState().handleRequest(r));
gateway.onInteractionResolved((id) => {
  useApp.setState((s) => ({ pendingInteractions: s.pendingInteractions.filter((item) => item.id !== id) }));
});
