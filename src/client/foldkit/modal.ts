import { Option } from "effect";
import { Subscription } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

/**
 * React's `Modal` markup, which every overlay in the app is built from:
 * `.modal-backdrop > dialog.modal[open] > .modal-inner`, with a titled head and
 * a close button. `shared.css` styles all of it and nothing else.
 *
 * The dialog needs `open` — the UA stylesheet hides a `<dialog>` without it, so
 * the route renders and the reader sees nothing happen.
 */
export interface ModalChrome<Message> {
  readonly title: string;
  readonly className?: string;
  readonly ariaLabel?: string;
  readonly onClose: Message;
}

const MODAL_TITLE_ID = "modal-title";

export const modalView = <Message>(
  { title, className, ariaLabel, onClose }: ModalChrome<Message>,
  h: HtmlBuilder<Message>,
  children: readonly Html[],
): Html =>
  h.div(
    [h.Class("modal-backdrop"), h.Role("presentation")],
    [
      h.dialog(
        [
          h.Open(true),
          h.Class(className === undefined ? "modal" : `modal ${className}`),
          // React names the dialog by its own heading unless the caller gives
          // it a label of its own, so the head stays the single source of the
          // modal's name.
          ...(ariaLabel === undefined
            ? [h.AriaLabelledBy(MODAL_TITLE_ID)]
            : [h.AriaLabel(ariaLabel)]),
        ],
        [
          h.div(
            [h.Class("modal-inner"), h.Role("presentation")],
            [
              h.div(
                [h.Class("modal-head")],
                [
                  h.strong([h.Id(MODAL_TITLE_ID)], [title]),
                  h.button(
                    [h.Type("button"), h.AriaLabel("close"), h.Title("Close"), h.OnClick(onClose)],
                    ["✕"],
                  ),
                ],
              ),
              ...children,
            ],
          ),
        ],
      ),
    ],
  );

export interface ModalTab<Id extends string> {
  readonly id: Id;
  readonly label: string;
  readonly title?: string;
}

/** React's `ModalPagerTabs`: the row of pages along the bottom of a modal. */
export const modalTabsView = <Id extends string, Message>(
  tabs: readonly ModalTab<Id>[],
  active: Id,
  onChange: (id: Id) => Message,
  h: HtmlBuilder<Message>,
  className?: string,
): Html =>
  h.div(
    [h.Class(className === undefined ? "pager-tabs" : `pager-tabs ${className}`)],
    tabs.map((tab) =>
      h.button(
        [
          h.Key(tab.id),
          h.Type("button"),
          h.AriaPressed(String(tab.id === active)),
          ...(tab.title === undefined ? [] : [h.Title(tab.title)]),
          h.OnClick(onChange(tab.id)),
        ],
        [tab.label],
      ),
    ),
  );

/**
 * React stops the press inside `.modal-inner` from reaching the backdrop, which
 * Foldkit's handlers cannot do — snabbdom attaches real listeners and the event
 * bubbles. The same rule works as a document-level press, the way the reader
 * already lets a selection go, and it is the caller's job to gate the stream on
 * a modal actually being open.
 */
export const pressOutsideModalStream = <Message>(message: Message) =>
  Subscription.fromEventFilterMap<PointerEvent, Message>({
    target: globalThis.document,
    type: "pointerdown",
    toMessage: (event) =>
      event.target instanceof Element && event.target.closest(".modal-inner") !== null
        ? Option.none()
        : Option.some(message),
  });

/** Escape closes the topmost modal, the way React's `useHotkey` does. */
export const escapeKeyStream = <Message>(message: Message) =>
  Subscription.fromEventFilterMap<KeyboardEvent, Message>({
    target: globalThis.document,
    type: "keydown",
    toMessage: (event) => (event.key === "Escape" ? Option.some(message) : Option.none()),
  });
