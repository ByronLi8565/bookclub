import { describe, expect, it, vi } from "vitest";
import type { Env } from "../server/env.ts";
import { sendInvite } from "../server/services/email.ts";

describe("invite email", () => {
  it("escapes a club name before placing it in HTML", async () => {
    const messages: { html: string }[] = [];
    const send = vi.fn((message: { html: string }) => {
      messages.push(message);
      return Promise.resolve();
    });
    const env = { EMAIL: { send }, EMAIL_FROM: "bookclub@example.com" } as unknown as Env;

    await sendInvite(
      env,
      "reader@example.com",
      '<img src=x onerror="alert(1)">',
      "https://bookclub.example/clubs/test?invite=token",
    );

    const message = messages[0];
    expect(message?.html).toContain('&lt;img src=x onerror="alert(1)"&gt;');
    expect(message?.html).not.toContain('<img src=x onerror="alert(1)">');
  });
});
