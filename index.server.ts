import type { PluginServerContext } from "@getpaseo/plugin/server";
import { AsideService } from "./server/aside";
import { locateAgent } from "./server/locate";
import { askRpc, clearRpc, locateRpc, preferences, stopRpc, threadRpc } from "./shared/contracts";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(preferences);
  const service = new AsideService(async () => {
    const state = await settings.read();
    return state.status === "ready" ? state.values : preferences.schema.parse({});
  });

  server.handle(askRpc, ({ agentId, question, requestId }, { paseo }) => service.ask(paseo, agentId, question, requestId));
  server.handle(threadRpc, ({ agentId }) => service.thread(agentId));
  server.handle(stopRpc, ({ agentId, exchangeId }) => service.stop(agentId, exchangeId));
  server.handle(clearRpc, ({ agentId }) => service.clear(agentId));
  server.handle(locateRpc, (input, { paseo }) => locateAgent(paseo, input));

  return () => service.dispose();
}
