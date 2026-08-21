// @vitest-environment jsdom

import { beforeEach, describe, it } from "vitest";
import {
  Model as AppModel,
  accountSectionView,
  init as appInit,
  type Message as AppMessage,
} from "../../client/foldkit/application.ts";
import {
  SettingsModel,
  initialSettingsModel,
  settingsView,
  type SettingsMessage,
} from "../../client/foldkit/settings.ts";
import { expectRecordedParity, renderFoldkit, stubAnimationFrame } from "./parity.ts";

const Close = { _tag: "Close" } as const;

const book = {
  groupId: "group-1",
  slug: "club-alpha",
  publicId: "public-1",
  profile: { id: "reader-1", displayName: "Reader One" },
};

describe("settings modal parity", () => {
  beforeEach(() => {
    stubAnimationFrame();
    localStorage.clear();
  });

  it("renders the reader page React rendered", async () => {
    const foldkit = await renderFoldkit<SettingsModel, typeof Close | SettingsMessage>({
      Model: SettingsModel,
      model: initialSettingsModel(),
      view: (model, h) => settingsView(model, { book, signedIn: true, onClose: Close }, h),
    });
    expectRecordedParity("settings-reader", foldkit);
  });

  it("renders the account page React rendered", async () => {
    // The account page is the shell's to pass in rather than the settings
    // module's to own, so this is the host's composition under test.
    const [initial] = appInit();
    const foldkit = await renderFoldkit<AppModel, AppMessage>({
      Model: AppModel,
      model: initial,
      view: (model, h) =>
        settingsView(
          model.settings,
          {
            book: null,
            signedIn: false,
            // SAFETY: the modal only ever hands this value back to the runtime
            // as the close Message, and this render's update ignores every message.
            onClose: Close as never,
            accountSection: accountSectionView(model, h),
          },
          h,
        ),
    });
    expectRecordedParity("settings-account", foldkit);
  });
});
