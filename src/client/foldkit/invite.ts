import { Effect, Schema } from "effect";
import { Command } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { m } from "foldkit/message";
import { groupUrlName, type GroupUrlParts } from "../../shared/groupUrls.ts";
import { bookclubClient } from "../logic/net/bookclubClient.ts";
import { modalView } from "./modal.ts";

const COPIED_LABEL_MILLIS = 1500;

export const InviteModel = Schema.Struct({
  link: Schema.NullOr(Schema.String),
  linkLoading: Schema.Boolean,
  email: Schema.String,
  busy: Schema.Boolean,
  copied: Schema.Boolean,
});
export type InviteModel = typeof InviteModel.Type;

export const initialInviteModel = (): InviteModel => ({
  link: null,
  linkLoading: true,
  email: "",
  busy: false,
  copied: false,
});

/** Opening the modal, or switching clubs under it, starts the link over. */
export const OpenedInvite = m("OpenedInvite", { groupRef: Schema.String });
export const LoadedInviteLink = m("LoadedInviteLink", { link: Schema.NullOr(Schema.String) });
export const ChangedInviteEmail = m("ChangedInviteEmail", { email: Schema.String });
export const SubmittedInvite = m("SubmittedInvite", { groupRef: Schema.String });
export const SentInvite = m("SentInvite", { email: Schema.String });
export const FailedInvite = m("FailedInvite");
export const CopiedInviteLink = m("CopiedInviteLink");
export const MarkedInviteLinkCopied = m("MarkedInviteLinkCopied");
export const ClearedInviteLinkCopied = m("ClearedInviteLinkCopied");
export const RotatedInviteLink = m("RotatedInviteLink", { groupRef: Schema.String });
export const FailedInviteLinkRotation = m("FailedInviteLinkRotation");

export const InviteMessage = Schema.Union([
  OpenedInvite,
  LoadedInviteLink,
  ChangedInviteEmail,
  SubmittedInvite,
  SentInvite,
  FailedInvite,
  CopiedInviteLink,
  MarkedInviteLinkCopied,
  ClearedInviteLinkCopied,
  RotatedInviteLink,
  FailedInviteLinkRotation,
]);
export type InviteMessage = typeof InviteMessage.Type;

const inviteMessageTags: ReadonlySet<string> = new Set([
  "OpenedInvite",
  "LoadedInviteLink",
  "ChangedInviteEmail",
  "SubmittedInvite",
  "SentInvite",
  "FailedInvite",
  "CopiedInviteLink",
  "MarkedInviteLinkCopied",
  "ClearedInviteLinkCopied",
  "RotatedInviteLink",
  "FailedInviteLinkRotation",
]);

export const isInviteMessage = (message: { _tag: string }): message is InviteMessage =>
  inviteMessageTags.has(message._tag);

/**
 * The link endpoint mints one on first ask and replaces it when rotating, which
 * is why both are the same POST. A first load that fails leaves the club without
 * a link to show; a rotation that fails leaves the one already on screen alone.
 */
export const LoadInviteLink = Command.define("LoadInviteLink", {
  args: { groupRef: Schema.String, rotate: Schema.Boolean },
  messages: [LoadedInviteLink, FailedInviteLinkRotation],
  execute: ({ groupRef, rotate }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) =>
        client.groups.inviteLink({ params: { groupRef }, query: rotate ? { rotate: "1" } : {} }),
      ),
      Effect.map(({ link }) => LoadedInviteLink({ link })),
      Effect.catch(() =>
        Effect.succeed(rotate ? FailedInviteLinkRotation() : LoadedInviteLink({ link: null })),
      ),
    ),
});

export const SendInvite = Command.define("SendInvite", {
  args: { groupRef: Schema.String, email: Schema.String },
  messages: [SentInvite, FailedInvite],
  execute: ({ groupRef, email }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) =>
        client.groups.invite({ params: { groupRef }, payload: { email } }),
      ),
      Effect.as(SentInvite({ email })),
      Effect.catch(() => Effect.succeed(FailedInvite())),
    ),
});

export const CopyInviteLink = Command.define("CopyInviteLink", {
  args: { link: Schema.String },
  messages: [MarkedInviteLinkCopied],
  execute: ({ link }) =>
    Effect.promise(async () => {
      await navigator.clipboard.writeText(link).catch(() => {});
      return MarkedInviteLinkCopied();
    }),
});

/** The button says "Copied" for a beat and then goes back to saying what it does. */
export const ForgetInviteLinkCopied = Command.define("ForgetInviteLinkCopied", {
  messages: [ClearedInviteLinkCopied],
  execute: Effect.sleep(`${COPIED_LABEL_MILLIS} millis`).pipe(Effect.as(ClearedInviteLinkCopied())),
});

export type InviteCommand =
  | ReturnType<typeof LoadInviteLink>
  | ReturnType<typeof SendInvite>
  | ReturnType<typeof CopyInviteLink>
  | ReturnType<typeof ForgetInviteLinkCopied>;

