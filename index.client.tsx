import type { PluginAgentPanelProps, PluginClientContext } from "@getpaseo/plugin/client";
import { Platform } from "react-native";
import { AsideView } from "./client/aside-view";
import { clearPendingQuote, deliverDraft, deliverQuote, openViewAgentIds, quoteButtonColors, recentAgentIds } from "./client/quote-store";
import { AsideSettings } from "./client/settings";
import { currentRoute, watchSelection } from "./client/web";
import { askRpc, locateRpc, readableError } from "./shared/contracts";

const PANEL_ID = "aside";
const ICON = "MessageCircle";

function AsidePanel(props: PluginAgentPanelProps) {
  return <AsideView {...props} />;
}

// Explorer sits beside the chat on desktop and web; native apps open a workspace tab.
const PANEL_LOCATION = Platform.OS === "web" ? ({ location: "explorer" } as const) : undefined;

export default function contribute(client: PluginClientContext) {
  // Find the agent the selection came from, then quote it into that agent's open view or
  // open its panel, which picks up the waiting quote when it mounts.
  const askAboutSelection = async (text: string): Promise<string | null> => {
    const route = currentRoute();
    try {
      const located = await client.rpc(locateRpc, {
        workspaceIds: route.workspaceIds,
        agentId: route.agentId,
        text,
        preferredAgentIds: [...new Set([...openViewAgentIds(), ...recentAgentIds()])].slice(0, 10),
      });
      if (!located) return "Not found in a chat here. Use /btw instead";
      if (deliverQuote(located.agentId, text)) return null;
      client.openPanel(PANEL_ID, { workspaceId: located.workspaceId, agentId: located.agentId, location: "explorer" });
      return null;
    } catch {
      return "Could not open Ask Aside";
    }
  };

  const removers = [
    // Desktop and web: selecting text shows an "Ask aside" button that quotes it into the panel.
    watchSelection({
      onAsk: askAboutSelection,
      colors: quoteButtonColors,
    }),
    client.addWorkspacePanel({
      id: PANEL_ID,
      title: "Ask Aside",
      icon: ICON,
      context: "agent",
      locations: ["explorer", "workspace"],
      Component: AsidePanel,
    }),
    client.addSettingsScreen({ id: "preferences", title: "Ask Aside", icon: ICON, Component: AsideSettings }),
    client.addCommandCenterItem({
      id: "open-aside",
      title: "Ask Aside: side questions about this agent",
      icon: ICON,
      keywords: ["btw", "side", "question", "aside"],
      context: "agent",
      onSelect({ openPanel }) {
        openPanel(PANEL_ID, PANEL_LOCATION);
      },
    }),
    ...["btw", "aside"].map((name) =>
      client.addSlashCommand({
        name,
        description: "Ask a read-only side question without interrupting the agent",
        argumentHint: "[question]",
        context: "agent",
        async onSubmit({ args, agent, rpc, openPanel }) {
          try {
            if (args) await rpc(askRpc, { agentId: agent.id, question: args });
          } catch (error) {
            // The message box is cleared either way, so keep the question in the panel's box.
            deliverDraft(agent.id, args, readableError(error instanceof Error ? error.message : String(error)));
          } finally {
            openPanel(PANEL_ID, PANEL_LOCATION);
          }
        },
      }),
    ),
  ];

  return () => {
    clearPendingQuote();
    for (const remove of removers) remove();
  };
}
