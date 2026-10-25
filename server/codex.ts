/// <reference types="node" />
import { spawnProcess, terminateProcess } from "@getpaseo/plugin/server";
import { existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export interface CodexRunInput {
  command: string;
  model: string;
  /** Codex reasoning effort, such as "high"; null keeps the user's Codex default. */
  effort: string | null;
  /** The agent's working directory, so Codex can read the code it is asked about. */
  cwd: string | null;
  systemPrompt: string;
  prompt: string;
  onText(text: string): void;
  onModel(model: string): void;
  onActivity(command: string): void;
}

export interface CodexRun {
  done: Promise<string>;
  stop(): Promise<void>;
}

const MAX_ANSWER_CHARS = 200_000;
const MAX_LINE_CHARS = 4_000_000;
const STDERR_CHARS = 8_000;
// "ultra" delegates to sub-agents, which a quick side answer should not do.
const EFFORT_CAP: Record<string, string> = { ultra: "max" };

// Features that act outside the sandbox or beyond reading: MCP-backed apps and plugins, the
// browser, computer use, hooks, sub-agents, image generation and goals.
const DISABLED_FEATURES = [
  "apps",
  "plugins",
  "remote_plugin",
  "browser_use",
  "computer_use",
  "hooks",
  "multi_agent",
  "image_generation",
  "goals",
  "skill_mcp_dependency_install",
];

/**
 * One Codex turn in a read-only sandbox, like Codex's own /side: it may read and search
 * files to answer, but the sandbox blocks writes and network for every command it runs, and
 * approvals are never requested. The user's config.toml is not loaded, because MCP servers
 * declared there run outside the sandbox and `mcp_servers={}` does not remove them; only its
 * Windows sandbox mode is carried over. Web search and the features above are off, and the
 * session is not saved. Codex has no switch that removes its shell tool entirely, so this is
 * read-only rather than no-tools.
 *
 * The transcript and question go through stdin and the instructions as an escaped TOML string:
 * on Windows the SDK starts `codex.cmd` through cmd.exe, which mangles characters such as
 * > & ( ) ^ in arguments and limits the whole command line to 8,191 characters.
 */
export function runCodex(input: CodexRunInput): CodexRun {
  const args = [
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--sandbox",
    "read-only",
    "-c",
    "approval_policy=never",
    "-c",
    "mcp_servers={}",
    "-c",
    "web_search=disabled",
    ...DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
    // Codex reads these as developer instructions, which outrank the transcript in the prompt.
    "-c",
    `developer_instructions=${tomlString(input.systemPrompt)}`,
    "-m",
    input.model,
  ];
  // Without it, Windows has no sandbox to run even read-only commands in.
  const windowsSandbox = process.platform === "win32" ? readWindowsSandbox() : null;
  if (windowsSandbox) args.push("-c", `windows.sandbox=${windowsSandbox}`);
  if (input.effort) args.push("-c", `model_reasoning_effort=${EFFORT_CAP[input.effort] ?? input.effort}`);
  // An agent whose folder was removed still gets an answer from its transcript.
  const cwd = input.cwd && existsSync(input.cwd) ? input.cwd : tmpdir();
  args.push("-C", cwd, "-");

  const child = spawnProcess(input.command, args, { stdio: "pipe", cwd, env: process.env, windowsHide: true });

  let stopRequested = false;
  let stopping: Promise<void> | null = null;
  let text = "";
  let stderr = "";
  let buffered = "";
  let failure: string | null = null;
  let completed = false;

  const stop = (): Promise<void> => {
    stopRequested = true;
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    if (!stopping) {
      stopping = terminateProcess(child).catch((error: unknown) => {
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
    const item = event.item as Record<string, any> | undefined;
    if (event.type === "thread.started") {
      input.onModel(input.model);
    } else if (event.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string") {
      // Codex sends whole messages; the last one is the answer, earlier ones narrate progress.
      text = item.text.slice(0, MAX_ANSWER_CHARS);
      input.onText(text);
    } else if (event.type === "item.started" && item?.type === "command_execution" && typeof item.command === "string") {
      input.onActivity(displayCommand(item.command));
    } else if (event.type === "turn.completed") {
      completed = true;
    } else if (event.type === "turn.failed") {
      failure = String(event.error?.message ?? "Codex could not answer.");
    } else if (event.type === "error" && typeof event.message === "string") {
      failure = event.message;
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
    if (buffered.length > MAX_LINE_CHARS) buffered = "";
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < STDERR_CHARS) stderr += chunk;
  });

  const done = new Promise<string>((resolve, reject) => {
    child.on("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "ENOENT"
          ? new Error(`Could not start "${input.command}". Install Codex on the daemon host and sign in, or set its path in Ask Aside settings.`)
          : error,
      );
    });
    child.on("close", (code) => {
      handleLine(buffered);
      buffered = "";
      if (stopRequested) {
        resolve(text);
      } else if (failure) {
        reject(new Error(failure));
      } else if (completed || (code === 0 && text)) {
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

/**
 * A TOML string for a `-c key=value` argument. Everything but letters and digits is written
 * as a \u escape, so no quoting layer between here and Codex (cmd.exe on Windows) can alter it.
 */
export function tomlString(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (/[A-Za-z0-9]/.test(char)) out += char;
    else if (code > 0xffff) out += `\\U${code.toString(16).padStart(8, "0")}`;
    else out += `\\u${code.toString(16).padStart(4, "0")}`;
  }
  return `"${out}"`;
}

/** The `sandbox` value of the `[windows]` table in Codex's config.toml, such as "elevated". */
export function readWindowsSandbox(home = process.env.CODEX_HOME ?? join(homedir(), ".codex")): string | null {
  let config: string;
  try {
    config = readFileSync(join(home, "config.toml"), "utf8");
  } catch {
    return null;
  }
  const table = /^\s*\[windows\]\s*$([\s\S]*?)(?=^\s*\[|(?![\s\S]))/m.exec(config)?.[1] ?? "";
  const value = /^\s*sandbox\s*=\s*["']([a-z-]+)["']\s*(?:#.*)?$/m.exec(table)?.[1];
  return value ?? null;
}

const SHELLS = new Set(["powershell", "pwsh", "bash", "zsh", "sh", "cmd"]);
const WRAPPER = /^("[^"]*"|\S+)\s+(?:-(?:NoProfile|NoLogo|NonInteractive)\s+)*(?:-Command|-lc|-c|\/c)\s+([\s\S]+)$/i;

/**
 * Codex reports commands with the shell that ran them, such as
 * `"...\powershell.exe" -Command 'Get-Content README.md'`. Shows only the script.
 */
export function displayCommand(command: string): string {
  const match = WRAPPER.exec(command.trim());
  const shell = match?.[1]!.replace(/"/g, "").split(/[\\/]/).pop()!.replace(/\.exe$/i, "").toLowerCase();
  if (!match || !shell || !SHELLS.has(shell)) return command.trim();
  return unquote(match[2]!)?.trim() || command.trim();
}

/** Joins one POSIX shell word: '...' is literal, "..." honours backslash escapes. */
function unquote(word: string): string | null {
  let out = "";
  for (let i = 0; i < word.length; i++) {
    const char = word[i]!;
    if (char === "'") {
      const end = word.indexOf("'", i + 1);
      if (end < 0) return null;
      out += word.slice(i + 1, end);
      i = end;
    } else if (char === '"') {
      let j = i + 1;
      for (; j < word.length && word[j] !== '"'; j++) {
        if (word[j] === "\\" && /["\\$`]/.test(word[j + 1] ?? "")) j++;
        out += word[j];
      }
      if (j >= word.length) return null;
      i = j;
    } else {
      out += char;
    }
  }
  return out;
}

function describeExit(code: number | null, stderr: string): string {
  const detail = stderr.trim().split("\n").slice(-3).join("\n");
  if (code === 9009 || /is not recognized as an internal or external command/i.test(detail)) {
    return "Codex was not found. Install it on the daemon host and sign in, or set its path in Ask Aside settings.";
  }
  if (/log ?in|logged in|authenticat|api key|unauthorized|401/i.test(detail)) {
    return `Codex is not signed in on the daemon host. Run "codex login" there.\n${detail}`;
  }
  return detail || `Codex exited with code ${code ?? "unknown"} before answering.`;
}
