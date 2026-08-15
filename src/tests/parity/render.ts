import { Runtime } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import type { ReactElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Schema } from "effect";
import { vi } from "vitest";

/** React's test-only act flag is deliberately absent from the standard global
 *  type, and every parity test needs it set. */
export const enableReactActEnvironment = (): void => {
  // SAFETY: React's test-only act flag is deliberately absent from the standard
  // global type; writing it is the documented way to enable act().
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
};

/** jsdom has no frame loop, and Foldkit's runtime schedules its first paint on
 *  one. */
export const stubAnimationFrame = (): void => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => {
      callback(performance.now());
    }, 0),
  );
};

const detach = (html: string): HTMLElement => {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return holder;
};

/** Renders a React tree and hands back a detached copy, so the caller compares
 *  markup rather than a live tree that is still subject to effects. */
export const renderReact = async (
  element: ReactElement,
  /** Drives the component into the state under comparison, the way a reader
   *  would: React reaches most of its states by interaction, where Foldkit
   *  reaches them by Model. */
  interact?: (container: HTMLElement) => Promise<void> | void,
): Promise<HTMLElement> => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  // Effects that run on mount (delayed flags, measurement) settle first.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  if (interact !== undefined) {
    await act(async () => {
      await interact(container);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  }
  const html = container.innerHTML;
  await act(async () => root.unmount());
  container.remove();
  return detach(html);
};

/**
 * Renders a Foldkit view the way the application does. `Runtime.embed` replaces
 * its container rather than filling it, so the tree lands in `document.body`
 * and is captured from there before the runtime tears it down.
 */
export const renderFoldkit = async <Model, Message extends { readonly _tag: string }>({
  Model,
  model,
  view,
}: {
  Model: Schema.Schema<Model>;
  model: Model;
  view: (model: Model, h: HtmlBuilder<Message>) => Html;
}): Promise<HTMLElement> => {
  const container = document.createElement("div");
  // The runtime mounts by container id; an id-less container is never replaced.
  container.id = `parity-${crypto.randomUUID()}`;
  document.body.appendChild(container);
  const handle = Runtime.embed(
    Runtime.makeElement<Model, Message>({
      Model,
      container,
      init: () => [model, []],
      update: (current) => [current, []],
      view,
      devTools: false,
      slow: false,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  const html = document.body.innerHTML;
  handle.dispose();
  document.body.replaceChildren();
  return detach(html);
};
