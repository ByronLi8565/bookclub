import { Schema } from "effect";
import type { Command } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { m } from "foldkit/message";
import { infoCards, type InfoCard } from "../logic/info/infoCards.ts";
import { modalTabsView, modalView, type ModalTab } from "./modal.ts";
import { noteBodyView } from "./noteBody.ts";

const InfoPage = Schema.Literals(["info", "release"]);
type InfoPage = typeof InfoPage.Type;

interface InfoPageTab extends ModalTab<InfoPage> {
  readonly empty: string;
}

/** React's `PAGES`: the tab row, the modal title, and the empty line all come
 *  from the same table, so a page cannot show one page's cards under another's
 *  heading. */
const PAGES: readonly [InfoPageTab, InfoPageTab] = [
  { id: "info", label: "INFO", empty: "no info cards yet" },
  { id: "release", label: "RELEASE LOG", empty: "no release cards yet" },
];

/** Info cards carry no references, and React hands `NoteCardView` an empty map
 *  so a `[[1]]` in a card stays literal text. */
const NO_REFS: ReadonlyMap<number, string> = new Map();

export const InfoModel = Schema.Struct({ page: InfoPage });
export type InfoModel = typeof InfoModel.Type;

export const initialInfoModel = (): InfoModel => ({ page: "info" });

export const SelectedInfoPage = m("SelectedInfoPage", { page: InfoPage });

export const InfoMessage = Schema.Union([SelectedInfoPage]);
export type InfoMessage = typeof InfoMessage.Type;

const matchesInfoMessage = Schema.is(InfoMessage);

export const isInfoMessage = (message: { _tag: string }): message is InfoMessage =>
  matchesInfoMessage(message);

export const updateInfo = (
  model: InfoModel,
  message: InfoMessage,
): readonly [InfoModel, readonly Command.Command<InfoMessage>[]] => {
  switch (message._tag) {
    case "SelectedInfoPage":
      return [{ ...model, page: message.page }, []];
  }
};

export interface InfoViewContext<Message> {
  readonly onClose: Message;
  /** The cards to show. Defaults to the ones bundled from `info_cards/`, which
   *  is where React reads them from; a caller supplying its own is how the
   *  screen is exercised against a card set it chooses. */
  readonly cards?: readonly InfoCard[];
}

/** React's `NoteCardView` as the info screen uses it: no id, no jump button, no
 *  tags, no actions — a sequence number, a title, and the body. */
const infoCardView = <Message>(
  seq: number,
  title: string,
  body: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class("note")],
    [
      h.div(
        [h.Class("note-header")],
        [
          h.div(
            [h.Class("note-head")],
            [
              h.span([h.Class("note-seq")], [String(seq)]),
              h.div([h.Class("quote truncate")], [title]),
            ],
          ),
        ],
      ),
      ...(body === "" ? [] : [noteBodyView(body, { refs: NO_REFS }, h)]),
    ],
  );

export const infoView = <Message>(
  model: InfoModel,
  { onClose, cards: source = infoCards }: InfoViewContext<Message>,
  h: HtmlBuilder<Message | InfoMessage>,
): Html => {
  const activePage = PAGES.find((page) => page.id === model.page) ?? PAGES[0];
  const cards = source.filter((card) => card.page === model.page);

  return modalView({ title: activePage.label, className: "home-info-panel", onClose }, h, [
    h.div(
      [h.Class("modal-body note-panel home-info-cards")],
      cards.length === 0
        ? [h.p([h.Class("home-info-empty")], [activePage.empty])]
        : [
            h.ul(
              [],
              cards.map((card, index) =>
                h.li(
                  [h.Key(card.path), h.Title(card.title)],
                  [infoCardView(index + 1, card.title, card.body, h)],
                ),
              ),
            ),
          ],
    ),
    modalTabsView(PAGES, model.page, (page) => SelectedInfoPage({ page }), h, "settings-tabs"),
  ]);
};
