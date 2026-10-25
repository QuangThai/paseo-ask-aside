import { Platform } from "react-native";

// This plugin typechecks without the DOM library. Declare only what this module uses.
declare const document: any;
declare const window: any;

/** DOM id of every Ask Aside view, so selections inside it are ignored. */
export const ASIDE_ROOT_ID = "ask-aside-root";

export interface SelectionButtonColors {
  background: string;
  foreground: string;
  border: string;
}

export interface SelectionWatcherOptions {
  /**
   * Receives the selected text when the floating button is pressed. Returns null when done, or a
   * short message to show on the button; a promise keeps the button in a working state until it settles.
   */
  onAsk(text: string): string | null | Promise<string | null>;
  colors(): SelectionButtonColors;
}

const LABEL = "Ask aside";
const MAX_SELECTION_CHARS = 20_000;
// Selections here are edits or terminals, not conversation text.
const IGNORED = `input, textarea, [contenteditable=""], [contenteditable="true"], .cm-editor, .xterm, #${ASIDE_ROOT_ID}`;

/**
 * Shows an "Ask aside" button above text selected with the mouse or keyboard, like the
 * selection menu in Claude Code and Codex desktop. Paseo has no selection API for plugins,
 * so this works on the browser selection directly and is available on web and desktop only.
 */
export function watchSelection(options: SelectionWatcherOptions): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined" || typeof window === "undefined") return () => {};

  let button: any = null;
  let selectedText = "";
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  // True while the button shows its confirmation, which clearing the selection must not hide.
  let confirming = false;
  // Set on unload so a callback already scheduled cannot recreate the button.
  let disposed = false;
  let updateTimer: ReturnType<typeof setTimeout> | undefined;

  const hide = () => {
    if (button) button.style.display = "none";
    selectedText = "";
  };

  const ensureButton = () => {
    if (button) return button;
    button = document.createElement("button");
    button.type = "button";
    button.textContent = LABEL;
    button.setAttribute("aria-label", "Ask a side question about the selected text");
    Object.assign(button.style, {
      position: "fixed",
      zIndex: "2147483000",
      display: "none",
      alignItems: "center",
      padding: "5px 10px",
      borderRadius: "8px",
      borderWidth: "1px",
      borderStyle: "solid",
      font: "500 12px/16px system-ui, -apple-system, 'Segoe UI', sans-serif",
      cursor: "pointer",
      boxShadow: "0 4px 14px rgba(0, 0, 0, 0.35)",
      whiteSpace: "nowrap",
    });
    // Keep the selection alive while the button is pressed.
    button.addEventListener("mousedown", (event: any) => event.preventDefault());
    button.addEventListener("click", () => {
      const text = selectedText;
      if (!text) return;
      const result = options.onAsk(text);
      window.getSelection?.()?.removeAllRanges?.();
      const show = (message: string | null) => {
        if (!message) {
          confirming = false;
          hide();
          return;
        }
        confirming = true;
        button.textContent = message;
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
          confirming = false;
          button.textContent = LABEL;
          hide();
        }, 1_800);
      };
      if (result instanceof Promise) {
        // Hold the button in place while the panel opens.
        confirming = true;
        clearTimeout(resetTimer);
        button.textContent = "Opening...";
        void result.then(show, () => show("Could not open Ask Aside"));
      } else {
        show(result);
      }
    });
    document.body.appendChild(button);
    return button;
  };

  const update = () => {
    if (disposed) return;
    const selection = window.getSelection?.();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return hide();
    const text = String(selection.toString()).trim();
    if (!text) return hide();
    const anchor = selection.anchorNode;
    const element = anchor?.nodeType === 1 ? anchor : anchor?.parentElement;
    if (!element || element.closest?.(IGNORED)) return hide();
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return hide();

    const node = ensureButton();
    const colors = options.colors();
    clearTimeout(resetTimer);
    confirming = false;
    node.textContent = LABEL;
    node.style.background = colors.background;
    node.style.color = colors.foreground;
    node.style.borderColor = colors.border;
    node.style.display = "flex";
    selectedText = text.slice(0, MAX_SELECTION_CHARS);

    const width = node.offsetWidth || 90;
    const height = node.offsetHeight || 28;
    const above = rect.top - height - 8;
    const top = above >= 8 ? above : rect.bottom + 8;
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
    node.style.top = `${Math.round(top)}px`;
    node.style.left = `${Math.round(left)}px`;
  };

  // Show the button once the selection settles, not on every step of a drag.
  const scheduleUpdate = (event: any) => {
    if (button && event?.target === button) return;
    clearTimeout(updateTimer);
    updateTimer = setTimeout(update, 0);
  };
  const onKeyUp = (event: any) => {
    if (event.shiftKey || event.key === "Shift" || ((event.ctrlKey || event.metaKey) && event.key === "a")) {
      clearTimeout(updateTimer);
      updateTimer = setTimeout(update, 0);
    }
  };
  const onSelectionChange = () => {
    if (confirming) return;
    const selection = window.getSelection?.();
    if (!selection || selection.isCollapsed) hide();
  };

  document.addEventListener("mouseup", scheduleUpdate);
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("selectionchange", onSelectionChange);
  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);

  return () => {
    disposed = true;
    clearTimeout(resetTimer);
    clearTimeout(updateTimer);
    document.removeEventListener("mouseup", scheduleUpdate);
    document.removeEventListener("keyup", onKeyUp);
    document.removeEventListener("selectionchange", onSelectionChange);
    window.removeEventListener("scroll", hide, true);
    window.removeEventListener("resize", hide);
    button?.remove();
    button = null;
  };
}

export interface CurrentRoute {
  /** Candidate workspace IDs; the path segment may be plain or base64url encoded. */
  workspaceIds: string[];
  agentId: string | null;
}

/** Reads the workspace or agent the app is showing from its URL (`/h/<host>/workspace/<id>` or `/h/<host>/agent/<id>`). */
export function currentRoute(): CurrentRoute {
  const empty: CurrentRoute = { workspaceIds: [], agentId: null };
  if (Platform.OS !== "web" || typeof window === "undefined") return empty;
  const paths = [String(window.location?.pathname ?? ""), String(window.location?.hash ?? "").replace(/^#/, "")];
  for (const path of paths) {
    const agent = /\/h\/[^/]+\/agent\/([^/?#]+)/.exec(path);
    if (agent) return { workspaceIds: [], agentId: safeDecode(agent[1]!) };
    const workspace = /\/h\/[^/]+\/workspace\/([^/?#]+)/.exec(path);
    if (workspace) {
      const segment = safeDecode(workspace[1]!);
      const ids = [segment, decodeBase64Url(segment)].filter((id): id is string => !!id);
      return { workspaceIds: [...new Set(ids)], agentId: null };
    }
  }
  return empty;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function decodeBase64Url(segment: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(segment) || typeof window.atob !== "function") return null;
  try {
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const binary = window.atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
    const bytes = Uint8Array.from(binary, (char: string) => char.charCodeAt(0));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // Only accept a decoding that round-trips to printable text.
    return /^[ -~]+$/.test(text) ? text : null;
  } catch {
    return null;
  }
}
