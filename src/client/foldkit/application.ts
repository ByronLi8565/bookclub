import { Effect, Option, Schema } from "effect";
import { Command, Runtime, Subscription } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { m } from "foldkit/message";
import { r } from "foldkit/route";
import { ts } from "foldkit/schema";
import {
  GroupRoleSchema,
  GroupSummary,
  Membership,
  RosterEntry,
} from "../../shared/types/groups.ts";
import { PasskeyInfo } from "../../shared/types/passkeys.ts";
import {
  currentSessionMode,
  makeNoteAgentResources,
  makeNoteAgentSubscriptions,
  type NoteAgentRequirements,
  type NoteAgentService,
} from "./resources/noteAgent.ts";
import { registerPasskey } from "../logic/auth/authClient.ts";
import { bookclubClient } from "../logic/net/bookclubClient.ts";
import {
  AttachedNoteHighlight,
  FocusedNoteHighlight,
  NotesModel,
  SubmittedNoteOperation,
  highlightNoteOp,
  initialNotesModel,
  isNotesMessage,
  notesHighlights,
  notesView,
  selectionHighlight,
  updateNotes,
  type NotesMessage,
} from "./notes.ts";
import {
  CommittedReaderSelection,
  IdentifiedReaderSession,
  JumpedToHighlight,
  ReaderRoute,
  ReaderWorkspace,
  ShowedReaderHighlights,
  SwitchedReaderPane,
  browserReaderEnvironment,
  isReaderMessage,
  makeReaderSlice,
  makeReaderSubscriptions,
  openReader,
  type ReaderMessage,
  type ReaderSelection,
} from "./reader.ts";

// One slice per application: the Mounts inside it own the live book handles.
const reader = makeReaderSlice(browserReaderEnvironment);
const { update: updateReader, view: readerView } = reader;

export const FOLDKIT_RUNTIME_ID = "bookclub-foldkit";

export const Home = r("Home");
export const Login = r("Login");
export const AccountSettings = r("AccountSettings");
export const Group = r("Group", { groupRef: Schema.String });
export const Reader = ReaderRoute;
export const Route = Schema.Union([Home, Login, AccountSettings, Group, Reader]);
export type Route = typeof Route.Type;

const SessionUser = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  avatarImageId: Schema.optionalKey(Schema.String),
});
export type SessionUser = typeof SessionUser.Type;

export const LoadingSession = ts("LoadingSession");
export const AnonymousSession = ts("AnonymousSession");
export const AuthenticatedSession = ts("AuthenticatedSession", { user: SessionUser });
export const Session = Schema.Union([LoadingSession, AnonymousSession, AuthenticatedSession]);
export type Session = typeof Session.Type;

export const UnavailableAccount = ts("UnavailableAccount");
export const ReadyAccount = ts("ReadyAccount", { user: SessionUser });
export const Account = Schema.Union([UnavailableAccount, ReadyAccount]);
export type Account = typeof Account.Type;

/** Which workspace layout the viewport asks for. The reader and notes sit side
 *  by side on a wide screen and page past each other on a phone. */
export const Viewport = Schema.Literals(["wide", "narrow"]);
export type Viewport = typeof Viewport.Type;

export const MOBILE_VIEWPORT_QUERY = "(max-width: 720px)";

export const currentViewport = (): Viewport =>
  globalThis.matchMedia?.(MOBILE_VIEWPORT_QUERY).matches ? "narrow" : "wide";

export const ErrorToast = Schema.Struct({ message: Schema.String });
export type ErrorToast = typeof ErrorToast.Type;

export const Model = Schema.Struct({
  route: Route,
  session: Session,
  account: Account,
  loginEmail: Schema.String,
  loginPassword: Schema.String,
  groups: Schema.Array(GroupSummary),
  newGroupName: Schema.String,
  currentGroup: Schema.NullOr(GroupSummary),
  membership: Schema.NullOr(Membership),
  members: Schema.Array(RosterEntry),
  inviteToken: Schema.String,
  accountPasskeys: Schema.Array(PasskeyInfo),
  hasPassword: Schema.Boolean,
  reader: Schema.NullOr(ReaderWorkspace),
  viewport: Viewport,
  notes: NotesModel,
  errorToast: Schema.NullOr(ErrorToast),
});
export type Model = typeof Model.Type;

