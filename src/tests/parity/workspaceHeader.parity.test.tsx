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

    expectParity("workspace-header", react, foldkit);
  });
});
