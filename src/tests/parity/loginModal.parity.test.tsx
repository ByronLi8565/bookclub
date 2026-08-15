// @vitest-environment jsdom

import { beforeEach, describe, it, vi } from "vitest";
import { LoginModal } from "../../client/ui/shared/Login.tsx";
import { Model, init, loginModalView, type Message } from "../../client/foldkit/application.ts";
import {
  enableReactActEnvironment,
  expectParity,
  renderFoldkit,
  renderReact,
  stubAnimationFrame,
} from "./parity.ts";
import { testSession } from "./session.ts";

const EMAIL = "reader@example.com";

const session = testSession();

const type = (input: Element | null, value: string): void => {
  if (!(input instanceof HTMLInputElement)) throw new Error("no such field");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const submit = (container: HTMLElement): void => {
  container
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
};

const foldkitLogin = (overrides: Partial<Model>) => {
  const [initial] = init();
  return renderFoldkit<Model, Message>({
    Model,
    model: { ...initial, passkeysAvailable: true, ...overrides },
    view: (model, h) => loginModalView(model, h),
  });
};

describe("login modal parity", () => {
  beforeEach(() => {
    enableReactActEnvironment();
    stubAnimationFrame();
    // Both renderers ask the browser the same question and jsdom answers no, so
    // passkey support is pinned on for the comparison.
    vi.stubGlobal("PublicKeyCredential", function PublicKeyCredential() {});
  });

  it("renders the email step the way React does", async () => {
    const react = await renderReact(<LoginModal session={session} onClose={() => {}} />);
    expectParity(react, await foldkitLogin({}));
  });

  it("renders a typed email and password the way React does", async () => {
    const react = await renderReact(
      <LoginModal session={session} onClose={() => {}} />,
      (container) => {
        type(container.querySelector('input[type="email"]'), EMAIL);
        type(container.querySelector('input[type="password"]'), "hunter2");
      },
    );
    expectParity(react, await foldkitLogin({ loginEmail: EMAIL, loginPassword: "hunter2" }));
  });

  it("renders the code step the way React does", async () => {
    const react = await renderReact(
      <LoginModal session={session} onClose={() => {}} />,
      async (container) => {
        type(container.querySelector('input[type="email"]'), EMAIL);
        submit(container);
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
    );
    expectParity(react, await foldkitLogin({ loginEmail: EMAIL, loginStep: "code" }));
  });

  it("renders the wrong-password error the way React does", async () => {
    const react = await renderReact(
      <LoginModal session={session} onClose={() => {}} />,
      async (container) => {
        type(container.querySelector('input[type="email"]'), EMAIL);
        type(container.querySelector('input[type="password"]'), "wrong");
        submit(container);
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
    );
    expectParity(
      react,
      await foldkitLogin({
        loginEmail: EMAIL,
        loginPassword: "wrong",
        loginError: "Wrong password. Try again, or sign in with a code.",
      }),
    );
  });
});
