import type { PluginHostProps } from "@getpaseo/plugin/client";
import { useAgent, useRpc } from "@getpaseo/plugin/client";
import {
  copyText,
  Icon,
  ScrollView,
  TextInput,
  useRevealedText,
  useToast,
} from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  type ScrollView as NativeScrollView,
  Text,
  type TextInput as NativeTextInput,
  View,
} from "react-native";
import {
  askRpc,
  clearRpc,
  isActive,
  MAX_QUESTION_CHARS,
  readableError,
  stopRpc,
  threadRpc,
  type Exchange,
  type Thread,
} from "../shared/contracts";
import { useBottomClearance } from "./keyboard";
import { MarkdownText } from "./markdown";
import { quoteBlock, rememberAgent, setQuoteButtonColors, subscribeQuotes } from "./quote-store";
import { ASIDE_ROOT_ID } from "./web";

export interface AsideViewProps extends PluginHostProps {
  agentId: string;
}

export const threadQueryKey = (hostId: string, agentId: string) => ["ask-aside", "thread", hostId, agentId] as const;

const LINE_HEIGHT = 20;
const MAX_INPUT_LINES = 7;

type Colors = PluginHostProps["theme"]["colors"];

export function AsideView({ theme, layout, host, agentId }: AsideViewProps) {
  const agent = useAgent(agentId, ({ title, status, requiresAttention }) => ({ title, status, requiresAttention }));
  const getThread = useRpc(threadRpc);
  const ask = useRpc(askRpc);
  const stop = useRpc(stopRpc);
  const clear = useRpc(clearRpc);
  const toast = useToast();
  const queryClient = useQueryClient();
  const queryKey = threadQueryKey(host.id, agentId);

  const thread = useQuery({
    queryKey,
    queryFn: async () => {
      const next = await getThread({ agentId });
      // A poll that left before a newer Ask, Stop or Clear reply must not undo it.
      // Only a poll may switch to a restarted plugin: a late Ask, Stop or Clear reply from the
      // old one must not bring its history back.
      const cached = queryClient.getQueryData<Thread>(queryKey);
      return !cached || cached.instance !== next.instance || isNewer(cached, next) ? next : cached;
    },
    // Poll fast while an answer streams; slowly otherwise so a question sent with /btw shows up in an open panel.
    refetchInterval: (query) => (query.state.data?.exchanges.some((exchange) => isActive(exchange.status)) ? 400 : 2000),
  });
  const setThread = (next: Thread) => {
    if (isNewer(queryClient.getQueryData<Thread>(queryKey), next)) queryClient.setQueryData(queryKey, next);
  };
  const beforeMutation = () => queryClient.cancelQueries({ queryKey });

  const [draft, setDraft] = useState("");
  // Why a /btw question landed in the box instead of being asked.
  const [notice, setNotice] = useState<string | null>(null);
  const [inputWidth, setInputWidth] = useState(0);
  const askMutation = useMutation({
    onMutate: beforeMutation,
    // One request ID per question, reused if the call is retried after a dropped connection.
    mutationFn: (variables: { question: string; requestId: string }) => ask({ agentId, ...variables }),
    onSuccess: (next) => {
      setThread(next);
      setDraft("");
      setNotice(null);
    },
  });
  const stopMutation = useMutation({
    onMutate: beforeMutation,
    mutationFn: (exchangeId: string | undefined) => stop({ agentId, exchangeId }),
    onSuccess: setThread,
  });
  const clearMutation = useMutation({ onMutate: beforeMutation, mutationFn: () => clear({ agentId }), onSuccess: setThread });

  const exchanges = thread.data?.exchanges ?? [];
  const activeExchange = exchanges.find((exchange) => isActive(exchange.status));
  const busy = activeExchange !== undefined;
  const latest = exchanges[exchanges.length - 1];
  const tooLong = draft.trim().length > MAX_QUESTION_CHARS;
  const canSend = draft.trim().length > 0 && !tooLong && !busy && !askMutation.isPending;

  const inputRef = useRef<NativeTextInput>(null);
  // Text selected elsewhere with "Ask aside" lands here as a quote above the draft, and a
  // /btw question the daemon turned down comes back as the draft.
  useEffect(
    () =>
      subscribeQuotes(agentId, (insert) => {
        if (insert.kind === "quote") {
          setDraft((previous) => `${quoteBlock(insert.text)}\n\n${previous.trimStart()}`);
        } else {
          setDraft((previous) => (previous.trim() ? `${previous.trimEnd()}\n\n${insert.text}` : insert.text));
          setNotice(insert.error);
        }
        setTimeout(() => inputRef.current?.focus(), 0);
      }),
    [agentId],
  );
  useEffect(() => rememberAgent(agentId), [agentId]);
  useEffect(() => {
    setQuoteButtonColors({ background: theme.colors.surface2, foreground: theme.colors.foreground, border: theme.colors.border });
  }, [theme]);

  // Follow a streaming answer only while the reader is at the bottom, so scrolling up to
  // reread an earlier answer is not interrupted.
  const scrollRef = useRef<NativeScrollView>(null);
  const atBottom = useRef(true);
  // On phones the keyboard or the home indicator would cover the question box: pad the panel
  // clear of them, and keep the newest answer in view if the reader was already at the end.
  const rootRef = useRef<View>(null);
  const { padding: bottomClearance, remeasure: remeasureBottom } = useBottomClearance(rootRef);
  useEffect(() => {
    if (bottomClearance > 0 && atBottom.current) scrollRef.current?.scrollToEnd({ animated: true });
  }, [bottomClearance]);
  const latestAnswerLength = latest?.answer.length ?? 0;
  useEffect(() => {
    if (atBottom.current) scrollRef.current?.scrollToEnd({ animated: false });
  }, [latestAnswerLength]);
  // Shown after scrolling up, like Paseo's chat.
  const [showJump, setShowJump] = useState(false);
  useEffect(() => {
    atBottom.current = true;
    setShowJump(false);
    scrollRef.current?.scrollToEnd({ animated: false });
  }, [exchanges.length]);
  const jumpToLatest = () => {
    atBottom.current = true;
    setShowJump(false);
    scrollRef.current?.scrollToEnd({ animated: true });
  };
  const [focused, setFocused] = useState(false);

  const now = useNow(30_000);
  // Success shows as a check on the button itself, like Paseo's message actions; only failures toast.
  const copy = async (text: string): Promise<boolean> => {
    try {
      await copyText(text);
      return true;
    } catch {
      toast.error("Could not copy. Select the text and copy it instead.");
      return false;
    }
  };

  const submit = () => {
    if (!canSend) return;
    askMutation.mutate({ question: draft.trim(), requestId: newRequestId() });
  };

  const styles = useMemo(() => createStyles(theme.colors, layout.compact), [theme, layout.compact]);
  const mutationError = askMutation.error ?? stopMutation.error ?? clearMutation.error ?? thread.error;
  const composerError = tooLong
    ? `Questions can be at most ${MAX_QUESTION_CHARS.toLocaleString("en-US")} characters; this one has ${draft.trim().length.toLocaleString("en-US")}.`
    : mutationError
      ? errorMessage(mutationError)
      : notice;
  const muted = theme.colors.foregroundMuted;

  return (
    <View
      ref={rootRef}
      style={[styles.root, { paddingBottom: bottomClearance }]}
      nativeID={ASIDE_ROOT_ID}
      onLayout={remeasureBottom}
    >
      <View style={styles.header}>
        <Icon name="MessageCircle" size={16} color={muted} />
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {agent?.title ?? "Ask Aside"}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {describeAgentStatus(agent?.status, agent?.requiresAttention)} · read-only side questions
          </Text>
        </View>
        {exchanges.length > 0 ? (
          <IconButton
            icon="Trash2"
            label="Clear side questions"
            color={muted}
            disabled={clearMutation.isPending}
            onPress={() => clearMutation.mutate()}
            styles={styles}
          />
        ) : null}
      </View>

      <View style={styles.scrollArea}>
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={100}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            atBottom.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 48;
            setShowJump(!atBottom.current);
          }}
        >
          {thread.isLoading ? <ActivityIndicator color={muted} /> : null}
          {!thread.isLoading && exchanges.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>Ask without interrupting</Text>
              <Text style={styles.empty}>
                Why did the agent pick this approach? What was that file called? What does this error mean? Answers come
                from the conversation so far. The agent keeps working and never sees the question.
              </Text>
              {Platform.OS === "web" ? (
                <Text style={styles.empty}>Tip: select text anywhere in the chat and press Ask aside to quote it here.</Text>
              ) : null}
            </View>
          ) : null}
          {exchanges.map((exchange) => (
            <ExchangeView key={exchange.id} exchange={exchange} styles={styles} theme={theme} now={now} onCopy={copy} />
          ))}
        </ScrollView>
        {showJump ? (
          // Like Paseo's chat: after scrolling up, one tap returns to the newest answer.
          <View pointerEvents="box-none" style={styles.jumpLayer}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Scroll to latest"
              {...(Platform.OS === "web" ? ({ title: "Scroll to latest" } as object) : {})}
              hitSlop={8}
              onPress={jumpToLatest}
              style={({ pressed }) => [styles.jumpButton, pressed && styles.pressed]}
            >
              <Icon name="ChevronDown" size={layout.compact ? 20 : 18} color={theme.colors.foreground} />
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={styles.composerArea}>
        {composerError ? <Text style={styles.composerError}>{composerError}</Text> : null}
        <View style={[styles.composer, focused && styles.composerFocused]}>
          <TextInput
            ref={inputRef}
            style={[styles.input, { height: inputLines(draft, inputWidth, layout.compact ? 16 : 13) * LINE_HEIGHT }]}
            value={draft}
            onChangeText={setDraft}
            placeholder={busy ? "Answering..." : "Ask a side question..."}
            placeholderTextColor={muted}
            multiline
            editable={!askMutation.isPending}
            accessibilityLabel="Side question"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onLayout={(event) => setInputWidth(event.nativeEvent.layout.width)}
            onKeyPress={(event) => {
              // On web, Enter sends and Shift+Enter adds a line; IME composition is left alone.
              const native = event.nativeEvent as { key: string; shiftKey?: boolean; isComposing?: boolean };
              if (Platform.OS === "web" && native.key === "Enter" && !native.shiftKey && !native.isComposing) {
                (event as unknown as { preventDefault?: () => void }).preventDefault?.();
                submit();
              }
            }}
          />
          {busy ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stop answer"
              hitSlop={6}
              style={({ pressed }) => [styles.sendButton, styles.sendButtonActive, pressed && styles.pressed]}
              disabled={stopMutation.isPending}
              onPress={() => stopMutation.mutate(activeExchange?.id)}
            >
              <Icon name="Square" size={11} color={theme.colors.surface0} />
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Ask"
              hitSlop={6}
              style={({ pressed }) => [styles.sendButton, canSend && styles.sendButtonActive, pressed && styles.pressed]}
              disabled={!canSend}
              onPress={submit}
            >
              <Icon name="ArrowUp" size={16} color={canSend ? theme.colors.surface0 : muted} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

function ExchangeView({
  exchange,
  styles,
  theme,
  now,
  onCopy,
}: {
  exchange: Exchange;
  styles: Styles;
  theme: PluginHostProps["theme"];
  now: number;
  onCopy(text: string): Promise<boolean>;
}) {
  const active = isActive(exchange.status);
  const answer = useRevealedText(exchange.answer, active ? "streaming" : "complete");
  const pending = active && !exchange.answer;
  const muted = theme.colors.foregroundMuted;

  return (
    <View style={styles.exchange}>
      <View style={styles.questionGroup}>
        <View style={styles.question}>
          <MarkdownText theme={theme} compact>
            {exchange.question}
          </MarkdownText>
        </View>
        <View style={[styles.actions, styles.actionsEnd]}>
          <CopyButton label="Copy question" text={exchange.question} onCopy={onCopy} theme={theme} styles={styles} />
          <Text style={styles.meta}>{timeAgo(exchange.askedAt, now)}</Text>
        </View>
      </View>

      <View style={styles.answerGroup}>
        {pending ? (
          <View style={styles.pendingRow}>
            <ActivityIndicator size="small" color={muted} />
            <Text style={styles.meta}>{exchange.status === "queued" ? "Reading the conversation..." : "Thinking..."}</Text>
          </View>
        ) : null}
        {exchange.activity.length ? <ActivityView commands={exchange.activity} active={active} styles={styles} theme={theme} /> : null}
        {answer ? <MarkdownText theme={theme}>{answer}</MarkdownText> : null}
        {exchange.status === "error" && exchange.error ? (
          <View style={styles.notice}>
            <Icon name="CircleAlert" size={14} color={theme.colors.statusDanger} />
            <Text style={styles.error}>{exchange.error}</Text>
          </View>
        ) : null}
        {exchange.status === "stopped" ? <Text style={styles.meta}>Stopped.</Text> : null}
        {!active ? (
          <View style={styles.actions}>
            {exchange.answer ? (
              <CopyButton
                label="Copy answer as Markdown"
                text={exchange.answer}
                onCopy={onCopy}
                theme={theme}
                styles={styles}
              />
            ) : null}
            <Text style={styles.meta} numberOfLines={1}>
              {describeExchange(exchange)}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Commands Codex ran to read files: the latest while answering, all of them on request afterwards. */
function ActivityView({
  commands,
  active,
  styles,
  theme,
}: {
  commands: string[];
  active: boolean;
  styles: Styles;
  theme: PluginHostProps["theme"];
}) {
  const [open, setOpen] = useState(false);
  const muted = theme.colors.foregroundMuted;
  const label = commands.length === 1 ? "Ran 1 read-only command" : `Ran ${commands.length} read-only commands`;
  const shown = active ? commands.slice(-1) : open ? commands : [];
  return (
    <View style={styles.activity}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        disabled={active}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [styles.activityToggle, pressed && styles.pressed]}
      >
        <Icon name={active || open ? "ChevronDown" : "ChevronRight"} size={12} color={muted} />
        <Text style={styles.meta}>{label}</Text>
      </Pressable>
      {shown.map((command, index) => (
        <Text key={index} style={styles.command} numberOfLines={active ? 1 : 3}>
          {command}
        </Text>
      ))}
    </View>
  );
}

const COPIED_MS = 1_500;

function CopyButton({
  label,
  text,
  onCopy,
  theme,
  styles,
}: {
  label: string;
  text: string;
  onCopy(text: string): Promise<boolean>;
  theme: PluginHostProps["theme"];
  styles: Styles;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <IconButton
      icon={copied ? "Check" : "Copy"}
      label={copied ? "Copied" : label}
      color={copied ? theme.colors.statusSuccess : theme.colors.foregroundMuted}
      onPress={() => {
        void onCopy(text).then((ok) => {
          if (!ok) return;
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), COPIED_MS);
        });
      }}
      styles={styles}
    />
  );
}

function IconButton({
  icon,
  label,
  color,
  disabled,
  onPress,
  styles,
}: {
  icon: string;
  label: string;
  color: string;
  disabled?: boolean;
  onPress(): void;
  styles: Styles;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      // Web shows the label as a tooltip.
      {...(Platform.OS === "web" ? ({ title: label } as object) : {})}
      hitSlop={8}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, (pressed || disabled) && styles.pressed]}
    >
      <Icon name={icon} size={14} color={color} />
    </Pressable>
  );
}

/** Re-renders periodically so relative times stay current. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function timeAgo(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(seconds) || seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/**
 * Lines the draft needs at the input's width, from one up to MAX_INPUT_LINES. Measured from
 * the text rather than the field's content size, which the web textarea reports unreliably.
 */
function inputLines(text: string, width: number, fontSize: number): number {
  const perLine = width > 0 ? Math.max(8, Math.floor(width / (fontSize * 0.56))) : 60;
  let lines = 0;
  for (const line of text.split("\n")) lines += Math.max(1, Math.ceil(line.length / perLine));
  return Math.min(MAX_INPUT_LINES, Math.max(1, lines));
}

/** Revisions only compare within one run of the plugin; a restart starts them from zero. */
function isNewer(cached: Thread | undefined, next: Thread): boolean {
  return !cached || (cached.instance === next.instance && next.revision >= cached.revision);
}

function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function describeAgentStatus(status: string | undefined, requiresAttention: boolean | undefined): string {
  if (requiresAttention) return "Agent needs attention";
  switch (status) {
    case "running":
      return "Agent working";
    case "idle":
      return "Agent idle";
    case "initializing":
      return "Agent starting";
    case "error":
      return "Agent stopped with an error";
    case "closed":
      return "Agent closed";
    default:
      return "Agent";
  }
}

function describeExchange(exchange: Exchange): string {
  const parts: string[] = [];
  if (exchange.backend === "codex") parts.push("Codex, read-only");
  if (exchange.model) parts.push(exchange.model);
  const context = exchange.context;
  if (context) {
    const size = context.chars >= 1000 ? `${Math.round(context.chars / 1000)}k chars` : `${context.chars} chars`;
    parts.push(
      context.truncated
        ? `${context.includedItems}/${context.totalItems} items · ${size}`
        : `${context.totalItems} items · ${size}`,
    );
  }
  return parts.join(" · ");
}

function errorMessage(error: unknown): string {
  return readableError(error instanceof Error ? error.message : String(error));
}

type Styles = ReturnType<typeof createStyles>;

function createStyles(colors: Colors, compact: boolean) {
  const pad = compact ? 12 : 16;
  // Removes the browser focus ring; React Native ignores the key.
  const noOutline = Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : {};
  return {
    root: { flex: 1, backgroundColor: colors.surface0 },
    header: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
      paddingHorizontal: pad,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerText: { flex: 1, gap: 2 },
    title: { color: colors.foreground, fontSize: 13, fontWeight: "600" as const },
    subtitle: { color: colors.foregroundMuted, fontSize: 11 },
    iconButton: { padding: 4, borderRadius: 6 },
    pressed: { opacity: 0.5 },
    scrollArea: { flex: 1 },
    scroll: { flex: 1 },
    jumpLayer: {
      position: "absolute" as const,
      left: 0,
      right: 0,
      bottom: 12,
      alignItems: "center" as const,
    },
    jumpButton: {
      width: compact ? 40 : 34,
      height: compact ? 40 : 34,
      borderRadius: compact ? 20 : 17,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      backgroundColor: colors.surface2,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: "#000",
      shadowOpacity: 0.25,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 4,
    },
    scrollContent: { padding: pad, gap: 24 },
    emptyBox: { gap: 8, paddingTop: 8 },
    emptyTitle: { color: colors.foreground, fontSize: 13, fontWeight: "600" as const },
    empty: { color: colors.foregroundMuted, fontSize: 13, lineHeight: 20 },
    exchange: { gap: 14 },
    questionGroup: { alignItems: "flex-end" as const, gap: 4 },
    question: {
      maxWidth: compact ? ("92%" as const) : ("85%" as const),
      backgroundColor: colors.surface2,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 9,
    },
    answerGroup: { gap: 6 },
    actions: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, minHeight: 22 },
    actionsEnd: { justifyContent: "flex-end" as const },
    pendingRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    notice: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 6 },
    meta: { color: colors.foregroundMuted, fontSize: 11, flexShrink: 1 },
    error: { color: colors.statusDanger, fontSize: 13, lineHeight: 20, flexShrink: 1 },
    activity: { gap: 4 },
    activityToggle: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4, alignSelf: "flex-start" as const },
    command: {
      color: colors.foregroundMuted,
      fontSize: 11,
      lineHeight: 16,
      fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
      paddingLeft: 16,
    },
    composerArea: { paddingHorizontal: pad, paddingTop: 6, paddingBottom: compact ? 10 : 12, gap: 6 },
    composerError: { color: colors.statusDanger, fontSize: 12 },
    composerFocused: { borderColor: colors.accent },
    composer: {
      flexDirection: "row" as const,
      alignItems: "flex-end" as const,
      gap: 8,
      backgroundColor: colors.surface1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingLeft: 12,
      paddingRight: 6,
      paddingVertical: 6,
    },
    input: {
      flex: 1,
      color: colors.foreground,
      // 16px on phones stops iOS from zooming into the field.
      fontSize: compact ? 16 : 13,
      lineHeight: LINE_HEIGHT,
      // Centres one line against the 28px button.
      marginVertical: 4,
      padding: 0,
      textAlignVertical: "top" as const,
      ...noOutline,
    },
    sendButton: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    sendButtonActive: { backgroundColor: colors.foreground },
  };
}
