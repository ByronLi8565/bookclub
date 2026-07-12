// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenamableText } from "../client/ui/shared/RenamableText.tsx";

describe("RenamableText", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => root.unmount());
    container.remove();
  });

  it("commits and closes when a pointer lands outside the input", async () => {
    const onRename = vi.fn();
    await act(() => root.render(<RenamableText value="Original" onRename={onRename} />));
    await act(() => {
      container.querySelector("span")?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    const input = container.querySelector("input")!;
    await act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(input, "Renamed");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));

    expect(onRename).toHaveBeenCalledWith("Renamed");
    expect(container.querySelector("input")).toBeNull();
  });
});
