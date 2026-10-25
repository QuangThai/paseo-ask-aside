/// <reference types="node" />
import { spawnProcess, terminateProcess } from "@getpaseo/plugin/server";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ClaudeRunInput {
  command: string;
  model: string;
  systemPrompt: string;
  prompt: string;
  onText(text: string): void;
  onModel(model: string): void;
}

export interface ClaudeRun {
  done: Promise<string>;
  /** Idempotent while a stop is in flight; can be retried if terminating failed. */
  stop(): Promise<void>;
}

const MAX_ANSWER_CHARS = 200_000;
const MAX_LINE_CHARS = 4_000_000;
const STDERR_CHARS = 8_000;

/**
 * A fresh private directory per run: Claude Code starts there so no project CLAUDE.md or
 * settings are discovered, and it holds the run's settings and system prompt files.
 * mkdtemp gives an unpredictable, owner-only path, so another local user cannot swap them.
 * The settings turn off the server-side advisor tool, which `--tools=` does not remove, and
 * the hooks from the user's own settings. Organization-managed policy can still add hooks.
 */
function runDirectory(systemPrompt: string): { cwd: string; settingsPath: string; systemPromptPath: string } {
  const cwd = mkdtempSync(join(tmpdir(), "paseo-ask-aside-"));
  const settingsPath = join(cwd, "settings.json");
  const systemPromptPath = join(cwd, "system-prompt.txt");
  writeFileSync(settingsPath, JSON.stringify({ advisorModel: "", disableAllHooks: true }), { mode: 0o600 });
  writeFileSync(systemPromptPath, systemPrompt, { encoding: "utf8", mode: 0o600 });
  return { cwd, settingsPath, systemPromptPath };
}

/**
 * One no-tools Claude Code turn. `--tools=` removes every built-in tool and
 * `--strict-mcp-config` with no config loads no MCP servers, so the model can only answer
 * from the prompt. `--safe-mode` skips CLAUDE.md, skills and custom agents while keeping the
 * user's sign-in. The prompt goes through stdin because a long transcript exceeds the
 * Windows command-line limit.
 *
 * On Windows the SDK starts `claude.cmd` through cmd.exe, which drops an empty argument and
 * escapes characters such as > & ( ) with ^. So `--tools=` is a single argument, and text
 * travels in files or stdin, never in argv.
 *
 * The run fails closed: if Claude Code reports any tool or MCP server at startup, the
 * process is stopped before it can answer.
 */
