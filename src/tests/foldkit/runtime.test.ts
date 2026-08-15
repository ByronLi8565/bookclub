// @vitest-environment jsdom

import { Effect, Schema } from "effect";
import { Mount, Runtime } from "foldkit";
import { m } from "foldkit/message";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Foldkit runtime", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 0),
    );
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("updates from DOM messages and releases a mounted resource", async () => {
    const Model = Schema.Struct({ count: Schema.Number });
    type Model = typeof Model.Type;
    const Incremented = m("Incremented");
    const Mounted = m("Mounted");
    type Message = typeof Incremented.Type | typeof Mounted.Type;
    const lifecycle: string[] = [];
    const ScopedResource = Mount.define(
      "ScopedResource",
      Mounted,
    )(() =>
      Effect.acquireRelease(
        Effect.sync(() => lifecycle.push("acquired")),
        () => Effect.sync(() => lifecycle.push("released")),
      ).pipe(Effect.as(Mounted())),
    );
    const container = document.createElement("div");
    container.id = "foldkit-runtime-test";
    document.body.appendChild(container);

    const handle = Runtime.embed(
      Runtime.makeElement<Model, Message>({
        Model,
        container,
        init: () => [{ count: 0 }, []],
        update: (model, message) => [
          Schema.is(Incremented)(message) ? { count: model.count + 1 } : model,
          [],
        ],
        view: (model, h) =>
          h.main(
            [h.OnMount(ScopedResource())],
            [h.button([h.OnClick(Incremented())], [String(model.count)])],
          ),
        devTools: false,
        slow: false,
      }),
    );

    const button = () => document.querySelector<HTMLButtonElement>("button");
    await vi.waitFor(() => expect(button()?.textContent).toBe("0"));
    expect(lifecycle).toEqual(["acquired"]);

    button()?.click();
    await vi.waitFor(() => expect(button()?.textContent).toBe("1"));

    handle.dispose();
    await vi.waitFor(() => expect(lifecycle).toEqual(["acquired", "released"]));
  });
});
