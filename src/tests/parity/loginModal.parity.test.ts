// @vitest-environment jsdom

import { beforeEach, describe, it, vi } from "vitest";
import { Model, init, loginModalView, type Message } from "../../client/foldkit/application.ts";
import { expectRecordedParity, renderFoldkit, stubAnimationFrame } from "./parity.ts";

const EMAIL = "reader@example.com";

const foldkitLogin = (overrides: Partial<Model>) => {
  const [initial] = init();
  return renderFoldkit<Model, Message>({
    Model,
    model: { ...initial, passkeysAvailable: true, ...overrides },
    view: loginModalView,
  });
};

describe("login modal parity", () => {
  beforeEach(() => {
    stubAnimationFrame();
    // The recording was made with passkey support present, so it is pinned on
    // here too — jsdom answers no on its own.
    vi.stubGlobal("PublicKeyCredential", function PublicKeyCredential() {});
  });

  it("renders the email step React rendered", async () => {
    expectRecordedParity("login-email-step", await foldkitLogin({}));
  });

  it("renders a typed email and password the way React did", async () => {
    expectRecordedParity(
      "login-typed",
      await foldkitLogin({ loginEmail: EMAIL, loginPassword: "hunter2" }),
    );
  });

  it("renders the code step React rendered", async () => {
    expectRecordedParity(
      "login-code-step",
      await foldkitLogin({ loginEmail: EMAIL, loginStep: "code" }),
    );
  });

  it("renders the wrong-password error React rendered", async () => {
    expectRecordedParity(
      "login-wrong-password",
      await foldkitLogin({
        loginEmail: EMAIL,
        loginPassword: "wrong",
        loginError: "Wrong password. Try again, or sign in with a code.",
      }),
    );
  });
});