export const LoadedSession = m("LoadedSession", { user: SessionUser });
export const FailedSession = m("FailedSession", { message: Schema.String });
export const DismissedErrorToast = m("DismissedErrorToast");
export const ResizedViewport = m("ResizedViewport", { viewport: Viewport });
export const Navigated = m("Navigated", { route: Route });
export const ChangedLogin = m("ChangedLogin", { email: Schema.String, password: Schema.String });
export const SubmittedPasswordLogin = m("SubmittedPasswordLogin");
export const LoadedGroups = m("LoadedGroups", { groups: Schema.Array(GroupSummary) });
export const ChangedNewGroupName = m("ChangedNewGroupName", { name: Schema.String });
export const SubmittedNewGroup = m("SubmittedNewGroup");
export const CreatedGroup = m("CreatedGroup", { group: GroupSummary });
export const LoadedGroup = m("LoadedGroup", {
  group: GroupSummary,
  membership: Membership,
  members: Schema.Array(RosterEntry),
});
export const LoadedAccountSecurity = m("LoadedAccountSecurity", {
  passkeys: Schema.Array(PasskeyInfo),
  hasPassword: Schema.Boolean,
});
export const LoadedInvite = m("LoadedInvite", { token: Schema.String });
export const ChangedInviteToken = m("ChangedInviteToken", { token: Schema.String });
export const CompletedAccountAction = m("CompletedAccountAction");
export const SignedOut = m("SignedOut");
export const DeletedGroup = m("DeletedGroup", { groupId: Schema.String });
export const RequestedSignOut = m("RequestedSignOut");
export const RequestedSetPassword = m("RequestedSetPassword", {
  password: Schema.String,
  currentPassword: Schema.optionalKey(Schema.String),
});
export const RequestedRemovePassword = m("RequestedRemovePassword", {
  currentPassword: Schema.String,
});
export const RequestedRemovePasskey = m("RequestedRemovePasskey", { id: Schema.String });
export const RequestedInvite = m("RequestedInvite", { groupRef: Schema.String });
export const RequestedJoin = m("RequestedJoin", { groupRef: Schema.String, token: Schema.String });
export const RequestedRenameGroup = m("RequestedRenameGroup", {
  groupRef: Schema.String,
  title: Schema.String,
});
export const RequestedMemberRole = m("RequestedMemberRole", {
  groupRef: Schema.String,
  memberId: Schema.String,
  role: GroupRoleSchema,
});
export const RequestedDeleteGroup = m("RequestedDeleteGroup", {
  groupRef: Schema.String,
  groupId: Schema.String,
});
export const FailedClientCommand = m("FailedClientCommand", { message: Schema.String });
export const CompletedPasskeyRegistration = m("CompletedPasskeyRegistration", {
  error: Schema.NullOr(Schema.String),
});
export const RequestedPasskeyRegistration = m("RequestedPasskeyRegistration", {
  label: Schema.String,
});
export type Message =
  | typeof LoadedSession.Type
  | typeof FailedSession.Type
  | typeof DismissedErrorToast.Type
  | typeof ResizedViewport.Type
  | typeof Navigated.Type
  | typeof ChangedLogin.Type
  | typeof SubmittedPasswordLogin.Type
  | typeof LoadedGroups.Type
  | typeof ChangedNewGroupName.Type
  | typeof SubmittedNewGroup.Type
  | typeof CreatedGroup.Type
  | typeof LoadedGroup.Type
  | typeof LoadedAccountSecurity.Type
  | typeof LoadedInvite.Type
  | typeof ChangedInviteToken.Type
  | typeof CompletedAccountAction.Type
  | typeof SignedOut.Type
  | typeof DeletedGroup.Type
  | typeof RequestedSignOut.Type
  | typeof RequestedSetPassword.Type
  | typeof RequestedRemovePassword.Type
  | typeof RequestedRemovePasskey.Type
  | typeof RequestedInvite.Type
  | typeof RequestedJoin.Type
  | typeof RequestedRenameGroup.Type
  | typeof RequestedMemberRole.Type
  | typeof RequestedDeleteGroup.Type
  | typeof FailedClientCommand.Type
  | typeof RequestedPasskeyRegistration.Type
  | typeof CompletedPasskeyRegistration.Type
  | ReaderMessage
  | NotesMessage;

export const LoadGroups = Command.define("LoadGroups", {
  messages: [LoadedGroups, FailedClientCommand],
  execute: bookclubClient.pipe(
    Effect.flatMap((client) => client.groups.list({})),
    Effect.map(({ groups }) => LoadedGroups({ groups })),
    Effect.catch((error) => Effect.succeed(FailedClientCommand({ message: String(error) }))),
  ),
});

