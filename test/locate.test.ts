import assert from "node:assert/strict";
import { test } from "node:test";
import { locateAgent, normalize, selectionNeedles } from "../server/locate.ts";

interface FakeAgent {
  id: string;
  workspaceId: string;
  updatedAt: string;
  items: Array<Record<string, unknown>>;
}

function fakePaseo(agents: FakeAgent[]) {
  return {
    agents: {
      list: async () => ({
        entries: agents.map((agent) => ({
          agent: { id: agent.id, workspaceId: agent.workspaceId, updatedAt: agent.updatedAt, status: "idle", archivedAt: null },
        })),
      }),
      ref: (id: string) => ({
        timeline: {
          refetch: async () => ({ entries: agents.find((agent) => agent.id === id)!.items.map((item) => ({ item })) }),
        },
      }),
    },
  } as never;
}

const worker: FakeAgent = {
  id: "worker",
  workspaceId: "w1",
  updatedAt: "2026-10-25T07:00:00Z",
  items: [{ type: "assistant_message", text: "**Kết luận:** tab 帳票別 có 13 dòng nhưng chưa trọn vẹn." }],
};
const lead: FakeAgent = {
  id: "lead",
  workspaceId: "w1",
  updatedAt: "2026-10-25T07:05:00Z",
  // The lead received the worker's report as a message from another agent.
  items: [
    {
      type: "tool_call",
      detail: { type: "unknown" },
      agentMessage: { text: "**Kết luận:** tab 帳票別 có 13 dòng nhưng chưa trọn vẹn." },
    },
  ],
};
const elsewhere: FakeAgent = { id: "other", workspaceId: "w2", updatedAt: "2026-10-25T07:10:00Z", items: [] };

test("normalize drops Markdown syntax and spacing", () => {
  assert.equal(normalize("**Kết luận:**   tab `x`"), "kết luận: tab x");
});

test("normalize keeps only the label of a Markdown link, as it is rendered", () => {
  assert.equal(
    normalize("SDK: [plugin contracts](https://paseo.sh/docs/plugins), [UI API](./ui.md \"UI\") and <https://x.dev>"),
    "sdk: plugin contracts, ui api and https://x.dev",
  );
});

test("selectionNeedles uses the longest lines and ignores tiny selections", () => {
  assert.deepEqual(selectionNeedles("ok\nthe longest line here\nmid line"), ["the longest line here", "mid line"]);
  assert.deepEqual(selectionNeedles("ok"), []);
});

test("finds a rendered selection of linked text in the agent that wrote it", async () => {
  const reviewer: FakeAgent = {
    id: "reviewer",
    workspaceId: "w1",
    updatedAt: "2026-10-25T07:00:00Z",
    items: [
      {
        type: "assistant_message",
        text: "## Nguồn đã tham khảo\n- Mã nguồn và SDK cài đặt: [plugin contracts](https://a.dev/x), [React Native API](https://a.dev/y).",
      },
    ],
  };
  // The newer lead only received part of the report, with its links.
  const relay: FakeAgent = {
    id: "relay",
    workspaceId: "w1",
    updatedAt: "2026-10-25T08:00:00Z",
    items: [{ type: "tool_call", detail: { type: "unknown", output: "## Nguồn đã tham khảo" } }],
  };
  const located = await locateAgent(fakePaseo([reviewer, relay]), {
    workspaceIds: ["w1"],
    agentId: null,
    text: "Nguồn đã tham khảo\nMã nguồn và SDK cài đặt: plugin contracts, React Native API.",
    preferredAgentIds: ["relay"],
  });
  assert.deepEqual(located, { agentId: "reviewer", workspaceId: "w1", matched: true });
});

test("prefers the agent that wrote the text over one that relayed it", async () => {
  const located = await locateAgent(fakePaseo([worker, lead, elsewhere]), {
    workspaceIds: ["w1"],
    agentId: null,
    text: "Kết luận: tab 帳票別 có 13 dòng nhưng chưa trọn vẹn.",
    preferredAgentIds: [],
  });
  assert.deepEqual(located, { agentId: "worker", workspaceId: "w1", matched: true });
});

test("an agent route wins without searching", async () => {
  const located = await locateAgent(fakePaseo([worker, lead]), {
    workspaceIds: [],
    agentId: "lead",
    text: "anything at all here",
    preferredAgentIds: [],
  });
  assert.deepEqual(located, { agentId: "lead", workspaceId: "w1", matched: true });
});

test("unmatched text with several agents is not guessed", async () => {
  const located = await locateAgent(fakePaseo([worker, lead, elsewhere]), {
    workspaceIds: ["w1"],
    agentId: null,
    text: "text that appears nowhere",
    preferredAgentIds: ["lead", "worker"],
  });
  assert.equal(located, null);
});

test("short CJK selections are still searched", () => {
  assert.deepEqual(selectionNeedles("帳票別"), ["帳票別"]);
  assert.deepEqual(selectionNeedles("ab"), []);
});

test("outside a known workspace, a lone agent still has to contain the text", async () => {
  const located = await locateAgent(fakePaseo([worker]), {
    workspaceIds: [],
    agentId: null,
    text: "text that appears nowhere",
    preferredAgentIds: [],
  });
  assert.equal(located, null);
});
