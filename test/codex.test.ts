import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { displayCommand, readWindowsSandbox, tomlString } from "../server/codex.ts";

test("tomlString leaves only letters, digits and escapes for the shell to see", () => {
  const encoded = tomlString(`a "b" > & ( ) ^ % ! \\ tiếng 帳 🎉`);
  assert.match(encoded, /^"[A-Za-z0-9\\]*"$/);
  // TOML basic-string escapes decode the same way as JSON's, except \U for astral characters.
  const decoded = JSON.parse(encoded.replace(/\\U([0-9a-f]{8})/g, (_m, hex) => {
    const code = parseInt(hex, 16) - 0x10000;
    return `\\u${(0xd800 + (code >> 10)).toString(16)}\\u${(0xdc00 + (code & 0x3ff)).toString(16)}`;
  }));
  assert.equal(decoded, `a "b" > & ( ) ^ % ! \\ tiếng 帳 🎉`);
});

test("carries over only the Windows sandbox mode from Codex's config", () => {
  const home = mkdtempSync(join(tmpdir(), "aside-codex-home-"));
  try {
    assert.equal(readWindowsSandbox(home), null);
    writeFileSync(
      join(home, "config.toml"),
      'sandbox_mode = "workspace-write"\n[mcp_servers.exa]\ncommand = "npx"\n\n[windows]\nsandbox = "elevated" # set by setup\n\n[tui]\nsandbox = "nope"\n',
    );
    assert.equal(readWindowsSandbox(home), "elevated");
    writeFileSync(join(home, "config.toml"), '[windows]\nsandbox = "unelevated"');
    assert.equal(readWindowsSandbox(home), "unelevated");
    writeFileSync(join(home, "config.toml"), '[tui]\n[windows.extra]\nsandbox = "elevated"\n');
    assert.equal(readWindowsSandbox(home), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("shows the script Codex ran without its shell wrapper", () => {
  // As Codex reports it: backslashes inside the double-quoted parts are escaped.
  const raw =
    "\"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe\" -Command '$files = @(Get-ChildItem -LiteralPath '\"'D:\\\\app\\\\config' -File)\n\"'$files.Count'";
  assert.equal(displayCommand(raw), "$files = @(Get-ChildItem -LiteralPath 'D:\\app\\config' -File)\n$files.Count");
  assert.equal(displayCommand("/bin/bash -lc 'rg -n \"todo\" src'"), 'rg -n "todo" src');
  assert.equal(displayCommand("pwsh -NoProfile -Command 'Get-Content README.md'"), "Get-Content README.md");
});

test("leaves other commands and malformed quoting alone", () => {
  assert.equal(displayCommand("git status"), "git status");
  assert.equal(displayCommand("node -c 'x"), "node -c 'x");
  assert.equal(displayCommand("bash -lc 'unterminated"), "bash -lc 'unterminated");
});