export const PasswordLogin = Command.define("PasswordLogin", {
  args: { email: Schema.String, password: Schema.String },
  messages: [LoadedSession, FailedClientCommand],
  execute: ({ email, password }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) => client.auth.passwordLogin({ payload: { email, password } })),
      Effect.map(({ body }) => LoadedSession({ user: body.user })),
      Effect.catch((error) => Effect.succeed(FailedClientCommand({ message: String(error) }))),
    ),
});

export const CreateGroup = Command.define("CreateGroup", {
  args: { displayName: Schema.String },
  messages: [CreatedGroup, FailedClientCommand],
  execute: ({ displayName }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) => client.groups.create({ payload: { displayName } })),
      Effect.map(({ group }) => CreatedGroup({ group })),
      Effect.catch((error) => Effect.succeed(FailedClientCommand({ message: String(error) }))),
    ),
});

export const LoadGroup = Command.define("LoadGroup", {
  args: { groupRef: Schema.String },
  messages: [LoadedGroup, FailedClientCommand],
  execute: ({ groupRef }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) => client.groups.get({ params: { groupRef } })),
      Effect.map(({ group, membership, members }) => LoadedGroup({ group, membership, members })),
      Effect.catch((error) => Effect.succeed(FailedClientCommand({ message: String(error) }))),
    ),
});

export const LoadAccountSecurity = Command.define("LoadAccountSecurity", {
  messages: [LoadedAccountSecurity, FailedClientCommand],
  execute: bookclubClient.pipe(
    Effect.flatMap((client) => client.auth.passkeys({})),
    Effect.map(({ passkeys, hasPassword }) => LoadedAccountSecurity({ passkeys, hasPassword })),
    Effect.catch((error) => Effect.succeed(FailedClientCommand({ message: String(error) }))),
  ),
});

export const SetAccountPassword = Command.define("SetAccountPassword", {
  args: { password: Schema.String, currentPassword: Schema.optionalKey(Schema.String) },
  messages: [CompletedAccountAction, FailedClientCommand],
  execute: ({ password, currentPassword }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) =>
        client.auth.setPassword({
          payload: currentPassword === undefined ? { password } : { password, currentPassword },
        }),
      ),
      Effect.as(CompletedAccountAction()),
      Effect.catch((error) => Effect.succeed(FailedClientCommand({ message: String(error) }))),
    ),
});

export const RemoveAccountPassword = Command.define("RemoveAccountPassword", {
  args: { currentPassword: Schema.String },
  messages: [CompletedAccountAction, FailedClientCommand],
  execute: ({ currentPassword }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) => client.auth.removePassword({ payload: { currentPassword } })),
      Effect.as(CompletedAccountAction()),
      Effect.catch((error) => Effect.succeed(FailedClientCommand({ message: String(error) }))),
    ),
});

export const RemoveAccountPasskey = Command.define("RemoveAccountPasskey", {
  args: { id: Schema.String },
  messages: [CompletedAccountAction, FailedClientCommand],
  execute: ({ id }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) => client.auth.removePasskey({ params: { id } })),
      Effect.as(CompletedAccountAction()),
      Effect.catch((error) => Effect.succeed(FailedClientCommand({ message: String(error) }))),
    ),
});

export const SignOut = Command.define("SignOut", {
  messages: [SignedOut, FailedClientCommand],
  execute: bookclubClient.pipe(
    Effect.flatMap((client) => client.auth.signout({})),
    Effect.as(SignedOut()),
    Effect.catch((error) => Effect.succeed(FailedClientCommand({ message: String(error) }))),
  ),
});

export const RenameGroup = Command.define("RenameGroup", {
  args: { groupRef: Schema.String, title: Schema.String },
  messages: [CreatedGroup, FailedClientCommand],
  execute: ({ groupRef, title }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) =>
        client.groups.rename({ params: { groupRef }, payload: { title } }),
      ),
      Effect.map(({ group }) => CreatedGroup({ group })),
      Effect.catch((error) => Effect.succeed(FailedClientCommand({ message: String(error) }))),
    ),
});

export const LoadInvite = Command.define("LoadInvite", {
  args: { groupRef: Schema.String },
  messages: [LoadedInvite, FailedClientCommand],
  execute: ({ groupRef }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) => client.groups.inviteLink({ params: { groupRef }, query: {} })),
      Effect.map(({ token }) => LoadedInvite({ token })),
      Effect.catch((error) => Effect.succeed(FailedClientCommand({ message: String(error) }))),
    ),
});

