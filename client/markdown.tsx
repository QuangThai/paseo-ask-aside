import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { Fragment, useMemo, type ReactNode } from "react";
import { Platform, Text, View } from "react-native";

// The Paseo 0.12 plugin UI kit has no Markdown component, so answers use this small
// renderer: fenced code, headings, lists, tables, quotes, rules, and inline code, bold,
// italic and links.

type Block =
  | { kind: "code"; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "item"; marker: string; indent: number; text: string }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | { kind: "paragraph"; text: string };

type Colors = PluginTheme["colors"];

const MONO = Platform.select({ ios: "Menlo", default: "monospace" });
const BODY = { fontSize: 13, lineHeight: 20 };

export function MarkdownText({ children, theme, compact }: { children: string; theme: PluginTheme; compact?: boolean }) {
  const blocks = useMemo(() => parseBlocks(children), [children]);
  const { colors } = theme;
  const base = { ...BODY, color: colors.foreground };

  return (
    <View style={{ gap: compact ? 6 : 10 }}>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "code":
            return (
              <View
                key={index}
                style={{ backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 12 }}
              >
                <Text selectable style={{ color: colors.foreground, fontFamily: MONO, fontSize: 12, lineHeight: 18 }}>
                  {block.text}
                </Text>
              </View>
            );
          case "table":
            return <Table key={index} header={block.header} rows={block.rows} colors={colors} />;
          case "heading":
            return (
              <Text
                key={index}
                selectable
                style={{ ...base, fontWeight: "700", fontSize: block.level <= 2 ? 14 : 13, marginTop: index > 0 ? 4 : 0 }}
              >
                {renderInline(block.text, colors)}
              </Text>
            );
          case "item":
            return (
              <View key={index} style={{ flexDirection: "row", paddingLeft: 4 + block.indent * 16 }}>
                <Text style={{ ...base, color: colors.foregroundMuted, minWidth: 18 }}>{block.marker}</Text>
                <Text selectable style={{ ...base, flex: 1 }}>
                  {renderInline(block.text, colors)}
                </Text>
              </View>
            );
          case "quote":
            return (
              <View key={index} style={{ borderLeftWidth: 3, borderLeftColor: colors.border, paddingLeft: 12 }}>
                <Text selectable style={{ ...base, color: colors.foregroundMuted }}>
                  {renderInline(block.text, colors)}
                </Text>
              </View>
            );
          case "rule":
            return <View key={index} style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />;
          default:
            return (
              <Text key={index} selectable style={base}>
                {renderInline(block.text, colors)}
              </Text>
            );
        }
      })}
    </View>
  );
}

function Table({ header, rows, colors }: { header: string[]; rows: string[][]; colors: Colors }) {
  const columns = Math.max(header.length, ...rows.map((row) => row.length));
  // Give wordy columns more room, within limits, so short columns stay narrow.
  const weights = Array.from({ length: columns }, (_, column) => {
    const longest = Math.max(...[header, ...rows].map((row) => (row[column] ?? "").length));
    return Math.min(40, Math.max(6, longest));
  });
  const cellText = { fontSize: 12.5, lineHeight: 18, color: colors.foreground };

  const renderRow = (cells: string[], key: string, isHeader: boolean, last: boolean) => (
    <View
      key={key}
      style={{
        flexDirection: "row",
        backgroundColor: isHeader ? colors.surface1 : undefined,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.border,
      }}
    >
      {weights.map((weight, column) => (
        <View
          key={column}
          style={{
            flex: weight,
            paddingHorizontal: 10,
            paddingVertical: 7,
            borderLeftWidth: column === 0 ? 0 : 1,
            borderLeftColor: colors.border,
          }}
        >
          <Text selectable style={{ ...cellText, fontWeight: isHeader ? "600" : "400" }}>
            {renderInline(cells[column] ?? "", colors)}
          </Text>
        </View>
      ))}
    </View>
  );

  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: "hidden" }}>
      {header.length > 0 ? renderRow(header, "header", true, rows.length === 0) : null}
      {rows.map((row, index) => renderRow(row, String(index), false, index === rows.length - 1))}
    </View>
  );
}

function splitRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);
  // Split on pipes that are not escaped as \|.
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!;
    if (char === "\\" && body[i + 1] === "|") {
      current += "|";
      i++;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

const isTableDivider = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      // An unclosed fence (an answer still streaming) runs to the end.
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]!); i++) code.push(lines[i]!);
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    if (/^\s*\|/.test(line)) {
      flush();
      const raw: string[] = [];
      for (; i < lines.length && /^\s*\|/.test(lines[i]!); i++) raw.push(lines[i]!);
      i--;
      const hasHeader = raw.length > 1 && isTableDivider(raw[1]!);
      const body = raw.filter((row) => !isTableDivider(row)).map(splitRow);
      blocks.push(hasHeader ? { kind: "table", header: body[0]!, rows: body.slice(1) } : { kind: "table", header: [], rows: body });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1]!.length, text: heading[2]! });
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      const previous = blocks[blocks.length - 1];
      if (previous?.kind === "quote") previous.text += "\n" + quote[1]!;
      else blocks.push({ kind: "quote", text: quote[1]! });
      continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const marker = /\d/.test(item[2]!) ? item[2]! : "•";
      blocks.push({ kind: "item", marker, indent: Math.min(3, Math.floor(item[1]!.length / 2)), text: item[3]! });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)]+\))/g;

function renderInline(text: string, colors: Colors): ReactNode {
  return text.split(INLINE).map((part, index) => {
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      return (
        <Text
          key={index}
          style={{ fontFamily: MONO, fontSize: 12, backgroundColor: colors.surface2, color: colors.foreground }}
        >
          {` ${part.slice(1, -1)} `}
        </Text>
      );
    }
    if (part.length > 4 && ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__")))) {
      return (
        <Text key={index} style={{ fontWeight: "700" }}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) {
      return (
        <Text key={index} style={{ fontStyle: "italic" }}>
          {part.slice(1, -1)}
        </Text>
      );
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      const url = link[2]!.trim();
      // Only web links open; anything else (file paths, javascript:) stays plain text.
      if (!/^https?:\/\//i.test(url)) {
        return <Fragment key={index}>{`${link[1]} (${url})`}</Fragment>;
      }
      return (
        <Text
          key={index}
          accessibilityRole="link"
          style={{ color: colors.accent, textDecorationLine: "underline" }}
          onPress={() => void openExternalUrl(url).catch(() => {})}
        >
          {link[1]}
        </Text>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}
