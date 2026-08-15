// @vitest-environment jsdom

import { beforeEach, describe, it, vi } from "vitest";
import { SettingsModal } from "../../client/ui/workspace/SettingsModal.tsx";
import {
  SettingsModel,
  initialSettingsModel,
  settingsView,
  type SettingsMessage,
} from "../../client/foldkit/settings.ts";
import {
  Model as AppModel,
  accountSectionView,
  init as appInit,
  type Message as AppMessage,
} from "../../client/foldkit/application.ts";
import {
  enableReactActEnvironment,
  expectParity,
  renderFoldkit,
  renderReact,
  stubAnimationFrame,
} from "./parity.ts";

const Close = { _tag: "Close" } as const;

const book = {
  groupId: "group-1",
  slug: "club-alpha",
  publicId: "public-1",
  profile: { id: "reader-1", displayName: "Reader One" },
};

const foldkitSettings = (overrides: Partial<SettingsModel>, signedIn: boolean, withBook: boolean) =>
  renderFoldkit<SettingsModel, typeof Close | SettingsMessage>({
    Model: SettingsModel,
    model: { ...initialSettingsModel(), ...overrides },
    view: (model, h) =>
      settingsView(model, { book: withBook ? book : null, signedIn, onClose: Close }, h),
  });

describe("settings modal parity", () => {
  beforeEach(() => {
    enableReactActEnvironment();
    stubAnimationFrame();
    localStorage.clear();
    // React's account page fetches its passkeys on mount; jsdom has no origin to
    // resolve the relative URL against.
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("{}", { status: 200 })));
  });

  it("renders the reader page the way React does", async () => {
    const react = await renderReact(
      <SettingsModal
        book={{ groupId: book.groupId, profile: book.profile, onProfileChange: () => {} }}
        signedIn
        onClose={() => {}}
      />,
    );
    expectParity(react, await foldkitSettings({}, true, true));
  });

  it("renders account settings the way React does", async () => {
    // The account page is React's `AccountSettings`, which the shell passes into
    // the modal rather than the settings module keeping a second copy — so this
    // is the host's composition under test, not the module's alone.
    const react = await renderReact(<SettingsModal onClose={() => {}} />);
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
    expectParity(react, foldkit);
  });
});