export function runClaude(input: ClaudeRunInput): ClaudeRun {
  const { cwd, settingsPath, systemPromptPath } = runDirectory(input.systemPrompt);
  const args = [
    "-p",
    "--safe-mode",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--tools=",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--settings",
    settingsPath,
    "--model",
    input.model,
    "--system-prompt-file",
    systemPromptPath,
  ];

  const child = spawnProcess(input.command, args, {
    stdio: "pipe",
    cwd,
    env: { ...process.env, CLAUDE_CODE_DISABLE_ADVISOR_TOOL: "1" },
    windowsHide: true,
  });

  let stopRequested = false;
  let stopping: Promise<void> | null = null;
  let refusal: string | null = null;
  let text = "";
  let stderr = "";
  let buffered = "";
  let result: { isError: boolean; text: string } | null = null;

  const stop = (): Promise<void> => {
    stopRequested = true;
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    if (!stopping) {
      stopping = terminateProcess(child).catch((error: unknown) => {
        // Let a later Stop try again.
        stopping = null;
        throw error;
      });
    }
    return stopping;
  };

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let event: Record<string, any>;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.type === "system" && event.subtype === "init") {
      const tools = Array.isArray(event.tools) ? event.tools : [];
      const servers = Array.isArray(event.mcp_servers) ? event.mcp_servers : [];
      if (tools.length > 0 || servers.length > 0) {
        refusal =
          "Claude Code started with tools or MCP servers enabled, so Ask Aside stopped it before it could answer. " +
          `Tools: ${tools.join(", ") || "none"}. MCP servers: ${servers.map((server: any) => server?.name ?? "?").join(", ") || "none"}.`;
        void stop().catch(() => {});
        return;
      }
      if (typeof event.model === "string") input.onModel(event.model);
    } else if (refusal) {
      return;
    } else if (event.type === "stream_event") {
      const delta = event.event?.delta;
      if (event.event?.type === "content_block_delta" && delta?.type === "text_delta" && typeof delta.text === "string") {
        if (text.length < MAX_ANSWER_CHARS) {
          text += delta.text;
          input.onText(text);
        }
      }
    } else if (event.type === "assistant" && !text) {
      // Fallback when partial messages are not streamed.
      const blocks = Array.isArray(event.message?.content) ? event.message.content : [];
      const full = blocks
        .filter((block: any) => block?.type === "text" && typeof block.text === "string")
        .map((block: any) => block.text)
        .join("");
      if (full) {
        text = full.slice(0, MAX_ANSWER_CHARS);
        input.onText(text);
      }
    } else if (event.type === "result") {
      result = { isError: event.is_error === true || event.subtype !== "success", text: resultText(event) };
    }
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffered += chunk;
    let newline = buffered.indexOf("\n");
    while (newline >= 0) {
      handleLine(buffered.slice(0, newline));
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf("\n");
    }
    // A runaway line without a newline is not valid stream-json; drop it rather than grow forever.
    if (buffered.length > MAX_LINE_CHARS) buffered = "";
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < STDERR_CHARS) stderr += chunk;
  });

  const done = new Promise<string>((resolve, reject) => {
    child.on("error", (error: NodeJS.ErrnoException) => {
      removeDirectory(cwd);
      if (error.code === "ENOENT") {
        reject(
          new Error(
            `Could not start "${input.command}". Install Claude Code on the daemon host and sign in, ` +
              "or set its path in Ask Aside settings.",
          ),
        );
      } else {
        reject(error);
      }
    });
    child.on("close", (code) => {
      removeDirectory(cwd);
      handleLine(buffered);
      buffered = "";
      if (refusal) {
        reject(new Error(refusal));
        return;
      }
      if (stopRequested) {
        resolve(text);
        return;
      }
      const finished = result as { isError: boolean; text: string } | null;
      if (finished?.isError) {
        reject(new Error(finished.text || "Claude Code reported an error."));
      } else if (finished) {
        resolve(finished.text || text);
      } else if (code === 0 && text) {
        resolve(text);
      } else {
        reject(new Error(describeExit(code, stderr)));
      }
    });
  });

  child.stdin.on("error", () => {
    // The process exited before reading the prompt; `close` reports the failure.
  });
  child.stdin.end(input.prompt, "utf8");

  return { done, stop };
}

/** Error results carry their detail in `errors` rather than `result`. */
function resultText(event: Record<string, any>): string {
  const errors = Array.isArray(event.errors) ? event.errors.filter((item: unknown) => typeof item === "string") : [];
  if (errors.length > 0) return errors.join("\n");
  if (typeof event.result === "string" && event.result) return event.result;
  if (event.subtype && event.subtype !== "success") return `Claude Code stopped: ${event.subtype}.`;
  return "";
}

function describeExit(code: number | null, stderr: string): string {
  const detail = stderr.trim().split("\n").slice(-3).join("\n");
  // Through the Windows shell a missing command shows up as exit code 9009 or a cmd message.
  if (code === 9009 || /is not recognized as an internal or external command/i.test(detail)) {
    return "Claude Code was not found. Install it on the daemon host and sign in, or set its path in Ask Aside settings.";
  }
  if (/log ?in|logged in|authenticat|api key|unauthorized|401/i.test(detail)) {
    return `Claude Code is not signed in on the daemon host. Run "claude" there and sign in.\n${detail}`;
  }
  return detail || `Claude Code exited with code ${code ?? "unknown"} before answering.`;
}

function removeDirectory(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // A leftover empty temp folder is harmless.
  }
}
