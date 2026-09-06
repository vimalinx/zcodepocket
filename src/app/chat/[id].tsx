import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, BackHandler, Easing, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, ToastAndroid, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, useFocusEffect, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { File as ExpoFile } from 'expo-file-system';
import { MarkdownMessage } from '@/components/chat/markdown-message';
import { ChatBackground } from '@/components/chat/chat-background';
import { ComposerMenu } from '@/components/chat/composer-menu';
import { insertCommand, isSlashQuery } from '@/lib/slash-commands';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { remoteClient as gateway } from '@/lib/remote-client';
import { radius, spacing, useTheme, type ThemeColors } from '@/lib/theme';
import { baseName } from '@/lib/util';
import { parseSessionMessages, projectChatMessages, useApp, type ChatMsg, type OutgoingAttachment, type PendingInteraction, type ToolCall } from '@/store/app';
import { loadSession } from '@/lib/load-session';

import { useSessionNavigation, useSessionSwipe } from '@/lib/session-navigation';
import { acknowledgeSessionPage, beginInteractiveReturn, entryProgress, moveInteractiveReturn, releaseInteractiveReturn, sessionEntryModels, useSessionEntry } from '@/components/session/session-entry';
import { SessionPages } from '@/components/session/session-pages';
import { SessionSettings } from '@/components/session/session-settings';
import { useSessionPanel } from '@/lib/session-panel';
import { listHref, replaceWithSession, sessionList, type RootSessionNavigation } from '@/lib/session-routes';

const EMPTY: ChatMsg[] = [];
const AnimatedSafeAreaView = Animated.createAnimatedComponent(SafeAreaView);
// Keep drafts and reading position while returning to the existing tabs route.
const sessionViews = new Map<string, { input: string; attachments: Attachment[]; offset: number }>();
const COMPOSER_MIN_HEIGHT = 42;
const COMPOSER_MAX_HEIGHT = 174;
const HEADER_EXPANDED_HEIGHT = 112;
const HEADER_COLLAPSE_DISTANCE = 48;

type Attachment = OutgoingAttachment & { id: string };
type MessageListItem = { msg: ChatMsg; showAssistantHeader: boolean; joinsNextAssistant: boolean };

function humanBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function jsonPreview(value: unknown) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function showToast(message: string) {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
  else Alert.alert('', message);
}