export const JoinGroup = Command.define("JoinGroup", {
  args: { groupRef: Schema.String, token: Schema.String },
  messages: [CreatedGroup, FailedClientCommand],
  execute: ({ groupRef, token }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) => client.groups.join({ params: { groupRef }, payload: { token } })),
      Effect.map(({ group }) => CreatedGroup({ group })),
      Effect.catch((error) => Effect.succeed(FailedClientCommand({ message: String(error) }))),
    ),
});

export const SetMemberRole = Command.define("SetMemberRole", {
  args: { groupRef: Schema.String, memberId: Schema.String, role: GroupRoleSchema },
  messages: [CompletedAccountAction, FailedClientCommand],
  execute: ({ groupRef, memberId, role }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) =>
        client.groups.setMemberRole({ params: { groupRef, memberId }, payload: { role } }),
      ),
      Effect.as(CompletedAccountAction()),
      Effect.catch((error) => Effect.succeed(FailedClientCommand({ message: String(error) }))),
    ),
});

export const DeleteGroup = Command.define("DeleteGroup", {
  args: { groupRef: Schema.String, groupId: Schema.String },
  messages: [DeletedGroup, FailedClientCommand],
  execute: ({ groupRef, groupId }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) => client.groups.delete({ params: { groupRef } })),
      Effect.as(DeletedGroup({ groupId })),
      Effect.catch((error) => Effect.succeed(FailedClientCommand({ message: String(error) }))),
    ),
});

export const RegisterPasskey = Command.define("RegisterPasskey", {
  args: { label: Schema.String },
  messages: [CompletedPasskeyRegistration],
  execute: ({ label }) =>
    Effect.promise(() => registerPasskey(label)).pipe(
      Effect.map((result) =>
        CompletedPasskeyRegistration({ error: result.ok ? null : result.error }),
      ),
    ),
});

export const init = (): readonly [Model, []] => [
  {
    route: Home(),
    session: LoadingSession(),
    account: UnavailableAccount(),
    loginEmail: "",
    loginPassword: "",
    groups: [],
    newGroupName: "",
    currentGroup: null,
    membership: null,
    members: [],
    inviteToken: "",
    accountPasskeys: [],
    hasPassword: false,
    reader: null,
    notes: initialNotesModel(),
    viewport: currentViewport(),
    errorToast: null,
  },
  [],
];

type Update = readonly [Model, readonly Command.Command<Message, never, NoteAgentService>[]];

const sameHighlights = (a: readonly { id: string }[], b: readonly { id: string }[]): boolean =>
  a.length === b.length && a.every((left, index) => left.id === b[index]?.id);

/**
 * Notes own the highlights; the reader paints them. Feeding the reader slice
 * the desired set as a Message keeps the painting Command on the reader's side
 * of the seam instead of teaching the notes slice about the renderer.
 */
const updateNotesSlice = (model: Model, message: NotesMessage): Update => {
  const [notes, commands] = updateNotes(model.notes, message);
  const withNotes = { ...model, notes };
  if (withNotes.reader === null) return [withNotes, commands];
  const highlights = notesHighlights(notes, withNotes.reader.sourceId);
  if (sameHighlights(withNotes.reader.highlights, highlights)) return [withNotes, commands];
  const painted = updateReader(withNotes.reader, ShowedReaderHighlights({ highlights }));
  return painted === null
    ? [withNotes, commands]
    : [{ ...withNotes, reader: painted[0] }, [...commands, ...painted[1]]];
};

/** A committed selection is a reader fact that becomes a note: a highlight is
 *  posted on the spot, while a note carries the passage into the composer. */
const commitSelection = (
  model: Model,
  selection: ReaderSelection,
  sourceId: string,
  intent: "note" | "highlight",
): Update => {
  const highlight = selectionHighlight(sourceId, selection);
  return updateNotesSlice(
    model,
    intent === "highlight"
      ? SubmittedNoteOperation({ op: highlightNoteOp(sourceId, highlight) })
      : AttachedNoteHighlight({ highlight }),
  );
};

const updateReaderSlice = (model: Model, message: ReaderMessage): Update => {
  if (message._tag === "SelectedReaderSource") {
    const { groupRef, sourceId, kind } = message;
    const [reader, commands] = updateReader(openReader(message), message) ?? [
      openReader(message),
      [],
    ];
    return [{ ...model, route: Reader({ groupRef, sourceId, kind }), reader }, commands];
  }
  if (model.reader === null) return [model, []];
  const selection = model.reader.selection;
  const sourceId = model.reader.sourceId;
  const next = updateReader(model.reader, message);
  if (next === null) return [model, []];
  const withReader: Model = { ...model, reader: next[0] };
  // A click on a painted highlight is the reader pointing at a note.
  if (message._tag === "ClickedEpubHighlight") {
    const [focused, focusCommands] = updateNotesSlice(
      withReader,
      FocusedNoteHighlight({ highlightId: message.highlightId }),
    );
    return [focused, [...next[1], ...focusCommands]];
  }
  if (message._tag !== "CommittedReaderSelection" || selection === null) {
    return [withReader, next[1]];
  }
  const [committed, noteCommands] = commitSelection(
    withReader,
    selection,
    sourceId,
    message.intent,
  );
  return [committed, [...next[1], ...noteCommands]];
};

