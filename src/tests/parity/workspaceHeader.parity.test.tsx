// @vitest-environment jsdom

import { beforeEach, describe, it } from "vitest";
import { WorkspaceHeader } from "../../client/ui/workspace/WorkspaceHeader.tsx";
import {
  Model,
  init,
  workspaceHeaderView,
  type Message,
} from "../../client/foldkit/application.ts";
import {
  enableReactActEnvironment,
  expectParity,
  renderFoldkit,
  renderReact,
  stubAnimationFrame,
} from "./parity.ts";

const noop = (): void => {};

/**
 * The one place the two headers are allowed to differ: React's "back to your
 * clubs" is an anchor because it navigates by URL, and Foldkit's is a button
 * because its route still lives in the Model. Everything else about the control
 * — its class, its label — is compared as written.
 */
const routingDeviation = (line: string): string =>
  /\b(?:a|button)\.topbar-home\b/u.test(line)
    ? line
        .replace(/\b(?:a|button)\.topbar-home\b/u, "backToClubs")
        .replace(/type=button ?/u, "")
        .replace(/ ?href=\//u, "")
    : line;

describe("workspace header parity", () => {
  beforeEach(() => {
    enableReactActEnvironment();
    stubAnimationFrame();
  });

  it("renders the same topbar as React", async () => {
    const peers = [
      { id: "reader-1", name: "Reader One", role: "member" as const },
      { id: "reader-2", name: "Reader Two", role: "member" as const },
    ];
    const [initial] = init();
    const model: Model = { ...initial, notes: { ...initial.notes, peers } };

    const react = await renderReact(
      <WorkspaceHeader
        displayName="Club Alpha"
        onRename={noop}
        onlineCount={peers.length}
        onShowPeople={noop}
        onShowSettings={noop}
        onShowInfo={noop}
      />,
    );
    const foldkit = await renderFoldkit<Model, Message>({
      Model,
      model,
      view: (current, h) => workspaceHeaderView(current, "Club Alpha", h),
    });

    expectParity(react, foldkit, { rewrite: routingDeviation });
  });
});
