// Builds a bounded, plain-text transcript of an agent's Paseo timeline.
// Kept free of SDK runtime imports so it can be unit tested directly.

export interface TimelineEntryLike {
  timestamp?: string;
  seqStart?: number;
  item: { readonly type: string };
}

type TimelineItem = { readonly type: string; readonly [key: string]: unknown };

export interface TranscriptOptions {
  maxChars: number;
  maxMessageChars: number;
  maxDetailChars: number;
}

export interface Transcript {
  text: string;
  totalItems: number;
  includedItems: number;
  truncated: boolean;
}

export const DEFAULT_TRANSCRIPT_OPTIONS: TranscriptOptions = {
  maxChars: 100_000,
  maxMessageChars: 8_000,
  maxDetailChars: 2_000,
};

type BlockKind = "conversation" | "detail";

interface Block {
  index: number;
  kind: BlockKind;
  text: string;
}

const OMITTED_MARKER = "characters omitted ...]";
/** Item type of the marker placed where unread history was skipped. */
export const HISTORY_GAP = "ask_aside_history_gap";
// Room for the "[N earlier items omitted]" lines added between kept blocks.
const MARKER_RESERVE_RATIO = 0.05;

export function buildTranscript(
  entries: readonly TimelineEntryLike[],
  options: TranscriptOptions = DEFAULT_TRANSCRIPT_OPTIONS,
): Transcript {
  const blocks: Block[] = [];
  for (const entry of entries) {
    const block = toBlock(entry, blocks.length, options);
    if (block) blocks.push(block);
  }

  // Keep the original request, then the newest conversation, then the newest tool and reasoning detail.
  const selected = new Set<number>();
  let budget = options.maxChars - Math.min(2_000, Math.floor(options.maxChars * MARKER_RESERVE_RATIO));
  const take = (block: Block): boolean => {
    const cost = block.text.length + 2;
    if (cost > budget) return false;
    selected.add(block.index);
    budget -= cost;
    return true;
  };

  const conversation = blocks.filter((block) => block.kind === "conversation");
  const details = blocks.filter((block) => block.kind === "detail");
  if (conversation[0]) take(conversation[0]);
  for (let i = conversation.length - 1; i >= 1; i--) {
    if (!take(conversation[i]!)) break;
  }
  for (let i = details.length - 1; i >= 0; i--) {
    take(details[i]!);
  }

  const parts: string[] = [];
  let previous = -1;
  for (const block of blocks) {
    if (!selected.has(block.index)) continue;
    const skipped = block.index - previous - 1;
    if (skipped > 0) parts.push(`[${skipped} earlier item${skipped === 1 ? "" : "s"} omitted]`);
    parts.push(block.text);
    previous = block.index;
  }
  const trailing = blocks.length - previous - 1;
  if (trailing > 0) parts.push(`[${trailing} later item${trailing === 1 ? "" : "s"} omitted]`);

  const shortened = blocks.some((block) => selected.has(block.index) && block.text.includes(OMITTED_MARKER));
  return {
    text: parts.join("\n\n"),
    totalItems: blocks.length,
    includedItems: selected.size,
    truncated: selected.size < blocks.length || shortened,
  };
}

function toBlock(entry: TimelineEntryLike, index: number, options: TranscriptOptions): Block | null {
  const item = entry.item as TimelineItem;
  const message = (label: string, text: unknown): Block | null => {
    const body = asText(text).trim();
    if (!body) return null;
    return { index, kind: "conversation", text: `${label}:\n${clip(body, options.maxMessageChars)}` };
  };
  const detail = (label: string, text: string): Block => ({
    index,
    kind: "detail",
    text: clip(`${label}\n${text}`.trim(), options.maxDetailChars),
  });

  switch (item.type) {
    case "user_message":
      return message("USER", item.text);
    case "assistant_message":
      return message("ASSISTANT", item.text);
    case "reasoning": {
      const text = asText(item.text).trim();
      return text ? detail("ASSISTANT THINKING:", text) : null;
    }
    case "tool_call":
      return toolCallBlock(item, index, options);
    case "todo":
      return detail("TASK LIST:", todoText(item.items));
    case "error":
      return message("ERROR", item.message);
    case "notification":
      return message(`NOTICE (${asText(item.level) || "info"})`, item.message);
    case "compaction":
      return asText(item.status) === "completed"
        ? { index, kind: "conversation", text: "[The agent's context was compacted here.]" }
        : null;
    case HISTORY_GAP:
      // Added by Ask Aside between the start of a long session and its newest part.
      return { index, kind: "conversation", text: "[The middle of this session was not read.]" };
    default:
      // Plugin rows and unknown future item types are not part of the conversation.
      return null;
  }
}

