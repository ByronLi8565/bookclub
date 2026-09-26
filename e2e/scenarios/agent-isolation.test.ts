import { expect } from "vitest";
import { WebSocket } from "ws";
import { scenario } from "../src/scenario.ts";
import type { Identity } from "../src/surfaces/api.ts";

interface AgentFrame {
  readonly type?: string;
  readonly state?: object;
}

/** Opens a raw Agents SDK socket and reports how the worker answered: the
 *  upgrade's HTTP status, and any state the agent pushed once connected. */
function probeAgent(
  baseUrl: string,
  path: string,
  who: Identity,
  send?: unknown,
): Promise<{ status: number; state: object | null }> {
  const ws = new WebSocket(`${baseUrl.replace(/^http/u, "ws")}${path}`, {
    headers: { Cookie: who.cookie },
  });
  return new Promise((resolve, reject) => {
    let state: object | null = null;
    ws.on("unexpected-response", (_request, response) => {
      resolve({ status: response.statusCode ?? 0, state });
      ws.terminate();
    });
    ws.on("message", (data) => {
      // SAFETY: agents frames are JSON objects tagged by `type`.
      const frame = JSON.parse(String(data)) as AgentFrame;
      if (frame.type === "cf_agent_state") state = frame.state ?? null;
    });
    ws.on("open", () => {
      if (send !== undefined) ws.send(JSON.stringify(send));
      setTimeout(() => {
        ws.close();
        resolve({ status: 101, state });
      }, 500);
    });
    ws.on("error", reject);
  });
}

scenario(
  "Security · account, club, and registry agents are unreachable over raw agent sockets",
  {},
  async (ctx) => {
    const api = ctx.need("api");
    const victim = await api.newIdentity({ label: "victim" });
    const attacker = await api.newIdentity({ label: "attacker" });
    const group = await api.createGroup(victim, "Private Club");

    for (const path of [
      `/agents/auth-agent/${encodeURIComponent(victim.user.email)}`,
      `/agents/group-agent/${group.groupId}`,
      `/agents/group-registry/global`,
    ]) {
      const probe = await probeAgent(ctx.target.baseUrl, path, attacker);
      expect(probe.state, `${path} leaks no agent state`).toBeNull();
      expect(probe.status, `${path} never upgrades to an agent socket`).not.toBe(101);
    }

    const notes = await probeAgent(
      ctx.target.baseUrl,
      `/agents/note-agent/${group.groupId}`,
      attacker,
    );
    expect(notes.state, "a non-member receives none of the club's notes").toBeNull();
    expect(notes.status, "a non-member is refused the club's note room").toBe(403);
  },
);

scenario(
  "Security · a member cannot overwrite a club's notes by pushing raw agent state",
  {},
  async (ctx) => {
    const api = ctx.need("api");
    const notes = ctx.need("notes");
    const owner = await api.newIdentity({ label: "owner" });
    const member = await api.newIdentity({ label: "member" });
    const group = await api.createGroup(owner, "Guarded Notes Club");
    const ref = api.refFor(group);
    await api.join(member, ref, await api.inviteLink(owner, ref));

    const session = await notes.connect(group.groupId, owner);
    ctx.onCleanup(() => session.close());
    await session.addNote("source-1", "the owner's note");
    await session.waitForNotes((list) => list.some((note) => note.body === "the owner's note"));

    await probeAgent(ctx.target.baseUrl, `/agents/note-agent/${group.groupId}`, member, {
      type: "cf_agent_state",
      state: { notes: [], pendingImageDeletes: [] },
    });

    const reconnected = await notes.connect(group.groupId, owner);
    ctx.onCleanup(() => reconnected.close());
    const survived = await reconnected.waitForNotes((list) => list.length > 0);
    expect(
      survived.map((note) => note.body),
      "a client-pushed state frame never replaces the club's notes",
    ).toContain("the owner's note");
  },
);