/**
 * The reader keeps a reading place only for a signed-in member of a loaded
 * club, and both facts can land after the book is already open. Reconciling
 * after every Message is what lets the reader stay a slice that is told who is
 * reading rather than one that reaches into the session.
 */
const reconcileReaderIdentity = ([model, commands]: Update): Update => {
  const { reader, currentGroup, session } = model;
  if (reader === null || currentGroup === null || session._tag !== "AuthenticatedSession") {
    return [model, commands];
  }
  if (reader.userId === session.user.id && reader.groupId === currentGroup.groupId) {
    return [model, commands];
  }
  const identified = updateReader(
    reader,
    IdentifiedReaderSession({ userId: session.user.id, groupId: currentGroup.groupId }),
  );
  return identified === null
    ? [model, commands]
    : [{ ...model, reader: identified[0] }, [...commands, ...identified[1]]];
};

export const update = (model: Model, message: Message): Update =>
  reconcileReaderIdentity(updateSlices(model, message));

const updateSlices = (model: Model, message: Message): Update => {
  if (isReaderMessage(message)) return updateReaderSlice(model, message);
  if (isNotesMessage(message)) return updateNotesSlice(model, message);
  switch (message._tag) {
    case "LoadedSession":
      return [
        {
          ...model,
          session: AuthenticatedSession({ user: message.user }),
          account: ReadyAccount({ user: message.user }),
        },
        [LoadGroups()],
      ];
    case "FailedSession":
      return [
        {
          ...model,
          session: AnonymousSession(),
          account: UnavailableAccount(),
          errorToast: { message: message.message },
        },
        [],
      ];
    case "DismissedErrorToast":
      return [{ ...model, errorToast: null }, []];
    case "ResizedViewport":
      return [{ ...model, viewport: message.viewport }, []];
    case "Navigated":
      return [
        { ...model, route: message.route },
        message.route._tag === "Group"
          ? [LoadGroup({ groupRef: message.route.groupRef })]
          : message.route._tag === "AccountSettings"
            ? [LoadAccountSecurity()]
            : [],
      ];
    case "ChangedLogin":
      return [{ ...model, loginEmail: message.email, loginPassword: message.password }, []];
    case "SubmittedPasswordLogin":
      return [model, [PasswordLogin({ email: model.loginEmail, password: model.loginPassword })]];
    case "LoadedGroups":
      return [{ ...model, groups: message.groups }, []];
    case "ChangedNewGroupName":
      return [{ ...model, newGroupName: message.name }, []];
    case "SubmittedNewGroup":
      return [model, [CreateGroup({ displayName: model.newGroupName })]];
    case "CreatedGroup":
      return [
        {
          ...model,
          groups: [
            ...model.groups.filter((group) => group.groupId !== message.group.groupId),
            message.group,
          ],
          newGroupName: "",
          currentGroup: message.group,
          route: Group({ groupRef: message.group.publicId }),
        },
        [],
      ];
    case "LoadedGroup":
      return [
        {
          ...model,
          currentGroup: message.group,
          membership: message.membership,
          members: message.members,
        },
        [],
      ];
    case "LoadedAccountSecurity":
      return [
        { ...model, accountPasskeys: message.passkeys, hasPassword: message.hasPassword },
        [],
      ];
    case "LoadedInvite":
      return [{ ...model, inviteToken: message.token }, []];
    case "ChangedInviteToken":
      return [{ ...model, inviteToken: message.token }, []];
    case "CompletedAccountAction":
      return [model, model.route._tag === "AccountSettings" ? [LoadAccountSecurity()] : []];
    case "SignedOut":
      return [
        {
          ...model,
          route: Login(),
          session: AnonymousSession(),
          account: UnavailableAccount(),
          groups: [],
        },
        [],
      ];
    case "DeletedGroup":
      return [
        {
          ...model,
          route: Home(),
          groups: model.groups.filter((group) => group.groupId !== message.groupId),
          currentGroup: null,
          members: [],
          membership: null,
        },
        [],
      ];
    case "RequestedSignOut":
      return [model, [SignOut()]];
    case "RequestedSetPassword":
      return [model, [SetAccountPassword(message)]];
    case "RequestedRemovePassword":
      return [model, [RemoveAccountPassword(message)]];
    case "RequestedRemovePasskey":
      return [model, [RemoveAccountPasskey(message)]];
    case "RequestedInvite":
      return [model, [LoadInvite(message)]];
    case "RequestedJoin":
      return [model, [JoinGroup(message)]];
    case "RequestedRenameGroup":
      return [model, [RenameGroup(message)]];
    case "RequestedMemberRole":
      return [model, [SetMemberRole(message)]];
    case "RequestedDeleteGroup":
      return [model, [DeleteGroup(message)]];
    case "FailedClientCommand":
      return [{ ...model, errorToast: { message: message.message } }, []];
    case "CompletedPasskeyRegistration":
      return [
        { ...model, errorToast: message.error === null ? null : { message: message.error } },
        [],
      ];
    case "RequestedPasskeyRegistration":
      return [model, [RegisterPasskey({ label: message.label })]];
  }
};

