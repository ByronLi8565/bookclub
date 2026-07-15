import { useHotkey } from "@tanstack/react-hotkeys";
import * as Effect from "effect/Effect";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Pane } from "./WorkspaceLayout.tsx";
import { useAnyModalOpen } from "../shared/modalLayer.ts";
import { useIsMobile } from "../shared/hooks/useIsMobile.ts";
import { setReaderPref, useReaderPrefs } from "../../logic/settings/userPrefs.ts";
import { useLatestRef } from "../../logic/useLatestRef.ts";
import type { SourceView } from "../reader/useSourceView.ts";
import {
  stepChromeVisibility,
  stepExpandedPane,
  type ChromeVisibilityLevel,
  type ExpandedPane,
} from "./visibility.ts";

const CHROME_TRANSITION_FALLBACK_MS = 400;

export type WorkspaceModal = "group" | "settings" | "info";
const WORKSPACE_MODALS: WorkspaceModal[] = ["group", "settings", "info"];

export function useWorkspaceLayout() {
  const [activeModal, setActiveModal] = useState<WorkspaceModal | null>(null);
  const isMobile = useIsMobile();
  const [pane, setPane] = useState<Pane>("reader");
  const [desktopExpandedPane, setDesktopExpandedPane] = useState<ExpandedPane>(null);
  const [chromeLevel, setChromeLevel] = useState<ChromeVisibilityLevel>(0);
  const [chromeTransitioning, setChromeTransitioning] = useState(false);
  const chromeToggleFrameRef = useRef<number | null>(null);
  const chromeTransitionTimeoutRef = useRef<number | null>(null);
  const modalOpen = useAnyModalOpen();

  const finishChromeTransition = useCallback(() => {
    if (chromeTransitionTimeoutRef.current !== null) {
      window.clearTimeout(chromeTransitionTimeoutRef.current);
      chromeTransitionTimeoutRef.current = null;
    }
    setChromeTransitioning(false);
  }, []);

  const beginChromeTransition = useCallback(() => {
    setChromeTransitioning(true);
    if (chromeTransitionTimeoutRef.current !== null) {
      window.clearTimeout(chromeTransitionTimeoutRef.current);
    }
    chromeTransitionTimeoutRef.current = window.setTimeout(
      finishChromeTransition,
      CHROME_TRANSITION_FALLBACK_MS,
    );
  }, [finishChromeTransition]);

  const stepChrome = useCallback(
    (direction: "hide" | "show") => {
      const next = stepChromeVisibility(chromeLevel, direction);
      if (next === chromeLevel) return;
      beginChromeTransition();
      setChromeLevel(next);
    },
    [beginChromeTransition, chromeLevel],
  );

  const onSwipe = useCallback(
    (direction: "left" | "right" | "up" | "down") => {
      if (direction === "left") setPane("notes");
      else if (direction === "right") setPane("reader");
      else stepChrome(direction === "up" ? "hide" : "show");
    },
    [stepChrome],
  );

  const toggleChrome = useCallback(() => {
    if (chromeToggleFrameRef.current !== null) return;
    // Commit current geometry before changing the class so keyboard toggles
    // enter the same CSS transition used by swipe gestures.
    chromeToggleFrameRef.current = requestAnimationFrame(() => {
      chromeToggleFrameRef.current = null;
      beginChromeTransition();
      setChromeLevel((level) => (level === 0 ? 2 : 0));
    });
  }, [beginChromeTransition]);

  useEffect(
    () => () => {
      if (chromeToggleFrameRef.current !== null) cancelAnimationFrame(chromeToggleFrameRef.current);
      if (chromeTransitionTimeoutRef.current !== null) {
        window.clearTimeout(chromeTransitionTimeoutRef.current);
      }
    },
    [],
  );

  return {
    activeModal,
    setActiveModal,
    isMobile,
    pane,
    setPane,
    desktopExpandedPane,
    setDesktopExpandedPane,
    chromeLevel,
    chromeTransitioning,
    modalOpen,
    onSwipe,
    stepChrome,
    toggleChrome,
    finishChromeTransition,
  };
}

