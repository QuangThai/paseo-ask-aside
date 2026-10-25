// Hands text to the Ask Aside view of an agent: a selection made elsewhere in the app, or a
// /btw question the daemon turned down. Text for an agent with no open view waits briefly and
// is consumed when that view opens.

/** A quote goes above the draft; a draft is a question to send again, with why it failed. */
export type Insert = { kind: "quote"; text: string } | { kind: "draft"; text: string; error: string };
type QuoteListener = (insert: Insert) => void;

const PENDING_TTL_MS = 2 * 60_000;
const listeners = new Map<string, QuoteListener[]>();
let pending: { agentId: string; insert: Insert; at: number } | null = null;

/** Delivers to the most recently opened view of the agent; returns false when none is open. */
export function deliverQuote(agentId: string, text: string): boolean {
  return deliver(agentId, { kind: "quote", text });
}

/** Puts a question that could not be sent into the agent's view, so it is not lost. */
export function deliverDraft(agentId: string, text: string, error: string): boolean {
  return deliver(agentId, { kind: "draft", text, error });
}

function deliver(agentId: string, insert: Insert): boolean {
  const views = listeners.get(agentId);
  const listener = views?.[views.length - 1];
  if (listener) {
    pending = null;
    listener(insert);
    return true;
  }
  pending = { agentId, insert, at: Date.now() };
  return false;
}

export function subscribeQuotes(agentId: string, listener: QuoteListener): () => void {
  const views = listeners.get(agentId) ?? [];
  views.push(listener);
  listeners.set(agentId, views);
  if (pending?.agentId === agentId) {
    if (Date.now() - pending.at < PENDING_TTL_MS) listener(pending.insert);
    pending = null;
  }
  return () => {
    const current = listeners.get(agentId) ?? [];
    const remaining = current.filter((candidate) => candidate !== listener);
    if (remaining.length > 0) listeners.set(agentId, remaining);
    else listeners.delete(agentId);
  };
}

/** Agents with an open Ask Aside view, newest first. */
export function openViewAgentIds(): string[] {
  return [...listeners.keys()].reverse();
}

export function clearPendingQuote(): void {
  pending = null;
}

const MAX_QUOTE_CHARS = 2_000;

/** Formats a selection as a Markdown quote ahead of the user's question. */
export function quoteBlock(text: string): string {
  const trimmed = text.trim();
  const clipped = trimmed.length > MAX_QUOTE_CHARS ? `${trimmed.slice(0, MAX_QUOTE_CHARS)}...` : trimmed;
  return clipped
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export interface QuoteButtonColors {
  background: string;
  foreground: string;
  border: string;
}

let buttonColors: QuoteButtonColors = { background: "#1f2329", foreground: "#e8ecf4", border: "#3a424d" };

/** The floating selection button follows the theme of the most recently rendered view. */
export function setQuoteButtonColors(colors: QuoteButtonColors): void {
  buttonColors = colors;
}

export function quoteButtonColors(): QuoteButtonColors {
  return buttonColors;
}

const recentAgents: string[] = [];

/** Remembers agents the user opened Ask Aside for, newest first, to break ties when locating a selection. */
export function rememberAgent(agentId: string): void {
  const index = recentAgents.indexOf(agentId);
  if (index >= 0) recentAgents.splice(index, 1);
  recentAgents.unshift(agentId);
  recentAgents.length = Math.min(recentAgents.length, 10);
}

export function recentAgentIds(): string[] {
  return [...recentAgents];
}