/**
 * A note socket exists only for a signed-in member of a loaded club. Every part
 * of the identity takes part in the resource key, so a club switch or a role
 * change releases the old connection and acquires a new one.
 */
const modelToNoteAgentRequirements = (model: Model): Option.Option<NoteAgentRequirements> =>
  model.currentGroup === null ||
  model.session._tag !== "AuthenticatedSession" ||
  model.membership?.isMember !== true
    ? Option.none()
    : Option.some({
        groupId: model.currentGroup.groupId,
        author: { id: model.session.user.id, name: model.session.user.name },
        isOwner: model.currentGroup.ownerId === model.session.user.id,
        sessionMode: currentSessionMode(),
      });

const noteAgentResources = makeNoteAgentResources<Model, Message>({
  modelToRequirements: modelToNoteAgentRequirements,
  toMessage: (message) => message,
});

const noteAgentSubscriptions = makeNoteAgentSubscriptions<Model, Message>({
  modelToConnectionKey: (model) => model.notes.connectionKey,
  toMessage: (message) => message,
});

const readerSubscriptions = makeReaderSubscriptions<Model, Message>({
  modelToReader: (model) => model.reader,
  toMessage: (message) => message,
});

/** The workspace layout follows the same breakpoint the React workspace uses;
 *  a media-query listener is the browser fact, the Model holds the answer. */
const viewportSubscriptions = Subscription.make<Model, Message>()((entry) => ({
  viewport: entry(
    {},
    {
      modelToDependencies: () => ({}),
      dependenciesToStream: () =>
        Subscription.fromEvent<MediaQueryListEvent, Message>({
          target: () => globalThis.matchMedia(MOBILE_VIEWPORT_QUERY),
          type: "change",
          toMessage: (event) => ResizedViewport({ viewport: event.matches ? "narrow" : "wide" }),
        }),
    },
  ),
}));

const subscriptions = Subscription.aggregate<Model, Message, NoteAgentService>()(
  noteAgentSubscriptions,
  readerSubscriptions,
  viewportSubscriptions,
);

/**
 * Reader and notes, laid out the way the viewport asks for: side by side on a
 * wide screen, and as two pages of a swipeable track on a phone, where the
 * reader's `pane` decides which one is showing.
 */
