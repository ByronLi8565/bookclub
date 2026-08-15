// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastViewport } from "../client/ui/shared/toast/ToastViewport.tsx";
import { BUG_REPORT_EMAIL, reportUnexpectedError } from "../client/ui/shared/toast/reportError.ts";

describe("unexpected error toast", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    // SAFETY: React's test-only act flag is intentionally absent from the standard global type.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("explains the failure and links to a prefilled bug report", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await act(() => root.render(<ToastViewport />));

    await act(() =>
      reportUnexpectedError({
        title: "Page couldn't turn",
        message: "Bookclub couldn't turn to the next EPUB page.",
        context: "failed to turn epub page next",
        error: new Error("No Section Found"),
      }),
    );

    expect(container.textContent).toContain("Bookclub couldn't turn to the next EPUB page.");
    const report = container.querySelector<HTMLAnchorElement>("a");
    expect(report?.textContent).toBe("File a bug report");
    expect(report?.getAttribute("href")).toContain(`mailto:${BUG_REPORT_EMAIL}?`);

    const query = new URLSearchParams(report?.getAttribute("href")?.split("?")[1]);
    expect(query.get("subject")).toBe("Bookclub bug: Page couldn't turn");
    expect(query.get("body")).toContain("What I was doing:");

    await act(() => container.querySelector<HTMLButtonElement>("button")?.click());
  });
});
