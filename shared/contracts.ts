import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const MODEL_CHOICES = ["same", "haiku", "sonnet", "opus"] as const;
export const ANSWER_WITH_CHOICES = ["agent", "claude"] as const;

export const preferences = defineSettings({
  id: "preferences",
  scope: "host",
  version: 1,
  schema: z.object({
    // "agent" answers Codex agents with Codex and everything else with Claude; "claude" always uses Claude.
    answerWith: z.enum(ANSWER_WITH_CHOICES).default("agent"),
    // Claude model: "same" uses a Claude agent's own model, and Sonnet for any other provider.
    model: z.enum(MODEL_CHOICES).default("same"),
    // Commands used to launch Claude Code and Codex on the daemon host.
    claudeCommand: z.string().min(1).default("claude"),
    codexCommand: z.string().min(1).default("codex"),
  }),
});

export const ExchangeStatusSchema = z.enum(["queued", "running", "done", "stopped", "error"]);
export type ExchangeStatus = z.infer<typeof ExchangeStatusSchema>;

export const ContextStatsSchema = z.object({
  totalItems: z.number(),
  includedItems: z.number(),
  chars: z.number(),
  truncated: z.boolean(),
});
export type ContextStats = z.infer<typeof ContextStatsSchema>;

export const BackendSchema = z.enum(["claude", "codex"]);
export type Backend = z.infer<typeof BackendSchema>;

export const ExchangeSchema = z.object({
  id: z.string(),
  requestId: z.string().nullable(),
  // Which CLI answered: Claude without tools, or Codex in a read-only sandbox.
  backend: BackendSchema.nullable(),
  // Commands Codex ran to read files while answering; always empty for Claude.
  activity: z.array(z.string()),
  question: z.string(),
  answer: z.string(),
  status: ExchangeStatusSchema,
  error: z.string().nullable(),
  model: z.string().nullable(),
  context: ContextStatsSchema.nullable(),
  askedAt: z.string(),
});
export type Exchange = z.infer<typeof ExchangeSchema>;

export const ThreadSchema = z.object({
  agentId: z.string(),
  // Changes when the plugin restarts, which empties every thread and restarts revisions.
  instance: z.string(),
  // Increases with every change, so a client can ignore a poll that left before a newer reply.
  revision: z.number(),
  exchanges: z.array(ExchangeSchema),
});
export type Thread = z.infer<typeof ThreadSchema>;

const AgentInput = z.object({ agentId: z.string().min(1) });

export const MAX_QUESTION_CHARS = 8_000;

export const askRpc = defineRpc({
  name: "aside.ask",
  input: z.object({
    agentId: z.string().min(1),
    question: z
      .string()
      .trim()
      .min(1, "Type a question first.")
      .max(MAX_QUESTION_CHARS, `Questions can be at most ${MAX_QUESTION_CHARS.toLocaleString("en-US")} characters.`),
    // Lets a retried request after a dropped connection return the same question instead of a duplicate.
    requestId: z.string().min(1).max(100).optional(),
  }),
  output: ThreadSchema,
});

/**
 * RPC errors arrive as "Request failed: <message>", and a rejected input's message is the
 * validator's list of issues as JSON. Keeps only the human-readable part.
 */
export function readableError(message: string): string {
  const text = message.replace(/^Request failed:\s*/, "").trim();
  if (text.startsWith("[")) {
    try {
      const issues = JSON.parse(text) as Array<{ message?: unknown }>;
      const messages = issues.map((issue) => issue.message).filter((value): value is string => typeof value === "string");
      if (messages.length > 0) return messages.join(" ");
    } catch {
      // Not a list of issues after all.
    }
  }
  return text || "Something went wrong.";
}

export const threadRpc = defineRpc({
  name: "aside.thread",
  input: AgentInput,
  output: ThreadSchema,
});

export const stopRpc = defineRpc({
  name: "aside.stop",
  // With exchangeId, Stop only affects that question, so a stale screen cannot stop a newer one.
  input: z.object({ agentId: z.string().min(1), exchangeId: z.string().optional() }),
  output: ThreadSchema,
});

export const clearRpc = defineRpc({
  name: "aside.clear",
  input: AgentInput,
  output: ThreadSchema,
});

export const locateRpc = defineRpc({
  name: "aside.locate",
  input: z.object({
    workspaceIds: z.array(z.string()).max(4),
    agentId: z.string().nullable(),
    text: z.string().max(20_000),
    preferredAgentIds: z.array(z.string()).max(10),
  }),
  // matched is false when the text was not found and a likely agent was picked instead.
  output: z.object({ agentId: z.string(), workspaceId: z.string(), matched: z.boolean() }).nullable(),
});

export function isActive(status: ExchangeStatus): boolean {
  return status === "queued" || status === "running";
}