const workspaceView = (
  model: Model,
  reader: ReaderWorkspace,
  groupRef: string,
  h: HtmlBuilder<Message>,
): Html => {
  const narrow = model.viewport === "narrow";
  const notes = notesView(
    model.notes,
    {
      sourceId: reader.sourceId,
      groupRef,
      selection: reader.selection,
      jumpToHighlight: (anchor) => JumpedToHighlight({ anchor }),
    },
    h,
  );
  const track = h.div(
    [
      h.Class(narrow ? "workspace-layout-track pager-track" : "workspace-layout-track"),
      ...(narrow && reader.pane === "notes" ? [h.Style({ transform: "translateX(-100%)" })] : []),
    ],
    [
      h.div(
        [h.Key("reader"), h.Class(narrow ? "pager-page" : "split-pane")],
        [readerView(reader, h)],
      ),
      h.div(
        [h.Key("notes"), h.Class(narrow ? "pager-page" : "split-pane split-pane--grow")],
        [notes],
      ),
    ],
  );
  const chromeHidden = reader.chromeLevel >= 1;
  if (!narrow) {
    return h.div(
      [
        h.Class(
          chromeHidden ? "workspace-layout split app--chrome-hidden" : "workspace-layout split",
        ),
      ],
      [track],
    );
  }
  return h.div(
    [
      h.Class(
        chromeHidden ? "workspace-layout pager app--chrome-hidden" : "workspace-layout pager",
      ),
    ],
    [
      track,
      h.div(
        [h.Class("pager-tabs")],
        reader.selection === null
          ? [
              h.button(
                [
                  h.Type("button"),
                  h.AriaPressed(String(reader.pane === "reader")),
                  h.OnClick(SwitchedReaderPane({ pane: "reader" })),
                  h.Title("Show reader"),
                ],
                ["Reader"],
              ),
              h.button(
                [
                  h.Type("button"),
                  h.AriaPressed(String(reader.pane === "notes")),
                  h.OnClick(SwitchedReaderPane({ pane: "notes" })),
                  h.Title("Show notes"),
                ],
                ["Notes"],
              ),
            ]
          : [
              h.button(
                [
                  h.Type("button"),
                  h.Class("pager-add-note"),
                  h.OnClick(CommittedReaderSelection({ intent: "note" })),
                  h.Title("Add a note on this selection"),
                ],
                ["Add Note"],
              ),
              h.button(
                [
                  h.Type("button"),
                  h.Class("pager-add-note pager-highlight"),
                  h.OnClick(CommittedReaderSelection({ intent: "highlight" })),
                  h.Title("Highlight this selection"),
                ],
                ["Highlight"],
              ),
            ],
      ),
    ],
  );
};

