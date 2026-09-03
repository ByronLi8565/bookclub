import { expect } from "vitest";
import { scenario } from "../src/scenario.ts";

scenario(
  "Invites · rotating a link revokes the old one and the replacement joins a member",
  {},
  async (ctx) => {
    const api = ctx.need("api");

    const owner = await api.newIdentity({ label: "owner" });
    const reader = await api.newIdentity({ label: "reader" });
    const group = await api.createGroup(owner, "Rotating Invite Club");
    const ref = api.refFor(group);

    const staleToken = await api.inviteLink(owner, ref);
    const rotated = await api.request(owner, `/groups/${ref}/invite-link?rotate=1`, {
      method: "POST",
    });
    expect(rotated.status, "a member can replace the club's open invite").toBe(200);
    // SAFETY: the successful rotate response contains the current invite token.
    const { token: currentToken } = (await rotated.json()) as { token: string };
    expect(currentToken, "rotation mints a different token").not.toBe(staleToken);

    const staleJoin = await api.request(reader, `/groups/${ref}/join`, {
      method: "POST",
      body: JSON.stringify({ token: staleToken }),
    });
    expect(staleJoin.status, "the replaced link can no longer admit somebody").toBe(403);
    expect(await staleJoin.json(), "the refusal is specifically an invalid invite").toMatchObject({
      error: "bad_invite",
    });

    const joined = await api.join(reader, ref, currentToken);
    expect(joined.memberCount, "the replacement link admits the reader").toBe(2);

    const joinedAgain = await api.join(reader, ref, currentToken);
    expect(joinedAgain.memberCount, "reopening a valid invite does not duplicate membership").toBe(
      2,
    );
  },
);
