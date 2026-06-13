import { routeAgentRequest } from "agents";
import type { Env } from "./env.ts";

export { NoteAgent } from "./NoteAgent.ts";

// Route agent (websocket + rpc) traffic to the NoteAgent durable object; fall
// back to the Vite-built client assets for everything else.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;
    // In `wrangler dev` there is no ASSETS binding: the client is served by the
    // vite dev server on :5173, which proxies /agents here. Only the deployed
    // worker serves the built client.
    if (!env.ASSETS) {
      return new Response("Run the client via the vite dev server (npm run dev).", { status: 404 });
    }
    return env.ASSETS.fetch(request);
  },
};
