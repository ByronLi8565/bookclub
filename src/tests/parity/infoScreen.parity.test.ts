// @vitest-environment jsdom

import { beforeEach, describe, it } from "vitest";
import {
  InfoModel,
  infoView,
  initialInfoModel,
  type InfoMessage,
} from "../../client/foldkit/info.ts";
import { expectRecordedParity, renderFoldkit, stubAnimationFrame } from "./parity.ts";

const Close = { _tag: "Close" } as const;

describe("info screen parity", () => {
  beforeEach(stubAnimationFrame);

  it("renders the info page React rendered", async () => {
    const foldkit = await renderFoldkit<InfoModel, typeof Close | InfoMessage>({
      Model: InfoModel,
      model: initialInfoModel(),
      view: (model, h) => infoView(model, { onClose: Close }, h),
    });
    expectRecordedParity("info-screen", foldkit);
  });
});