export const updateInvite = (
  model: InviteModel,
  message: InviteMessage,
): readonly [InviteModel, readonly InviteCommand[]] => {
  switch (message._tag) {
    case "OpenedInvite":
      return [
        initialInviteModel(),
        [LoadInviteLink({ groupRef: message.groupRef, rotate: false })],
      ];
    case "LoadedInviteLink":
      return [{ ...model, link: message.link, linkLoading: false, busy: false }, []];
    case "ChangedInviteEmail":
      return [{ ...model, email: message.email }, []];
    case "SubmittedInvite":
      return model.busy || model.email === ""
        ? [model, []]
        : [
            { ...model, busy: true },
            [SendInvite({ groupRef: message.groupRef, email: model.email })],
          ];
    case "SentInvite":
      return [{ ...model, email: "", busy: false }, []];
    case "FailedInvite":
    case "FailedInviteLinkRotation":
      return [{ ...model, busy: false }, []];
    case "CopiedInviteLink":
      return model.link === null ? [model, []] : [model, [CopyInviteLink({ link: model.link })]];
    case "MarkedInviteLinkCopied":
      return [{ ...model, copied: true }, [ForgetInviteLinkCopied()]];
    case "ClearedInviteLinkCopied":
      return [{ ...model, copied: false }, []];
    case "RotatedInviteLink":
      return [
        { ...model, busy: true },
        [LoadInviteLink({ groupRef: message.groupRef, rotate: true })],
      ];
  }
};

/** React's `Loading`, which `shared.css` styles by class name and nothing else. */
const loadingView = <Message>(className: string, h: HtmlBuilder<Message>): Html =>
  h.output(
    [h.Class(`loading ${className}`), h.AriaLive("polite"), h.AriaLabel("Loading")],
    [
      h.span(
        [h.Class("loading-text")],
        [
          "LOADING",
          h.span(
            [h.Class("loading-dots"), h.AriaHidden(true)],
            [h.span([], ["."]), h.span([], ["."]), h.span([], ["."])],
          ),
        ],
      ),
    ],
  );

const ICON_ATTRIBUTES = <Message>(h: HtmlBuilder<Message>) => [
  h.Width("16"),
  h.Height("16"),
  h.ViewBox("0 0 24 24"),
  h.Fill("none"),
  h.Stroke("currentColor"),
  h.StrokeWidth("2"),
  h.StrokeLinecap("round"),
  h.StrokeLinejoin("round"),
  h.AriaHidden(true),
];

const copyIcon = <Message>(h: HtmlBuilder<Message>): Html =>
  h.svg(ICON_ATTRIBUTES(h), [
    h.rect([h.X("9"), h.Y("9"), h.Width("11"), h.Height("11"), h.Rx("1")], []),
    h.path([h.D("M5 15V5a1 1 0 0 1 1-1h10")], []),
  ]);

const rotateIcon = <Message>(h: HtmlBuilder<Message>): Html =>
  h.svg(ICON_ATTRIBUTES(h), [
    h.path([h.D("M21 12a9 9 0 1 1-3-6.7")], []),
    h.path([h.D("M21 3v5h-5")], []),
  ]);

const checkIcon = <Message>(h: HtmlBuilder<Message>): Html =>
  h.svg(ICON_ATTRIBUTES(h), [h.path([h.D("M20 6 9 17l-5-5")], [])]);

export interface InviteViewContext<Message> {
  /** The club itself rather than a reference to it: the server resolves a club
   *  by the segment after the last `-`, so the reference is built here. */
  readonly group: GroupUrlParts & { readonly displayName: string };
  readonly onClose: Message;
  /** React's `InviteControls` takes children between the email form and the
   *  share row; the club's settings page puts its roster there. */
  readonly children?: readonly Html[];
}

export const inviteControlsView = <Message>(
  model: InviteModel,
  { group, children = [] }: Omit<InviteViewContext<Message>, "onClose">,
  h: HtmlBuilder<Message | InviteMessage>,
): readonly Html[] => {
  const groupRef = groupUrlName(group);
  const shownLink = model.link === null ? "" : model.link.replace(/^https?:\/\//u, "");

  return [
    h.form(
      [h.OnSubmit(SubmittedInvite({ groupRef }))],
      [
        h.input([
          h.Type("email"),
          h.AriaLabel("Invitee email"),
          h.Placeholder("invite by email"),
          h.Value(model.email),
          h.OnInput((email) => ChangedInviteEmail({ email })),
        ]),
        h.button(
          [
            h.Type("submit"),
            h.Class("primary"),
            h.Disabled(model.busy || model.email === ""),
            h.Title("Send invite"),
          ],
          ["send invite"],
        ),
      ],
    ),
    ...children,
    h.div(
      [h.Class("invite-share")],
      [
        h.p([h.Class("modal-note")], ["Invite with link:"]),
        model.linkLoading
          ? loadingView("loading--invite-link", h)
          : h.div(
              [h.Class("invite-link")],
              [
                h.input([
                  h.Type("text"),
                  h.Readonly(true),
                  h.Value(shownLink),
                  h.AriaLabel("invite link"),
                ]),
                h.button(
                  [
                    h.Type("button"),
                    h.Class("invite-icon icon-button"),
                    h.OnClick(CopiedInviteLink()),
                    h.Disabled(model.link === null),
                    h.AriaLabel("copy link"),
                    h.Title(model.copied ? "Copied" : "Copy link"),
                  ],
                  [model.copied ? checkIcon(h) : copyIcon(h)],
                ),
                h.button(
                  [
                    h.Type("button"),
                    h.Class("invite-icon icon-button"),
                    h.OnClick(RotatedInviteLink({ groupRef })),
                    h.Disabled(model.busy),
                    h.AriaLabel("regenerate link"),
                    h.Title("Regenerate link"),
                  ],
                  [rotateIcon(h)],
                ),
              ],
            ),
      ],
    ),
  ];
};

export const inviteView = <Message>(
  model: InviteModel,
  context: InviteViewContext<Message>,
  h: HtmlBuilder<Message | InviteMessage>,
): Html =>
  modalView<Message | InviteMessage>(
    {
      title: `invite to ${context.group.displayName}`,
      className: "modal--invite",
      onClose: context.onClose,
    },
    h,
    [h.div([h.Class("modal-body")], inviteControlsView(model, context, h))],
  );
