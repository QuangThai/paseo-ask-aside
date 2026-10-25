import assert from "node:assert/strict";
import { test } from "node:test";
import { runClaude } from "../server/claude.ts";

test("a missing Claude Code command fails with an install hint instead of hanging", async () => {
  const run = runClaude({
    command: "definitely-not-a-cli-xyz",
    model: "haiku",
    systemPrompt: "x",
    prompt: "x",
    onText() {},
    onModel() {},
  });
  await assert.rejects(run.done, /not found|Could not start|Install Claude Code/i);
});
