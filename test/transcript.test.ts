import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTranscript, clip, type TimelineEntryLike } from "../server/transcript.ts";

const user = (text: string): TimelineEntryLike => ({ item: { type: "user_message", text } as never });
const assistant = (text: string): TimelineEntryLike => ({ item: { type: "assistant_message", text } as never });
const shell = (command: string, output: string, status = "completed"): TimelineEntryLike => ({
  item: { type: "tool_call", callId: command, name: "Bash", status, error: null, detail: { type: "shell", command, output } } as never,
});

test("renders messages and tool calls in order", () => {
  const result = buildTranscript([user("rename config.yaml"), shell("mv config.yaml app.yaml", ""), assistant("Done.")]);
  assert.equal(result.totalItems, 3);
  assert.equal(result.truncated, false);
  assert.match(result.text, /^USER:\nrename config\.yaml\n\nTOOL CALL Bash \(completed\)\ncommand: mv config\.yaml app\.yaml\n\nASSISTANT:\nDone\.$/);
});

test("marks running tool calls", () => {
  const result = buildTranscript([shell("npm test", "", "running")]);
  assert.match(result.text, /TOOL CALL Bash \(still running\)/);
});

test("keeps the first request and newest messages when over budget", () => {
  const entries = [user("ORIGINAL REQUEST"), ...Array.from({ length: 50 }, (_, i) => assistant(`reply ${i} ${"x".repeat(200)}`))];
  const result = buildTranscript(entries, { maxChars: 2_000, maxMessageChars: 8_000, maxDetailChars: 2_000 });
  assert.ok(result.truncated);
  assert.ok(result.text.length <= 2_000 + 100);
  assert.ok(result.text.startsWith("USER:\nORIGINAL REQUEST"));
  assert.match(result.text, /reply 49 /);
  assert.doesNotMatch(result.text, /reply 1 /);
  assert.match(result.text, /earlier items omitted/);
});

test("prefers conversation over tool detail", () => {
  const entries = [user("q"), shell("cat big", "y".repeat(1_500)), assistant("answer")];
  const result = buildTranscript(entries, { maxChars: 40, maxMessageChars: 8_000, maxDetailChars: 2_000 });
  assert.match(result.text, /USER:\nq/);
  assert.match(result.text, /ASSISTANT:\nanswer/);
  assert.doesNotMatch(result.text, /cat big/);
});

test("treats agent-to-agent prompts as conversation", () => {
  const entry: TimelineEntryLike = {
    item: {
      type: "tool_call",
      callId: "paseo-agent-message:1",
      name: "message",
      status: "completed",
      error: null,
      detail: { type: "unknown", input: null, output: null },
      agentMessage: { event: "message", sender: { id: "a1", title: "Lead" }, text: "Review the schema" },
    } as never,
  };
  const result = buildTranscript([entry]);
  assert.equal(result.text, 'MESSAGE FROM AGENT "Lead":\nReview the schema');
});

test("skips plugin rows and empty messages", () => {
  const result = buildTranscript([
    { item: { type: "plugin", kind: "x", version: 1, data: null } as never },
    assistant("   "),
    user("hi"),
  ]);
  assert.equal(result.totalItems, 1);
  assert.equal(result.text, "USER:\nhi");
});

test("clip keeps head and tail within the limit", () => {
  const text = "a".repeat(500) + "b".repeat(500);
  const clipped = clip(text, 200);
  assert.ok(clipped.length <= 200);
  assert.ok(clipped.startsWith("aaa"));
  assert.ok(clipped.endsWith("bbb"));
  assert.match(clipped, /characters omitted/);
});

test("keeps the titles and links of web search results", () => {
  const search: TimelineEntryLike = {
    item: {
      type: "tool_call",
      name: "web_search",
      status: "completed",
      detail: { type: "search", query: "paseo plugins", webResults: [{ title: "Plugin reference", url: "https://paseo.sh/docs/plugins" }] },
    } as never,
  };
  const result = buildTranscript([user("q"), search]);
  assert.match(result.text, /Plugin reference - https:\/\/paseo\.sh\/docs\/plugins/);
});