export function useWorkspaceReaderFit({
  fitToText,
  chromeTransitioning,
  desktopExpandedPane,
}: {
  fitToText: (() => void) | null;
  chromeTransitioning: boolean;
  desktopExpandedPane: ExpandedPane;
}): void {
  const fitToTextRef = useLatestRef(fitToText);
  const chromeMountedRef = useRef(false);

  useEffect(() => {
    if (chromeTransitioning) return;
    if (!chromeMountedRef.current) {
      chromeMountedRef.current = true;
      return;
    }
    fitToTextRef.current?.();
  }, [chromeTransitioning, fitToTextRef]);

  useEffect(() => {
    if (desktopExpandedPane !== "left") return;
    const timeout = window.setTimeout(() => fitToTextRef.current?.(), 240);
    return () => window.clearTimeout(timeout);
  }, [desktopExpandedPane, fitToTextRef]);
}

export function useWorkspaceHotkeys({
  view,
  sourceId,
  onSyncReadingPosition,
  layout,
}: {
  view: SourceView;
  sourceId: string;
  onSyncReadingPosition: (sourceId: string) => Effect.Effect<boolean, unknown>;
  layout: ReturnType<typeof useWorkspaceLayout>;
}): void {
  const { pdfPageLayout } = useReaderPrefs();
  const readerKeys = view.ready && !layout.modalOpen;
  const stepModal = (delta: number) => {
    if (!layout.activeModal) return;
    const index = WORKSPACE_MODALS.indexOf(layout.activeModal);
    layout.setActiveModal(
      WORKSPACE_MODALS[(index + delta + WORKSPACE_MODALS.length) % WORKSPACE_MODALS.length],
    );
  };

  useHotkey("Shift+ArrowLeft", () => stepModal(-1), {
    enabled: layout.activeModal !== null,
    preventDefault: true,
    conflictBehavior: "allow",
  });
  useHotkey("Shift+ArrowRight", () => stepModal(1), {
    enabled: layout.activeModal !== null,
    preventDefault: true,
    conflictBehavior: "allow",
  });
  useHotkey("ArrowLeft", () => view.prev(), { enabled: readerKeys });
  useHotkey("ArrowRight", () => view.next(), { enabled: readerKeys });
  useHotkey(
    "Shift+ArrowLeft",
    () => layout.setDesktopExpandedPane((expanded) => stepExpandedPane(expanded, "left")),
    { enabled: readerKeys && !layout.isMobile, preventDefault: true },
  );
  useHotkey(
    "Shift+ArrowRight",
    () => layout.setDesktopExpandedPane((expanded) => stepExpandedPane(expanded, "right")),
    { enabled: readerKeys && !layout.isMobile, preventDefault: true },
  );
  useHotkey("Shift+ArrowUp", () => layout.stepChrome("hide"), {
    enabled: readerKeys && !layout.isMobile,
    preventDefault: true,
  });
  useHotkey("Shift+ArrowDown", () => layout.stepChrome("show"), {
    enabled: readerKeys && !layout.isMobile,
    preventDefault: true,
  });
  useHotkey(
    "D",
    () => setReaderPref("pdfPageLayout", pdfPageLayout === "auto" ? "single" : "auto"),
    { enabled: readerKeys },
  );
  useHotkey("Mod+F", () => view.search.openSearch(), { enabled: readerKeys, preventDefault: true });
  useHotkey("Mod+S", () => Effect.runFork(onSyncReadingPosition(sourceId).pipe(Effect.ignore)), {
    enabled: readerKeys,
    preventDefault: true,
  });
  useHotkey("Z", layout.toggleChrome, {
    enabled: !layout.modalOpen,
    preventDefault: true,
    requireReset: true,
  });
  useHotkey("Escape", () => view.search.closeSearch(), {
    enabled: view.search.open && !layout.modalOpen,
    conflictBehavior: "allow",
  });
}
