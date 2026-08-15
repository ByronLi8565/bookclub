// @vitest-environment jsdom

import { Runtime } from "foldkit";
import { afterEach, describe, expect, it } from "vitest";
import {
  InfoModel,
  SelectedInfoPage,
  infoView,
  initialInfoModel,
  isInfoMessage,
  updateInfo,
  type InfoMessage,
} from "../../client/foldkit/info.ts";
import { infoCards, type InfoCard } from "../../client/logic/info/infoCards.ts";

/** The cards are whatever `info_cards/*.md` happens to hold, so every assertion
 *  about them is derived from the same source the view reads. */
const cardsOn = (page: "info" | "release") => infoCards.filter((card) => card.page === page);

/**
 * `Runtime.embed` replaces the container element rather than filling it, so the
 * rendered tree lands in `document.body` and `dispose` tears it back down; the
 * DOM is captured before disposing. The card set is a parameter so the empty
 * state can be rendered without depending on what `info_cards/` holds.
 */
const render = async (
  model: InfoModel,
  cards: readonly InfoCard[] = infoCards,
): Promise<HTMLElement> => {
  const container = document.createElement("div");
  // The runtime mounts by container id; an id-less container is never replaced.
  container.id = "info-view-test";
  document.body.appendChild(container);
  const handle = Runtime.embed(
    Runtime.makeElement<InfoModel, InfoMessage>({
      Model: InfoModel,
      container,
      init: () => [model, []],
      update: (current, message) => updateInfo(current, message),
      view: (current, h) =>
        infoView(current, { onClose: SelectedInfoPage({ page: "info" }), cards }, h),
      devTools: false,
      slow: false,
    }),
  );
  await new Promise((resolve) => {
    setTimeout(resolve, 200);
  });
  const html = document.body.innerHTML;
  handle.dispose();
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return holder;
};

describe("the Foldkit info screen", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("starts on the info page", () => {
    expect(initialInfoModel()).toEqual({ page: "info" });
  });

  it("draws the modal chrome the stylesheet expects", async () => {
    const tree = await render(initialInfoModel());

    expect(
      tree.querySelector(".modal-backdrop > dialog.modal.home-info-panel[open]"),
    ).not.toBeNull();
    expect(tree.querySelector(".modal-inner > .modal-head > strong")?.textContent).toBe("INFO");
    expect(
      tree.querySelector("dialog.modal .modal-body.note-panel.home-info-cards"),
    ).not.toBeNull();
  });

  it("renders one card per info card, as a note card", async () => {
    const tree = await render(initialInfoModel());
    const items = tree.querySelectorAll(".home-info-cards > ul > li");

    expect(items).toHaveLength(cardsOn("info").length);
    const first = items[0];
    expect(first?.getAttribute("title")).toBe(cardsOn("info")[0]?.title);
    expect(first?.querySelector(".note > .note-header > .note-head > .note-seq")?.textContent).toBe(
      "1",
    );
    expect(first?.querySelector(".note-head > .quote.truncate")?.textContent).toBe(
      cardsOn("info")[0]?.title,
    );
    expect(first?.querySelector(".note > .note-body")).not.toBeNull();
  });

  it("numbers the cards from one, in order", async () => {
    const tree = await render(initialInfoModel());
    const seqs = [...tree.querySelectorAll(".home-info-cards .note-seq")].map(
      (node) => node.textContent,
    );

    expect(seqs).toEqual(cardsOn("info").map((_card, index) => String(index + 1)));
  });

  it("offers both pages as tabs and presses the active one", async () => {
    const tree = await render({ page: "release" });
    const tabs = [...tree.querySelectorAll(".pager-tabs.settings-tabs > button")];

    expect(tabs.map((tab) => tab.textContent)).toEqual(["INFO", "RELEASE LOG"]);
    expect(tabs.map((tab) => tab.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    expect(tree.querySelector(".modal-head > strong")?.textContent).toBe("RELEASE LOG");
  });

  it("shows the release page's own cards", async () => {
    const tree = await render({ page: "release" });

    expect(tree.querySelectorAll(".home-info-cards > ul > li")).toHaveLength(
      cardsOn("release").length,
    );
  });

  it("switches page on the tab message", () => {
    const [model, commands] = updateInfo(initialInfoModel(), SelectedInfoPage({ page: "release" }));

    expect(model.page).toBe("release");
    expect(commands).toEqual([]);
  });

  it("claims only its own messages", () => {
    expect(isInfoMessage(SelectedInfoPage({ page: "release" }))).toBe(true);
    expect(isInfoMessage({ _tag: "ClosedInfoScreen" })).toBe(false);
  });

  it("renders the empty line for a page with no cards", async () => {
    const tree = await render({ page: "release" }, []);

    expect(tree.querySelector(".home-info-cards > .home-info-empty")?.textContent).toBe(
      "no release cards yet",
    );
    expect(tree.querySelector(".home-info-cards ul")).toBeNull();
  });
});
