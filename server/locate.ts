/// <reference types="node" />
import type { PluginHandlerContext } from "@getpaseo/plugin/server";

// Taken from the plugin SDK, which Paseo provides; @getpaseo/client is not installed with the plugin.
type PaseoApi = PluginHandlerContext["paseo"];

const MAX_CANDIDATES = 12;
const TIMELINE_ROWS = 400;
const NEEDLE_CHARS = 80;
const MIN_NEEDLE_CHARS = 6;
// One CJK character carries about a word, so three already make a distinctive phrase.
const MIN_CJK_NEEDLE_CHARS = 3;
const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]/;
const MAX_NEEDLES = 8;

export interface LocateInput {
  workspaceIds: string[];
  /** Set when the app URL already names the agent. */
  agentId: string | null;
  text: string;
  preferredAgentIds: string[];
}

export interface LocatedAgent {
  agentId: string;
  workspaceId: string;
  matched: boolean;
}

interface Candidate {
  id: string;
  workspaceId: string;
  updatedAt: string;
}

/**
 * Finds which agent a selection was copied from. Paseo gives plugins no "focused agent",
 * so search the selected text in the timelines of the agents in the current workspace.
 */
export async function locateAgent(paseo: PaseoApi, input: LocateInput): Promise<LocatedAgent | null> {
  const list = await paseo.agents.list({ page: { limit: 200 } });
  const all: Candidate[] = list.entries
    .map((entry) => entry.agent)
    .filter((agent) => !agent.archivedAt && agent.status !== "closed")
    .flatMap((agent) => (agent.workspaceId ? [{ id: agent.id, workspaceId: agent.workspaceId, updatedAt: agent.updatedAt }] : []))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const named = input.agentId ? all.find((agent) => agent.id === input.agentId) : undefined;
  if (named) return toLocated(named, true);

  // If the URL's workspace cannot be matched, search every active agent rather than give up.
  const scoped = new Set(input.workspaceIds);
  const inWorkspace = all.filter((agent) => scoped.has(agent.workspaceId));
  const candidates = (inWorkspace.length > 0 ? inWorkspace : all).slice(0, MAX_CANDIDATES);

  if (candidates.length === 0) return null;
  // The only agent of the workspace on screen is the one being asked about, even for text
  // from a file or diff. Outside a known workspace, the text itself has to match.
  if (inWorkspace.length === 1) return toLocated(inWorkspace[0]!, true);

  const needles = selectionNeedles(input.text);
  if (needles.length === 0) return null;
  const scores = await Promise.all(candidates.map((candidate) => matchScore(paseo, candidate.id, needles)));
  const best = Math.max(...scores);
  // Not found in any timeline: with several agents on screen a guess is often wrong, and a
  // quote in the wrong agent's side chat is worse than asking the user to open the right one.
  if (best <= 0) return null;
  // Ties go to an agent the user has Ask Aside open for, then to the most recently active.
  const tied = candidates.filter((_, index) => scores[index] === best);
  const preferred = input.preferredAgentIds
    .map((id) => tied.find((candidate) => candidate.id === id))
    .find((candidate): candidate is Candidate => candidate !== undefined);
  return toLocated(preferred ?? tied[0]!, true);
}

function toLocated(candidate: Candidate, matched: boolean): LocatedAgent {
  return { agentId: candidate.id, workspaceId: candidate.workspaceId, matched };
}

// Text an agent wrote or was asked outranks text it merely received from a tool or another
// agent, so a lead agent that relayed a worker's report does not win over the worker.
const OWN_TEXT = new Set(["user_message", "assistant_message", "reasoning"]);

/**
 * Adds up, for each selected line, 2 when the agent wrote or was asked it and 1 when it only
 * received it, so the agent holding most of the selection as its own text wins.
 */
async function matchScore(paseo: PaseoApi, agentId: string, needles: string[]): Promise<number> {
  let texts: Array<{ text: string; own: boolean }>;
  try {
    const page = await paseo.agents
      .ref(agentId)
      .timeline.refetch({ direction: "tail", limit: TIMELINE_ROWS, projection: "projected" });
    texts = page.entries.map((entry) => {
      const item = entry.item as unknown as Record<string, unknown>;
      return { text: normalize(itemText(item)), own: OWN_TEXT.has(String(item.type)) };
    });
  } catch {
    // An agent whose timeline cannot be read is simply not a match.
    return 0;
  }
  let score = 0;
  for (const needle of needles) {
    let lineScore = 0;
    for (const { text, own } of texts) {
      if (!text.includes(needle)) continue;
      lineScore = own ? 2 : 1;
      if (own) break;
    }
    score += lineScore;
  }
  return score;
}

function itemText(item: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ["text", "message"]) {
    if (typeof item[key] === "string") parts.push(item[key] as string);
  }
  const detail = item.detail as Record<string, unknown> | undefined;
  if (detail) {
    for (const key of ["output", "content", "command", "text", "result", "log"]) {
      if (typeof detail[key] === "string") parts.push(detail[key] as string);
    }
  }
  const agentMessage = item.agentMessage as Record<string, unknown> | undefined;
  if (typeof agentMessage?.text === "string") parts.push(agentMessage.text);
  return parts.join("\n");
}

/**
 * Rendered Markdown loses its syntax when selected: links show only their label, and marks,
 * bullets and spacing disappear. Compare text with all of that removed.
 */
export function normalize(text: string): string {
  return text
    .normalize("NFC")
    .replace(/!?\[([^\]\n]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, "$1")
    .replace(/<(https?:\/\/[^>\s]+)>/g, "$1")
    .toLowerCase()
    .replace(/[*_`#>|~[\]()•]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The longest selected lines, up to MAX_NEEDLES, each cut to NEEDLE_CHARS. Several lines let a
 * selection still match when one line was rendered differently from the agent's Markdown.
 */
export function selectionNeedles(text: string): string[] {
  const lines = text
    .split(/\n/)
    .map((line) => normalize(line).slice(0, NEEDLE_CHARS))
    .filter((line) => line.length >= (CJK.test(line) ? MIN_CJK_NEEDLE_CHARS : MIN_NEEDLE_CHARS));
  return [...new Set(lines)].sort((a, b) => b.length - a.length).slice(0, MAX_NEEDLES);
}