export const makeBookclubApplication = (container: HTMLElement) => {
  container.id = FOLDKIT_RUNTIME_ID;
  return Runtime.makeApplication<Model, Message, never, NoteAgentService>({
    Model,
    container,
    init,
    update,
    managedResources: noteAgentResources,
    subscriptions,
    view: (model, h) => {
      const page =
        model.route._tag === "Login"
          ? h.form(
              [h.OnSubmit(SubmittedPasswordLogin())],
              [
                h.label([h.For("login-email")], ["Email"]),
                h.input([
                  h.Id("login-email"),
                  h.Type("email"),
                  h.Autocomplete("email"),
                  h.Value(model.loginEmail),
                  h.OnInput((email) => ChangedLogin({ email, password: model.loginPassword })),
                ]),
                h.label([h.For("login-password")], ["Password"]),
                h.input([
                  h.Id("login-password"),
                  h.Type("password"),
                  h.Autocomplete("current-password"),
                  h.Value(model.loginPassword),
                  h.OnInput((password) => ChangedLogin({ email: model.loginEmail, password })),
                ]),
                h.button([h.Type("submit")], ["Sign in"]),
              ],
            )
          : model.route._tag === "AccountSettings"
            ? h.section(
                [h.AriaLabel("Account settings")],
                [
                  h.h2([], ["Account settings"]),
                  h.button([h.OnClick(Navigated({ route: Home() }))], ["Back"]),
                  h.button(
                    [h.OnClick(RequestedPasskeyRegistration({ label: "Passkey" }))],
                    ["Register passkey"],
                  ),
                  h.ul(
                    [],
                    model.accountPasskeys.map((passkey) =>
                      h.li(
                        [],
                        [
                          passkey.label,
                          h.button(
                            [h.OnClick(RequestedRemovePasskey({ id: passkey.id }))],
                            [`Remove ${passkey.label}`],
                          ),
                        ],
                      ),
                    ),
                  ),
                  h.label([h.For("account-password")], ["Password"]),
                  h.input([
                    h.Id("account-password"),
                    h.Type("password"),
                    h.Value(model.loginPassword),
                    h.OnInput((password) => ChangedLogin({ email: model.loginEmail, password })),
                  ]),
                  h.button(
                    [h.OnClick(RequestedSetPassword({ password: model.loginPassword }))],
                    [model.hasPassword ? "Change password" : "Set password"],
                  ),
                  ...(model.hasPassword
                    ? [
                        h.button(
                          [
                            h.OnClick(
                              RequestedRemovePassword({ currentPassword: model.loginPassword }),
                            ),
                          ],
                          ["Remove password"],
                        ),
                      ]
                    : []),
                  h.button([h.OnClick(RequestedSignOut())], ["Sign out"]),
                ],
              )
            : model.route._tag === "Reader"
              ? model.reader === null
                ? h.p([h.Class("reader-empty label")], ["Open a book to begin."])
                : workspaceView(model, model.reader, model.route.groupRef, h)
              : model.route._tag === "Group"
                ? h.section(
                    [h.AriaLabel("Club")],
                    [
                      h.h2([], [model.route.groupRef]),
                      h.button([h.OnClick(Navigated({ route: Home() }))], ["Back"]),
                      ...(model.currentGroup === null
                        ? [h.p([h.Role("status")], ["Loading club"])]
                        : [
                            h.p([], [`${model.currentGroup.sources.length} books`]),
                            h.ul(
                              [h.AriaLabel("Book catalog")],
                              model.currentGroup.sources.map((sourceId) =>
                                h.li([], [model.currentGroup?.bookTitles[sourceId] ?? sourceId]),
                              ),
                            ),
                            h.label([h.For("club-title")], ["Club title"]),
                            h.input([
                              h.Id("club-title"),
                              h.Value(model.newGroupName),
                              h.OnInput((name) => ChangedNewGroupName({ name })),
                            ]),
                            h.button(
                              [
                                h.OnClick(
                                  RequestedRenameGroup({
                                    groupRef: model.route.groupRef,
                                    title: model.newGroupName,
                                  }),
                                ),
                              ],
                              ["Rename club"],
                            ),
                            h.button(
                              [h.OnClick(RequestedInvite({ groupRef: model.route.groupRef }))],
                              ["Create invite link"],
                            ),
                            ...(model.inviteToken === ""
                              ? []
                              : [h.p([h.Role("status")], [`Invite token: ${model.inviteToken}`])]),
                            h.ul(
                              [h.AriaLabel("Members")],
                              model.members.map((member) =>
                                h.li(
                                  [],
                                  [
                                    `${member.name}: ${member.role}`,
                                    h.button(
                                      [
                                        h.OnClick(
                                          RequestedMemberRole({
                                            groupRef: model.currentGroup?.publicId ?? "",
                                            memberId: member.id,
                                            role: member.role === "visitor" ? "member" : "visitor",
                                          }),
                                        ),
                                      ],
                                      [`Toggle ${member.name} role`],
                                    ),
                                  ],
                                ),
                              ),
                            ),
                            h.button(
                              [
                                h.OnClick(
                                  RequestedDeleteGroup({
                                    groupRef: model.route.groupRef,
                                    groupId: model.currentGroup.groupId,
                                  }),
                                ),
                              ],
                              ["Delete club"],
                            ),
                          ]),
                    ],
                  )
                : h.section(
                    [h.AriaLabel("Your clubs")],
                    [
                      h.h2([], ["Your clubs"]),
                      h.form(
                        [h.OnSubmit(SubmittedNewGroup())],
                        [
                          h.label([h.For("new-club")], ["New club name"]),
                          h.input([
                            h.Id("new-club"),
                            h.Value(model.newGroupName),
                            h.OnInput((name) => ChangedNewGroupName({ name })),
                          ]),
                          h.button([h.Type("submit")], ["Create club"]),
                        ],
                      ),
                      h.label([h.For("join-club-ref")], ["Club reference"]),
                      h.input([
                        h.Id("join-club-ref"),
                        h.Value(model.loginEmail),
                        h.OnInput((email) =>
                          ChangedLogin({ email, password: model.loginPassword }),
                        ),
                      ]),
                      h.label([h.For("join-token")], ["Invite token"]),
                      h.input([
                        h.Id("join-token"),
                        h.Value(model.inviteToken),
                        h.OnInput((token) => ChangedInviteToken({ token })),
                      ]),
                      h.button(
                        [
                          h.OnClick(
                            RequestedJoin({ groupRef: model.loginEmail, token: model.inviteToken }),
                          ),
                        ],
                        ["Join club"],
                      ),
                      h.ul(
                        [],
                        model.groups.map((group) =>
                          h.li(
                            [],
                            [
                              h.button(
                                [
                                  h.OnClick(
                                    Navigated({ route: Group({ groupRef: group.publicId }) }),
                                  ),
                                ],
                                [group.displayName],
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  );
      return {
        title: "Bookclub",
        body: h.main(
          [],
          [
            h.h1([], ["Bookclub"]),
            h.nav(
              [h.AriaLabel("Primary")],
              [
                h.button([h.OnClick(Navigated({ route: Home() }))], ["Home"]),
                h.button([h.OnClick(Navigated({ route: Login() }))], ["Sign in"]),
                h.button([h.OnClick(Navigated({ route: AccountSettings() }))], ["Account"]),
              ],
            ),
            page,
            ...(model.errorToast === null
              ? []
              : [h.p([h.Role("alert")], [model.errorToast.message])]),
          ],
        ),
      };
    },
    devTools: false,
  });
};
