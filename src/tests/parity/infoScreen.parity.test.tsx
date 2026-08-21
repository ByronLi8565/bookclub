// @vitest-environment jsdom

import { beforeEach, describe, it } from "vitest";
import { InfoScreen } from "../../client/ui/shared/InfoScreen.tsx";
import {
  InfoModel,
  infoView,
  initialInfoModel,
  type InfoMessage,
} from "../../client/foldkit/info.ts";
import {
  enableReactActEnvironment,
  expectParity,
  renderFoldkit,
  renderReact,
  stubAnimationFrame,
} from "./parity.ts";

const Close = { _tag: "Close" } as const;

describe("info screen parity", () => {
  beforeEach(() => {
    enableReactActEnvironment();
    stubAnimationFrame();
  });

  it("renders the info page the way React does", async () => {
    const react = await renderReact(<InfoScreen onClose={() => {}} />);
    const foldkit = await renderFoldkit<InfoModel, typeof Close | InfoMessage>({
      Model: InfoModel,
      model: initialInfoModel(),
      view: (model, h) => infoView(model, { onClose: Close }, h),
    });
    expectParity("info-screen", react, foldkit);
  });
});
