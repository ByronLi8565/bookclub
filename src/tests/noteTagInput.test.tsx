// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteTagInput } from "../client/ui/notes/NoteTagInput.tsx";

describe("NoteTagInput", () => {
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

  it("filters by every tag but only removes editable tags", async () => {
    const onFilter = vi.fn();
    const onRemove = vi.fn();
    await act(() =>
      root.render(
        <NoteTagInput
          tags={["highlight", "question"]}
          editable
          onFilter={onFilter}
          onRemove={onRemove}
        />,
      ),
    );

    const tags = container.querySelectorAll<HTMLButtonElement>(".note-tag > button:first-child");
    expect(tags).toHaveLength(1);
    expect(tags[0]?.textContent).toBe("question");
    await act(() => tags[0]?.click());
    expect(onFilter).toHaveBeenCalledWith("question");
    expect(container.textContent).not.toContain("#highlight");

    await act(() =>
      container.querySelector<HTMLButtonElement>("[aria-label='Remove #question']")?.click(),
    );
    expect(onRemove).toHaveBeenCalledWith("question");
  });
});
