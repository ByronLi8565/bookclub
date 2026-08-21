// @vitest-environment jsdom

import { beforeEach, describe, it } from "vitest";
import {
  Model,
  init,
  workspaceHeaderView,
  type Message,
} from "../../client/foldkit/application.ts";
import { expectRecordedParity, renderFoldkit, stubAnimationFrame } from "./parity.ts";

describe("workspace header parity", () => {
  beforeEach(stubAnimationFrame);

  it("renders the topbar React rendered", async () => {
    const peers = [
      { id: "reader-1", name: "Reader One", role: "member" as const },
      { id: "reader-2", name: "Reader Two", role: "member" as const },
    ];
    const [initial] = init();
    const foldkit = await renderFoldkit<Model, Message>({
      Model,
      model: { ...initial, notes: { ...initial.notes, peers } },
      view: (current, h) => workspaceHeaderView(current, "Club Alpha", h),
    });

    expectRecordedParity("workspace-header", foldkit);
  });
});