function withAlpha(hex: string, alpha: number) {
  return `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
}

function useChatTheme() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return { colors, styles };
}

const ToolCard = memo(function ToolCard({ item }: { item: ToolCall }) {
  const { colors, styles } = useChatTheme();
  const [open, setOpen] = useState(false);
  const failed = item.status === 'error' || item.status === 'failed';
  const running = item.status === 'running' || item.status === 'pending';
  const isFile = ['Write', 'Edit', 'ApplyPatch', 'MultiEdit'].includes(item.tool);
  const detail = [item.input && `输入\n${jsonPreview(item.input)}`, item.output && `输出\n${jsonPreview(item.output)}`, item.error && `错误\n${jsonPreview(item.error)}`].filter(Boolean).join('\n\n');
  return (
    <View style={[styles.toolCard, failed && styles.toolCardFailed]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((v) => !v)} style={({ pressed }) => [styles.toolHead, pressed && styles.pressed]}>
        {running ? <ActivityIndicator color={colors.dim} size={13} /> : <Ionicons name={failed ? 'alert-circle' : isFile ? 'document-text' : 'checkmark-circle'} color={failed ? colors.destructive : colors.dim} size={16} />}
        <View style={styles.toolTitleWrap}>
          <Text style={styles.toolTitle} numberOfLines={1}>{item.title || item.tool}</Text>
          <Text variant="muted" style={styles.toolStatus}>{running ? '执行中' : failed ? '失败' : isFile ? '文件已变更' : '已完成'}</Text>
        </View>
        {detail ? <Ionicons name={open ? 'chevron-up' : 'chevron-down'} color={colors.dim} size={15} /> : null}
      </Pressable>
      {open && detail ? <Text selectable variant="muted" style={styles.toolDetail}>{detail}</Text> : null}
    </View>
  );
});

function TypingDots() {
  const { styles } = useChatTheme();
  const [phase] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const animation = Animated.loop(Animated.timing(phase, { toValue: 3, duration: 1080, easing: Easing.linear, useNativeDriver: true }));
    animation.start();
    return () => animation.stop();
  }, [phase]);
  return <View accessibilityLabel="ZCode 正在准备回复" style={styles.typingDots}>{[0, 1, 2].map((index) => <Animated.View key={index} style={[styles.typingDot, { opacity: phase.interpolate({ inputRange: [index, index + 0.5, index + 1, index + 2, index + 3], outputRange: [0.28, 1, 0.28, 0.28, 0.28], extrapolate: 'clamp' }), transform: [{ scale: phase.interpolate({ inputRange: [index, index + 0.5, index + 1], outputRange: [0.82, 1.12, 0.82], extrapolate: 'clamp' }) }] }]} />)}</View>;
}

const MessageRow = memo(function MessageRow({ msg, showAssistantHeader, joinsNextAssistant, onEdit, onResend, onBranch, onRegenerate, onRetry }: {
  msg: ChatMsg; showAssistantHeader: boolean; joinsNextAssistant: boolean; onEdit: (msg: ChatMsg) => void; onResend: (msg: ChatMsg) => void; onBranch: (msg: ChatMsg) => void; onRegenerate: (msg: ChatMsg) => void; onRetry: (text: string, files: OutgoingAttachment[]) => void;
}) {
  const { colors, styles } = useChatTheme();
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);
  const copyMessage = useCallback(async () => {
    await Clipboard.setStringAsync(msg.text); setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1600);
  }, [msg.text]);

  if (msg.role === 'user') return (
    <View style={styles.userWrap}>
      <View style={styles.user}><Text selectable style={styles.userText}>{msg.text}</Text></View>
      {!msg.streaming ? <View style={styles.userActions}>
        <Pressable onPress={() => onEdit(msg)} hitSlop={6}><Text variant="muted" style={styles.miniAction}>编辑</Text></Pressable>
        <Pressable onPress={() => onResend(msg)} hitSlop={6}><Text variant="muted" style={styles.miniAction}>再发</Text></Pressable>
      </View> : null}
    </View>
  );

  return (
    <View style={[styles.assistant, joinsNextAssistant && styles.assistantJoined]}>
      {showAssistantHeader ? <View style={styles.assistantHead}>
        <View style={styles.aiMark}><Ionicons name="sparkles" color={colors.foreground} size={12} /></View>
        <Text variant="muted" style={styles.aiLabel}>ZCode</Text>
        {msg.streaming && (msg.text || msg.think || msg.tools?.length) ? <View style={styles.streamingLabel}><ActivityIndicator color={colors.mutedForeground} size={11} /><Text variant="muted" style={styles.streamingText}>生成中</Text></View> : null}
      </View> : null}
      {msg.think ? <View style={styles.think}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: thinkingOpen }} onPress={() => setThinkingOpen((v) => !v)} style={({ pressed }) => [styles.thinkToggle, pressed && styles.pressed]}>
          <Ionicons name={thinkingOpen ? 'chevron-down' : 'chevron-forward'} color={colors.dim} size={15} />
          <Text variant="muted" style={styles.thinkTitle}>{msg.streaming ? '正在思考' : '思考过程'}</Text>
        </Pressable>
        {thinkingOpen ? <Text variant="muted" selectable style={styles.thinkText}>{msg.think}</Text> : null}
      </View> : null}
      {msg.tools?.map((tool) => <ToolCard key={tool.callId} item={tool} />)}
      {msg.streaming && !msg.text && !msg.think && !msg.tools?.length ? <TypingDots /> : null}
      {msg.text ? <MarkdownMessage>{msg.text}</MarkdownMessage> : null}
      {msg.streaming && msg.text ? <View style={styles.cursor} /> : null}
      {!msg.streaming && (msg.text || msg.failed) ? <View style={styles.messageActions}>
        {msg.text ? <Pressable accessibilityLabel="复制回复" onPress={() => void copyMessage()} style={({ pressed }) => [styles.messageAction, pressed && styles.pressed]}><Ionicons name={copied ? 'checkmark' : 'copy-outline'} color={colors.dim} size={15} /><Text variant="muted" style={styles.messageActionText}>{copied ? '已复制' : '复制'}</Text></Pressable> : null}
        {msg.failed && (msg.retryText || msg.retryAttachments?.length) ? <Pressable accessibilityLabel="重试发送" onPress={() => onRetry(msg.retryText ?? '', msg.retryAttachments ?? [])} style={({ pressed }) => [styles.messageAction, pressed && styles.pressed]}><Ionicons name="refresh" color={colors.destructive} size={15} /><Text variant="destructive" style={styles.messageActionText}>重试</Text></Pressable>
          : msg.messageId ? <>
            <Pressable accessibilityLabel="从该回复开分支" onPress={() => onBranch(msg)} style={({ pressed }) => [styles.messageAction, pressed && styles.pressed]}><Ionicons name="git-branch-outline" color={colors.dim} size={15} /><Text variant="muted" style={styles.messageActionText}>开分支</Text></Pressable>
            <Pressable accessibilityLabel="重新生成该轮回复" onPress={() => onRegenerate(msg)} style={({ pressed }) => [styles.messageAction, pressed && styles.pressed]}><Ionicons name="refresh-outline" color={colors.dim} size={15} /><Text variant="muted" style={styles.messageActionText}>重新生成</Text></Pressable>
          </> : null}
      </View> : null}
    </View>
  );
});

function InteractionCard({ item }: { item: PendingInteraction }) {
  const { colors, styles } = useChatTheme();
  const resolve = useApp((s) => s.resolveInteraction);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [freeText, setFreeText] = useState('');
  const [busy, setBusy] = useState(false);
  const p = item.params as {
    toolName?: string; reason?: string; prompt?: string; input?: unknown;
    options?: { optionId: string; label: string; response?: Record<string, unknown> }[];
    questions?: { question: string; header?: string; multiSelect?: boolean; options?: { value: string; label: string; description?: string }[] }[];
  };
  const submit = async (result: Record<string, unknown>) => {
    setBusy(true);
    try { await resolve(item.id, result); }
    catch (error) { Alert.alert('处理失败', error instanceof Error ? error.message : String(error)); setBusy(false); }
  };
  if (item.method === 'interaction/requestPermission') return (
    <View style={styles.interaction}>
      <View style={styles.interactionHead}><Ionicons name="shield-checkmark-outline" color={colors.foreground} size={19} /><View style={styles.interactionTitleWrap}><Text style={styles.interactionTitle}>{p.toolName || '工具'} 请求授权</Text><Text variant="muted" style={styles.interactionReason}>{p.reason || jsonPreview(p.input)}</Text></View></View>
      <View style={styles.interactionButtons}>{(p.options ?? []).map((option) => <Pressable key={option.optionId} disabled={busy} onPress={() => void submit({ optionId: option.optionId })} style={({ pressed }) => [styles.interactionButton, option.optionId === 'deny' && styles.denyButton, pressed && styles.pressed]}><Text style={styles.interactionButtonText}>{option.label}</Text></Pressable>)}</View>
    </View>
  );
  const questions = p.questions ?? [];
  return (
    <View style={styles.interaction}>
      <View style={styles.interactionHead}><Ionicons name="help-circle-outline" color={colors.foreground} size={20} /><View style={styles.interactionTitleWrap}><Text style={styles.interactionTitle}>{p.toolName ? `${p.toolName} 需要回答` : 'AI 需要你的选择'}</Text>{p.prompt ? <Text variant="muted" style={styles.interactionReason}>{p.prompt}</Text> : null}</View></View>
      {questions.map((question) => <View key={question.question} style={styles.question}>
        <Text style={styles.questionText}>{question.question}</Text>
        {question.options?.map((option) => {
          const current = answers[question.question];
          const selected = Array.isArray(current) ? current.includes(option.value) : current === option.value;
          const choose = () => setAnswers((value) => {
            if (!question.multiSelect) return { ...value, [question.question]: option.value };
            const list = Array.isArray(value[question.question]) ? value[question.question] as string[] : [];
            return { ...value, [question.question]: selected ? list.filter((x) => x !== option.value) : [...list, option.value] };
          });
          return <Pressable key={option.value} onPress={choose} style={styles.answerOption}><Ionicons name={question.multiSelect ? (selected ? 'checkbox' : 'square-outline') : (selected ? 'radio-button-on' : 'radio-button-off')} color={selected ? colors.foreground : colors.dim} size={17} /><View style={styles.answerLabel}><Text>{option.label}</Text>{option.description ? <Text variant="muted" style={styles.answerDescription}>{option.description}</Text> : null}</View></Pressable>;
        })}
      </View>)}
      {questions.length === 0 ? <Input value={freeText} onChangeText={setFreeText} placeholder="输入回答" multiline style={styles.interactionInput} /> : null}
      <View style={styles.interactionButtons}>
        <Pressable disabled={busy} onPress={() => void submit({ action: 'cancel', reason: '用户取消' })} style={[styles.interactionButton, styles.denyButton]}><Text style={styles.interactionButtonText}>取消</Text></Pressable>
        <Pressable disabled={busy || (questions.length === 0 ? !freeText.trim() : questions.some((q) => !answers[q.question] || (Array.isArray(answers[q.question]) && answers[q.question].length === 0)))} onPress={() => void submit({ action: 'accept', content: questions.length ? { answers } : { answer: freeText.trim() } })} style={[styles.interactionButton, styles.approveButton]}><Text style={[styles.interactionButtonText, styles.approveText]}>提交</Text></Pressable>
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChatContent key={id} />;
}

function ChatContent() {
  const { colors, styles } = useChatTheme();
  const params = useLocalSearchParams<{ id: string; title?: string; workspacePath?: string; returnTo?: string; panel?: string }>();
  const rootNavigation = useNavigation<RootSessionNavigation>('/');
  const insets = useSafeAreaInsets();
  const panel = useSessionPanel(params.panel === 'settings', insets.top, insets.top + HEADER_EXPANDED_HEIGHT);
  const { back: backFromPanel } = panel;
  const returnTo = sessionList(params.returnTo);
  const sessionId = params.id;
  const entry = useSessionEntry((s) => s.entry?.id === sessionId ? s.entry : null);
  const returning = entry?.phase.startsWith('return-');
  const entering = entry && !returning;
  const messages = useApp((s) => s.chatCache[sessionId]?.messages ?? EMPTY);
  const stream = useApp((s) => s.streams[sessionId]);
  const running = useApp((s) => !!s.running[sessionId]);
  const providers = useApp((s) => s.providers);
  const pendingInteractions = useApp((s) => s.pendingInteractions);
  const interactions = useMemo(
    () => pendingInteractions.filter((x) => x.params.sessionId === sessionId),
    [pendingInteractions, sessionId]
  );
  const liveTitle = useApp((s) => s.sessions.find((x) => x.sessionId === sessionId)?.title);
  const cacheMessages = useApp((s) => s.cacheMessages);
  const appendLocalMessage = useApp((s) => s.appendLocalMessage);
  const setRunning = useApp((s) => s.setRunning);
  const refresh = useApp((s) => s.refresh);
  const [input, setInput] = useState(() => sessionViews.get(sessionId)?.input ?? '');
  const [attachments, setAttachments] = useState<Attachment[]>(() => sessionViews.get(sessionId)?.attachments ?? []);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [dismissedQuery, setDismissedQuery] = useState<string | null>(null);
  const menuVisible = addMenuOpen || (isSlashQuery(input) && dismissedQuery !== input);
  const closeComposerMenu = useCallback(() => { setAddMenuOpen(false); setDismissedQuery(input); }, [input]);
  const [busySend, setBusySend] = useState(false);
  const [composerHeight, setComposerHeight] = useState(COMPOSER_MIN_HEIGHT);
  const [composerPanelHeight, setComposerPanelHeight] = useState(76);
  const [headerOffset, setHeaderOffset] = useState(0);
  const [opening, setOpening] = useState(!useApp.getState().chatCache[sessionId]);
  const [openError, setOpenError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const connectionStatus = useApp((s) => s.status);
  const title = liveTitle || params.title || '';
  const [modelOpen, setModelOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState('');
  const [model, setModel] = useState<{ providerId?: string; modelId?: string }>(() => ({ modelId: sessionEntryModels.get(sessionId) }));
  useEffect(() => { if (model.modelId) sessionEntryModels.set(sessionId, model.modelId); }, [sessionId, model.modelId]);
  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<MessageListItem>>(null);
  const lastScrollOffset = useRef(sessionViews.get(sessionId)?.offset ?? 0);
  const restoreOffset = useRef(sessionViews.get(sessionId)?.offset ?? null);
  const chatLayout = useRef({ viewport: false, content: false, acknowledged: false, focused: false });
  const markChatLayout = useCallback((part: 'viewport' | 'content') => {
    chatLayout.current[part] = true;
    if (chatLayout.current.focused && chatLayout.current.viewport && chatLayout.current.content && !chatLayout.current.acknowledged) {
      chatLayout.current.acknowledged = true;
      acknowledgeSessionPage(sessionId);
    }
  }, [sessionId]);
  useFocusEffect(useCallback(() => {
    chatLayout.current.focused = true;
    if (chatLayout.current.content) markChatLayout('content');
    return () => { chatLayout.current.focused = false; };
  }, [markChatLayout]));
  const restoreReadingPosition = useCallback(() => {
    markChatLayout('content');
    const offset = restoreOffset.current;
    if (offset === null) return;
    restoreOffset.current = null;
    requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset, animated: false }));
  }, [markChatLayout]);
  useEffect(() => () => { sessionViews.set(sessionId, { input, attachments, offset: lastScrollOffset.current }); }, [sessionId, input, attachments]);
  const target = { id: sessionId, title, workspacePath: params.workspacePath ?? '', returnTo };
  useFocusEffect(useCallback(() => { useSessionNavigation.getState().remember({ id: sessionId, title, workspacePath: params.workspacePath ?? '', returnTo }); }, [sessionId, title, params.workspacePath, returnTo]));
  const horizontalNavigation = useSessionSwipe(
    undefined,
    () => router.dismissTo(listHref(returnTo)),
    { rightDrag: {
      begin: () => beginInteractiveReturn(sessionId, `/${returnTo}`),
      move: moveInteractiveReturn,
      release: (commit, gesture, done) => releaseInteractiveReturn(commit, gesture, () => router.dismissTo(listHref(returnTo)), done),
    }, canCapture: () => !menuVisible && panel.canReturnToList() },
  );
  const returnToList = horizontalNavigation.right;
  const returnToParent = useCallback(() => backFromPanel(() => {
    if (menuVisible) closeComposerMenu(); else returnToList();
  }), [backFromPanel, menuVisible, closeComposerMenu, returnToList]);
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      returnToParent();
      return true;
    });
    return () => subscription.remove();
  }, [returnToParent]));

  const keepLatestVisible = useCallback((animated = true) => {
    requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated }));
  }, []);

  useEffect(() => {
    const eventName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const subscription = Keyboard.addListener(eventName, (event) => {
      Keyboard.scheduleLayoutAnimation(event);
      keepLatestVisible(true);
    });
    return () => subscription.remove();
  }, [keepLatestVisible]);

  useFocusEffect(useCallback(() => {
    if (connectionStatus !== 'online') { setOpening(false); return; }
    const controller = new AbortController();
    setOpening(!useApp.getState().chatCache[sessionId]);
    setOpenError('');
    (async () => {
      try {
        const detail = await loadSession(sessionId, controller.signal);
        if (controller.signal.aborted) return;
        const loadedModel = detail.settings?.model?.current ?? detail.settings?.model ?? {};
        setModel({ providerId: loadedModel.providerId, modelId: loadedModel.modelId });
        cacheMessages(sessionId, parseSessionMessages(detail));
      } catch (error) {
        if (!controller.signal.aborted) setOpenError(`打开失败：${error instanceof Error ? error.message : error}`);
      } finally { if (!controller.signal.aborted) setOpening(false); }
    })();
    return () => controller.abort();
  // loadAttempt deliberately recreates the focused load after an explicit retry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, cacheMessages, connectionStatus, loadAttempt]));

  const display = useMemo(() => projectChatMessages(messages, running, stream), [messages, running, stream]);
  const displayRows = useMemo(() => display.map((msg, index) => ({
    msg,
    showAssistantHeader: msg.role === 'assistant' && display[index - 1]?.role !== 'assistant',
    joinsNextAssistant: msg.role === 'assistant' && display[index + 1]?.role === 'assistant',
  })), [display]);

  const pickAttachments = useCallback(async (images = false) => {
    closeComposerMenu();
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: images ? 'image/*' : '*/*', multiple: true, copyToCacheDirectory: true, base64: Platform.OS === 'web' });
      if (result.canceled) return;
      const room = Math.max(0, 3 - attachments.length);
      if (result.assets.length > room) Alert.alert('附件数量', '一次最多发送 3 个附件，多余文件未加入。');
      const next: Attachment[] = [];
      for (const asset of result.assets.slice(0, room)) {
        const size = asset.size ?? 0;
        if (size > 10 * 1024 * 1024) { Alert.alert('附件过大', `${asset.name} 超过 10 MB`); continue; }
        const dataBase64 = asset.base64 ?? await new ExpoFile(asset.uri).base64();
        next.push({ id: `${Date.now()}-${next.length}`, filename: asset.name, mimeType: asset.mimeType ?? 'application/octet-stream', sizeBytes: size || Math.floor(dataBase64.length * 0.75), dataBase64 });
      }
      setAttachments((current) => [...current, ...next]);
    } catch (error) { Alert.alert('无法读取附件', error instanceof Error ? error.message : String(error)); }
  }, [attachments.length, closeComposerMenu]);

  const sendContent = useCallback(async (content: string, files: Attachment[] = []) => {
    const trimmed = content.trim();
    if ((!trimmed && files.length === 0) || running || busySend) return;
    setInput(''); setComposerHeight(COMPOSER_MIN_HEIGHT); setAttachments([]);
    const localText = [trimmed, ...files.map((x) => `📎 ${x.filename}`)].filter(Boolean).join('\n');
    appendLocalMessage(sessionId, { key: `u${Date.now()}`, role: 'user', text: localText, local: true });
    setRunning(sessionId, true); setBusySend(true);
    keepLatestVisible(false);
    try { await gateway.request('gw.send', { sessionId, content: trimmed, attachments: files.map(({ id: _id, ...file }) => file) }); }
    catch (error) {
      appendLocalMessage(sessionId, { key: `e${Date.now()}`, role: 'assistant', text: `发送失败：${error instanceof Error ? error.message : error}`, failed: true, retryText: trimmed, retryAttachments: files.map(({ id: _id, ...file }) => file) });
      setRunning(sessionId, false);
    } finally { setBusySend(false); }
  }, [running, busySend, sessionId, appendLocalMessage, setRunning, keepLatestVisible]);

  const stopGeneration = useCallback(async () => {
    if (actionBusy === 'stop') return;
    setActionBusy('stop');
    try { await gateway.request('gw.stop', { sessionId }); }
    catch (error) { showToast(`停止失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setActionBusy(''); }
  }, [actionBusy, sessionId]);

  const resend = useCallback((msg: ChatMsg) => Alert.alert('再次发送', '把这条消息作为新的提问再次发送？', [{ text: '取消', style: 'cancel' }, { text: '发送', onPress: () => void sendContent(msg.text) }]), [sendContent]);
  const branchFrom = useCallback((assistant: ChatMsg) => {
    if (!assistant.messageId) return Alert.alert('无法开分支', '该条回复没有 ZCode 消息 ID。');
    Alert.alert('开分支', '将从这条回复创建独立会话，当前会话不变。', [{ text: '取消', style: 'cancel' }, { text: '创建分支', onPress: () => void (async () => {
      try {
        setActionBusy('branch');
        const result = await gateway.request<{ forkedSessionId?: string; session?: { sessionId?: string } }>('session/fork', { sessionId, target: { kind: 'message', messageId: assistant.messageId } });
        const forkedId = result.forkedSessionId ?? result.session?.sessionId;
        if (!forkedId) throw new Error('引擎未返回新分支 ID');
        void refresh().catch(() => {});
        replaceWithSession(rootNavigation, { id: forkedId, title: `${title || '会话'} · 分支`, workspacePath: params.workspacePath ?? '', returnTo });
      } catch (error) { Alert.alert('创建分支失败', error instanceof Error ? error.message : String(error)); }
      finally { setActionBusy(''); }
    })() }]);
  }, [params.workspacePath, refresh, sessionId, title, rootNavigation, returnTo]);

  const regenerate = useCallback((assistant: ChatMsg) => {
    if (running || actionBusy) return;
    if (!assistant.messageId) return Alert.alert('无法重新生成', '该条回复没有 ZCode 消息 ID。');
    Alert.alert('重新生成', '由 ZCode 重新执行该轮并生成新回复？', [{ text: '取消', style: 'cancel' }, { text: '重新生成', onPress: () => void (async () => {
      try {
        setActionBusy('regenerate');
        useApp.getState().beginRegeneration(sessionId, assistant.messageId!);
        await gateway.request('gw.retry', { sessionId, messageId: assistant.messageId });
      } catch (error) {
        useApp.getState().cancelRegeneration(sessionId);
        Alert.alert('重新生成失败', error instanceof Error ? error.message : String(error));
      } finally { setActionBusy(''); }
    })() }]);
  }, [sessionId, running, actionBusy]);

  const setSessionModel = async (providerId: string, modelId: string) => {
    const previous = model;
    setModel({ providerId, modelId });
    try {
      setActionBusy(`model-${providerId}-${modelId}`);
      await gateway.request('session/setModel', { sessionId, model: { providerId, modelId } });
      setModelOpen(false);
    }
    catch (error) { setModel(previous); showToast(`切换失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setActionBusy(''); }
  };

  const chat = (
    <AnimatedSafeAreaView style={[styles.safe, horizontalNavigation.animatedStyle, returning && { opacity: entryProgress }, entering && { opacity: entryProgress.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 0, 1], extrapolate: 'clamp' }) }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ChatBackground />
        <View pointerEvents="box-none" style={styles.header} {...horizontalNavigation.panHandlers}>
          <LinearGradient pointerEvents="none" colors={[withAlpha(colors.background, 1), withAlpha(colors.background, 0.96), withAlpha(colors.background, 0.72), withAlpha(colors.background, 0.32), withAlpha(colors.background, 0)]} locations={[0, 0.34, 0.58, 0.8, 1]} style={[styles.headerGradient, { transform: [{ translateY: -headerOffset }] }]} />
          <Pressable accessibilityLabel="返回会话列表" accessibilityRole="button" onPress={returnToParent} style={[styles.headerButton, styles.headerCircle, styles.headerBack]} hitSlop={8}><Ionicons name="chevron-back" color={colors.foreground} size={24} /></Pressable>
          <View pointerEvents={headerOffset >= HEADER_COLLAPSE_DISTANCE ? 'none' : 'auto'} style={[styles.headerCenter, { opacity: Math.max(0, 1 - headerOffset / 36), transform: [{ translateY: -headerOffset * 0.7 }] }]}>
            <View style={[styles.headerTitleRow, { maxWidth: '60%' }]}>
              <Text style={[styles.title, entering && entry.phase !== 'opening' && { opacity: 0 }]} numberOfLines={1}>{title || '会话'}</Text>
              {running ? <View style={styles.headerRunning}><ActivityIndicator color={colors.success} size={12} /><Text style={styles.headerRunningText}>回复中</Text></View> : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`切换模型，当前 ${model.modelId || 'GLM-5.3-Flash'}`} hitSlop={4} onPress={() => setModelOpen(true)} style={({ pressed }) => [styles.modelChip, pressed && styles.pressed]}>
              <Ionicons name="sparkles-outline" color={colors.mutedForeground} size={14} />
              <Text style={styles.modelChipText} numberOfLines={1}>{model.modelId || 'GLM-5.3-Flash'}</Text>
              <Ionicons name="chevron-down" color={colors.dim} size={13} />
            </Pressable>
            <Text variant="muted" style={styles.subtitle} numberOfLines={1}>{params.workspacePath ? baseName(params.workspacePath) : 'ZCode'}</Text>
          </View>
          <Pressable accessibilityLabel="新建会话" accessibilityRole="button" onPress={() => router.push({ pathname: '/new-session', params: { workspace: params.workspacePath ?? '', returnTo } })} style={[styles.headerButton, { right: 56 }]}><Ionicons name="create-outline" color={colors.foreground} size={22} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="会话设置" onPress={() => { closeComposerMenu(); panel.open(); }} style={[styles.headerButton, styles.headerCircle, styles.headerMenu]}><Ionicons name="ellipsis-horizontal" color={colors.foreground} size={22} /></Pressable>
        </View>
        <FlatList ref={listRef} onLayout={() => markChatLayout('viewport')} onContentSizeChange={restoreReadingPosition} contentOffset={{ x: 0, y: sessionViews.get(sessionId)?.offset ?? 0 }} data={[...displayRows].reverse()} inverted keyExtractor={(item) => item.msg.key} renderItem={({ item }) => <MessageRow {...item} onEdit={(msg) => { setInput(msg.text); setTimeout(() => { inputRef.current?.focus(); inputRef.current?.setNativeProps({ selection: { start: msg.text.length, end: msg.text.length } }); keepLatestVisible(true); }, 80); }} onResend={resend} onBranch={branchFrom} onRegenerate={regenerate} onRetry={(text, files) => void sendContent(text, files.map((file, index) => ({ ...file, id: `retry-${Date.now()}-${index}` })))} />} ListHeaderComponent={<View style={{ height: composerPanelHeight + spacing.sm }} />} ListFooterComponent={openError ? <Pressable accessibilityRole="button" accessibilityLabel="重新加载会话" onPress={() => setLoadAttempt(value => value + 1)} style={{ paddingVertical: 16 }}><Text variant="destructive" accessibilityLiveRegion="polite">{openError} · 点此重试</Text></Pressable> : null} ListEmptyComponent={opening ? <Text variant="muted" style={styles.loading}>加载会话…</Text> : connectionStatus !== 'online' ? <Text variant="muted" style={styles.loading}>电脑尚未连接</Text> : null} contentContainerStyle={styles.list} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" maintainVisibleContentPosition={{ minIndexForVisible: 0 }} onScroll={(event) => {
          const y = Math.max(0, event.nativeEvent.contentOffset.y);
          const delta = y - lastScrollOffset.current;
          lastScrollOffset.current = y;
          if (y <= 2) setHeaderOffset(0);
          else if (Math.abs(delta) >= 0.5) setHeaderOffset((current) => Math.min(HEADER_COLLAPSE_DISTANCE, Math.max(0, current - delta)));
        }} scrollEventThrottle={16} windowSize={7} initialNumToRender={15} maxToRenderPerBatch={15} />
        {interactions[0] ? <InteractionCard item={interactions[0]} /> : null}
        {menuVisible && <Pressable accessibilityLabel="关闭辅助菜单" onPress={closeComposerMenu} style={[StyleSheet.absoluteFill, { zIndex: 14 }]} />}
        <View onLayout={(event) => setComposerPanelHeight(Math.ceil(event.nativeEvent.layout.height))} style={styles.composerWrap}>
          {menuVisible && <ComposerMenu workspacePath={params.workspacePath} query={addMenuOpen ? '' : input.slice(1)} showUploads={addMenuOpen} uploadsDisabled={running || attachments.length >= 3} onPick={(images) => void pickAttachments(images)} onClose={closeComposerMenu} onSelect={(name) => {
            const next = insertCommand(input, name);
            setInput(next); setAddMenuOpen(false); setDismissedQuery(null);
            requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setNativeProps({ selection: { start: next.length, end: next.length } }); });
          }} />}
          {attachments.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attachments}>{attachments.map((file) => <View key={file.id} style={styles.attachmentChip}><Ionicons name={file.mimeType.startsWith('image/') ? 'image-outline' : 'document-outline'} color={colors.mutedForeground} size={16} /><View style={styles.attachmentText}><Text numberOfLines={1} style={styles.attachmentName}>{file.filename}</Text><Text variant="muted" style={styles.attachmentSize}>{humanBytes(file.sizeBytes)}</Text></View><Pressable accessibilityLabel={`移除 ${file.filename}`} onPress={() => setAttachments((list) => list.filter((x) => x.id !== file.id))} hitSlop={7}><Ionicons name="close" color={colors.dim} size={17} /></Pressable></View>)}</ScrollView> : null}
          <View style={styles.composer}>
            <Pressable accessibilityLabel="添加文件、图片或斜杠命令" accessibilityRole="button" accessibilityState={{ expanded: menuVisible }} onPress={() => { if (menuVisible) closeComposerMenu(); else setAddMenuOpen(true); }} style={({ pressed }) => [styles.attachButton, pressed && styles.pressed]}><Ionicons name={menuVisible ? 'close' : 'add'} color={colors.mutedForeground} size={23} /></Pressable>
            <Input
              ref={inputRef}
              value={input}
              onChangeText={(value) => { setInput(value); setDismissedQuery(null); setAddMenuOpen(false); }}
              onFocus={() => setTimeout(() => {
                inputRef.current?.setNativeProps({ selection: { start: input.length, end: input.length } });
                keepLatestVisible(true);
              }, 120)}
              onContentSizeChange={(event) => {
                const height = Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_MIN_HEIGHT, Math.ceil(event.nativeEvent.contentSize.height)));
                setComposerHeight(height);
                if (inputRef.current?.isFocused()) keepLatestVisible(false);
              }}
              placeholder="发消息给 ZCode…"
              multiline
              scrollEnabled={composerHeight >= COMPOSER_MAX_HEIGHT}
              textAlignVertical="top"
              style={[styles.input, { height: composerHeight }]}
            />
            <Pressable accessibilityLabel={running ? '停止生成' : '发送消息'} accessibilityRole="button" disabled={!running && ((!input.trim() && attachments.length === 0) || busySend)} onPress={running ? () => void stopGeneration() : () => void sendContent(input, attachments)} style={({ pressed }) => [styles.sendButton, running && styles.stopButton, !running && ((!input.trim() && attachments.length === 0) || busySend) && styles.sendDisabled, pressed && styles.pressed]}>{running ? <View style={styles.stopGlyph} /> : <Ionicons name="arrow-up" color={colors.primaryForeground} size={19} />}</Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
      <Modal visible={modelOpen} transparent animationType="slide" onRequestClose={() => setModelOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setModelOpen(false)} />
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleWrap}>
              <Text style={styles.sheetTitle}>选择模型</Text>
              <Text variant="muted" style={styles.sheetSubtitle}>仅影响当前会话</Text>
            </View>
            <Pressable accessibilityLabel="关闭模型选择" onPress={() => setModelOpen(false)} style={styles.headerButton}><Ionicons name="close" color={colors.foreground} size={22} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody}>
            {providers.map((provider) => (
              <View key={provider.providerId}>
                <Text variant="muted" style={styles.providerLabel}>{provider.label || provider.providerId}</Text>
                {provider.models.map((item) => {
                  const selected = model.providerId === provider.providerId && model.modelId === item.modelId;
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      key={`${provider.providerId}/${item.modelId}`}
                      disabled={!!actionBusy}
                      onPress={() => void setSessionModel(provider.providerId, item.modelId)}
                      style={({ pressed }) => [styles.modelRow, selected && styles.optionSelected, pressed && styles.pressed]}
                    >
                      <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} color={selected ? colors.foreground : colors.dim} size={18} />
                      <Text style={styles.modelName} numberOfLines={1}>{item.label || item.modelId}</Text>
                      {item.modelId.toLowerCase() === 'glm-5.3-flash' ? <Text variant="muted" style={styles.defaultLabel}>默认</Text> : null}
                      {actionBusy === `model-${provider.providerId}-${item.modelId}` ? <ActivityIndicator color={colors.dim} size={15} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}
            {providers.length === 0 ? <Text variant="muted" style={styles.noModels}>电脑端没有提供可用模型</Text> : null}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </AnimatedSafeAreaView>
  );
  return <SessionPages panel={panel} chat={chat} settings={<SessionSettings target={target} active={panel.showing && !panel.transitioning} onBack={panel.close} />} />;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, flex: { flex: 1 },
  header: { position: 'absolute', top: 0, left: 0, right: 0, height: HEADER_EXPANDED_HEIGHT, zIndex: 20 }, headerGradient: { position: 'absolute', top: 0, left: 0, right: 0, height: 156 }, headerButton: { position: 'absolute', top: 8, width: 48, height: 48, alignItems: 'center', justifyContent: 'center', zIndex: 3 }, headerBack: { left: spacing.sm }, headerMenu: { right: spacing.sm }, headerCircle: { borderRadius: 24, backgroundColor: withAlpha(colors.card, 0.92), borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong }, headerCenter: { position: 'absolute', top: 3, left: 68, right: 68, height: 106, alignItems: 'center', justifyContent: 'center', zIndex: 2 }, headerTitleRow: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 7 }, title: { flexShrink: 1, textAlign: 'center', fontSize: 16, fontWeight: '700' }, subtitle: { maxWidth: '100%', fontSize: 10, marginTop: 3 }, modelChip: { maxWidth: 220, minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 12, borderRadius: 18, backgroundColor: withAlpha(colors.card, 0.92), borderWidth: 1, borderColor: colors.border }, modelChipText: { flexShrink: 1, fontSize: 12, fontWeight: '600' }, headerRunning: { flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 7 }, headerRunningText: { color: colors.success, fontSize: 11, fontWeight: '600' },
  // The list is inverted: flex-end is the visual top, and paddingBottom
  // clears the fixed header above the first message.
  list: { flexGrow: 1, justifyContent: 'flex-end', paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: HEADER_EXPANDED_HEIGHT + spacing.md }, loading: { textAlign: 'center', marginTop: 40 },
  userWrap: { alignSelf: 'flex-end', alignItems: 'flex-end', maxWidth: '86%', marginBottom: spacing.xl }, user: { backgroundColor: colors.userBubble, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong, borderRadius: radius.xl, borderBottomRightRadius: 6, paddingHorizontal: 14, paddingVertical: 10 }, userText: { color: colors.foreground, fontSize: 15, lineHeight: 22 }, userActions: { flexDirection: 'row', gap: 14, paddingTop: 5, paddingRight: 3 }, miniAction: { fontSize: 11 },
  assistant: { width: '100%', alignSelf: 'flex-start', marginBottom: 28 }, assistantJoined: { marginBottom: 10 }, assistantHead: { height: 26, flexDirection: 'row', alignItems: 'center', marginBottom: 8 }, aiMark: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised, borderRadius: 7, marginRight: 7 }, aiLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2 }, streamingLabel: { flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 9 }, streamingText: { fontSize: 11 },
  typingDots: { height: 30, flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 2 }, typingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.mutedForeground },
  think: { backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.md, marginBottom: spacing.md, overflow: 'hidden' }, thinkToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10 }, thinkTitle: { fontSize: 12, fontWeight: '600' }, thinkText: { fontSize: 13, lineHeight: 20, paddingHorizontal: 12, paddingBottom: 11 },
  toolCard: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.md, marginBottom: 8, overflow: 'hidden' }, toolCardFailed: { borderColor: colors.destructive }, toolHead: { minHeight: 50, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9 }, toolTitleWrap: { flex: 1 }, toolTitle: { fontSize: 13, fontWeight: '600' }, toolStatus: { fontSize: 11, marginTop: 1 }, toolDetail: { fontSize: 11, lineHeight: 17, padding: 12, paddingTop: 0, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) },
  cursor: { width: 7, height: 17, borderRadius: 2, backgroundColor: colors.mutedForeground, marginTop: -8 }, messageActions: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: -5 }, messageAction: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 2 }, messageActionText: { fontSize: 12 },
  interaction: { marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.lg, backgroundColor: colors.surfaceRaised }, interactionHead: { flexDirection: 'row', gap: 10 }, interactionTitleWrap: { flex: 1 }, interactionTitle: { fontWeight: '700', fontSize: 14 }, interactionReason: { fontSize: 12, lineHeight: 18, marginTop: 3 }, interactionButtons: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, marginTop: 12 }, interactionButton: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 13, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, backgroundColor: colors.secondary }, denyButton: { backgroundColor: 'transparent' }, approveButton: { backgroundColor: colors.primary }, interactionButtonText: { fontSize: 12, fontWeight: '600' }, approveText: { color: colors.primaryForeground }, question: { marginTop: 12 }, questionText: { fontSize: 13, fontWeight: '600', marginBottom: 5 }, answerOption: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }, answerLabel: { flex: 1 }, answerDescription: { fontSize: 11, marginTop: 2 }, interactionInput: { height: 74, paddingTop: 10, marginTop: 10, textAlignVertical: 'top' },
  composerWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 15, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm }, attachments: { gap: 8, paddingBottom: 8 }, attachmentChip: { width: 190, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, attachmentText: { flex: 1 }, attachmentName: { fontSize: 12 }, attachmentSize: { fontSize: 10, marginTop: 1 }, composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, padding: 5, backgroundColor: withAlpha(colors.card, 0.94), borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 24 }, attachButton: { width: 39, height: 44, alignItems: 'center', justifyContent: 'center' }, input: { flex: 1, minHeight: COMPOSER_MIN_HEIGHT, maxHeight: COMPOSER_MAX_HEIGHT, paddingTop: 10, paddingBottom: 10, paddingHorizontal: 3, borderWidth: 0, backgroundColor: 'transparent', fontSize: 16, lineHeight: 22 }, sendButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary }, stopButton: { backgroundColor: colors.foreground, borderWidth: 0 }, stopGlyph: { width: 13, height: 13, borderRadius: 2, backgroundColor: colors.primaryForeground }, sendDisabled: { opacity: 0.28 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.58)' }, fullSettings: { flex: 1, backgroundColor: colors.background }, fullSettingsHeader: { minHeight: 64, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, fullSettingsBack: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }, sheet: { maxHeight: '86%', backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: colors.borderStrong }, sheetHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center', marginTop: 8 }, sheetHeader: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, sheetTitleWrap: { flex: 1, paddingVertical: 10 }, sheetTitle: { fontSize: 18, fontWeight: '700' }, sheetTitleFlex: { flex: 1 }, sheetSubtitle: { fontSize: 11, marginTop: 2 }, sheetBody: { padding: spacing.lg, paddingBottom: 34 }, sectionLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 12, marginBottom: 7 }, optionRow: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 10, gap: 10, borderRadius: radius.md }, optionSelected: { backgroundColor: colors.surfaceRaised }, optionText: { flex: 1 }, optionHint: { fontSize: 11, marginTop: 2 }, providerLabel: { fontSize: 11, marginTop: 7, marginBottom: 3, paddingHorizontal: 10 }, modelRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, borderRadius: radius.md }, modelName: { flex: 1, fontSize: 13 }, defaultLabel: { fontSize: 10, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: 6, paddingVertical: 2 }, noModels: { paddingVertical: 32, textAlign: 'center' }, manageRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, manageText: { flex: 1, fontSize: 14 }, pressed: { opacity: 0.62 },
  });
}
