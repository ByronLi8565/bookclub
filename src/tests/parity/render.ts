import { Runtime } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import type { Schema } from "effect";
import { vi } from "vitest";

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
  await new Promise((resolve) => {
    setTimeout(resolve, 350);
  });
  const html = document.body.innerHTML;
  handle.dispose();
  document.body.replaceChildren();
  return detach(html);
};