function toolCallBlock(
  item: TimelineItem,
  index: number,
  options: TranscriptOptions,
): Block | null {
  const agentMessage = asRecord(item.agentMessage);
  if (agentMessage) {
    const sender = asRecord(agentMessage.sender);
    const from = asText(sender?.title) || asText(sender?.id) || "another agent";
    const text = asText(agentMessage.text).trim();
    if (!text) return null;
    return {
      index,
      kind: "conversation",
      text: `MESSAGE FROM AGENT "${from}":\n${clip(text, options.maxMessageChars)}`,
    };
  }

  const status = asText(item.status) || "unknown";
  const statusLabel = status === "running" ? "still running" : status;
  const name = asText(item.name) || "tool";
  const detail = asRecord(item.detail) ?? {};
  const lines = describeToolDetail(detail);
  if (status === "failed" && item.error != null) lines.push(`error: ${asText(item.error) || stringify(item.error)}`);
  const header = `TOOL CALL ${name} (${statusLabel})`;
  return {
    index,
    kind: "detail",
    text: clip([header, ...lines].join("\n"), options.maxDetailChars),
  };
}

function describeToolDetail(detail: Record<string, unknown>): string[] {
  const out: string[] = [];
  const add = (label: string, value: unknown) => {
    const text = asText(value).trim();
    if (text) out.push(`${label}: ${text}`);
  };
  switch (asText(detail.type)) {
    case "shell":
      add("command", detail.command);
      if (typeof detail.exitCode === "number") out.push(`exit code: ${detail.exitCode}`);
      add("output", detail.output);
      break;
    case "read":
      add("file", detail.filePath);
      add("content", detail.content);
      break;
    case "edit":
      add("file", detail.filePath);
      add("diff", detail.unifiedDiff ?? (detail.newString != null ? `- ${asText(detail.oldString)}\n+ ${asText(detail.newString)}` : ""));
      break;
    case "write":
      add("file", detail.filePath);
      add("content", detail.content);
      break;
    case "search":
      add("query", detail.query);
      add("result", detail.content ?? (Array.isArray(detail.filePaths) ? detail.filePaths.join("\n") : ""));
      if (Array.isArray(detail.webResults)) {
        add(
          "web results",
          detail.webResults
            .map((raw) => {
              const result = asRecord(raw) ?? {};
              return [asText(result.title), asText(result.url)].filter(Boolean).join(" - ");
            })
            .filter(Boolean)
            .join("\n"),
        );
      }
      break;
    case "fetch":
      add("url", detail.url);
      add("result", detail.result);
      break;
    case "sub_agent":
      add("task", detail.description);
      add("log", detail.log);
      break;
    case "plain_text":
      add(asText(detail.label) || "text", detail.text);
      break;
    case "plan":
      add("plan", detail.text);
      break;
    case "worktree_setup":
      add("worktree", detail.worktreePath);
      add("log", detail.log);
      break;
    default:
      if (detail.input !== undefined) add("input", stringify(detail.input));
      if (detail.output !== undefined) add("output", stringify(detail.output));
  }
  return out;
}

function todoText(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return items
    .map((raw) => {
      const todo = asRecord(raw) ?? {};
      const done = todo.completed === true || todo.status === "completed";
      const mark = done ? "x" : todo.status === "in_progress" ? "~" : " ";
      return `[${mark}] ${asText(todo.text)}`;
    })
    .join("\n");
}

/** Keeps the start and end of long text, which usually carry the request and the outcome. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const marker = `\n[... ${text.length - max} characters omitted ...]\n`;
  const keep = Math.max(0, max - marker.length);
  const head = Math.ceil(keep * 0.6);
  return text.slice(0, head) + marker + text.slice(text.length - (keep - head));
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringify(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return "";
  }
}
