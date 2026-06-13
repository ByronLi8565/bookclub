import { routeAgentRequest } from "agents";
import type { Env } from "./env.ts";

export { NoteAgent } from "./NoteAgent.ts";

// Route agent (websocket + rpc) traffic to the NoteAgent durable object; fall
// back to the Vite-built client assets for everything else.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (await routeAgentRequest(request, env)) ?? env.ASSETS.fetch(request);
  },
};
