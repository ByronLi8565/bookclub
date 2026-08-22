import { Duration, Effect, Option, Schema, Stream } from "effect";
import { Command, Navigation, Runtime, Subscription } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { m } from "foldkit/message";
import { ts } from "foldkit/schema";
import {
  GroupRoleSchema,
  GroupSummary,
  Membership,
  RosterEntry,
} from "../../shared/types/groups.ts";
import { PasskeyInfo } from "../../shared/types/passkeys.ts";
import { groupUrlName } from "../../shared/groupUrls.ts";
import {
  currentSessionMode,
  makeNoteAgentResources,
  makeNoteAgentSubscriptions,
  type NoteAgentRequirements,
  type NoteAgentService,
} from "./resources/noteAgent.ts";
import { passkeyLogin, passkeysSupported, registerPasskey } from "../logic/auth/authClient.ts";
import { loginErrorMessage } from "../logic/auth/authMessages.ts";
import { Url } from "foldkit";
import { AppRoute, Club, Home, hrefFor, routeOf } from "./routes.ts";
import { clubNameErrorMessage } from "../logic/groups/groupMessages.ts";
import { setSessionToken } from "../logic/net/api.ts";
import { apiFailure } from "../logic/net/failure.ts";
import { bookclubClient } from "../logic/net/bookclubClient.ts";
import {
  cachedGroupView,
  cachedGroups,
  cachedSessionUser,
  forgetSessionUser,
  rememberGroupView,
  rememberGroups,
  rememberSessionUser,
} from "./offlineCache.ts";
import { loadingView } from "./loading.ts";
import { escapeKeyStream, modalView, pressOutsideModalStream } from "./modal.ts";
import settingsIcon from "@assets/settings.svg";
import { avatarImagePath, avatarInitial } from "../logic/groups/groupClient.ts";
import { books } from "../../shared/sources.ts";
import { GroupAction, permits } from "../../shared/groupPermissions.ts";
import { stepExpandedPane } from "../logic/visibility.ts";
import {
  InfoModel,
  infoView,
  initialInfoModel,
  isInfoMessage,
  updateInfo,
  type InfoMessage,
} from "./info.ts";
import {
  DismissedSettingsNotice,
  SettingsModel,
  initialSettingsModel,
  isSettingsMessage,
  ChosePdfPageLayout,
  OpenedSettings,
  settingsPrefs,
  settingsNotice,
  settingsView,
  updateSettings,
  type SettingsMessage,
} from "./settings.ts";
import {
  UploadModel,
  initialUploadModel,
  isUploadMessage,
  updateUpload,
  uploadView,
  type UploadMessage,
} from "./upload.ts";
import {
  InviteModel,
  OpenedInvite,
  initialInviteModel,
  inviteControlsView,
  inviteView,
  isInviteMessage,
  updateInvite,
  type InviteMessage,
} from "./invite.ts";
import {
  OpenedPresence,
  PresenceModel,
  initialPresenceModel,
  isPresenceMessage,
  presenceIndicatorView,
  presencePeopleView,
  presenceView,
  updatePresence,
  type PresenceMessage,
} from "./presence.ts";
import { backupControlsView } from "./settings.ts";
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
  ChangedReaderLayout,
  CommittedReaderSelection,
  IdentifiedReaderSession,
  JumpedToHighlight,
  ReaderWorkspace,
  ShowedReaderHighlights,
  SwitchedReaderPane,
  browserReaderEnvironment,
  isReaderMessage,
  makeReaderSlice,
  makeReaderSubscriptions,
  openReader,
  SelectedReaderSource,
  type ReaderMessage,
  type ReaderSelection,
} from "./reader.ts";

// One slice per application: the Mounts inside it own the live book handles.
const reader = makeReaderSlice(browserReaderEnvironment);
const { update: updateReader, view: readerView } = reader;

export const FOLDKIT_RUNTIME_ID = "bookclub-foldkit";

/** React routes `/` and `/clubs/:groupRef` and nothing else: signing in and the
 *  account live in overlays over whichever page is showing, and a club with a
 *  book open *is* the workspace rather than a page of its own. The table itself
 *  is in `routes.ts`, which owns parsing and link building too. */
export { Club, Home, hrefFor } from "./routes.ts";
export const Route = AppRoute;
export type Route = AppRoute;

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

/** Which overlay is up. React keeps one `activeModal` per surface; a single
 *  tagged value says the same thing once for the whole application. */
export const NoOverlay = ts("NoOverlay");
export const LoginOverlay = ts("LoginOverlay");
export const InfoOverlay = ts("InfoOverlay");
export const SettingsOverlay = ts("SettingsOverlay");
export const PresenceOverlay = ts("PresenceOverlay");
export const UploadOverlay = ts("UploadOverlay");
export const InviteOverlay = ts("InviteOverlay", {
  groupRef: Schema.String,
  displayName: Schema.String,
});
export const Overlay = Schema.Union([
  NoOverlay,
  LoginOverlay,
  InfoOverlay,
  SettingsOverlay,
  PresenceOverlay,
  UploadOverlay,
  InviteOverlay,
]);
export type Overlay = typeof Overlay.Type;

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

/** React's toast store, as Model state: several toasts at once, each with its
 *  own kind, its own dwell time, and an optional link. */
export const ToastAction = Schema.Struct({ label: Schema.String, href: Schema.String });
export const Toast = Schema.Struct({
  id: Schema.String,
  type: Schema.Literals(["info", "error"]),
  title: Schema.String,
  message: Schema.String,
  action: Schema.NullOr(ToastAction),
  durationMs: Schema.Number,
});
export type Toast = typeof Toast.Type;

const DEFAULT_TOAST_MS = 2000;

export const errorToast = (title: string, message: string): Toast => ({
  id: crypto.randomUUID(),
  type: "error",
  title,
  message,
  action: null,
  durationMs: 6000,
});

export const infoToast = (title: string, message: string): Toast => ({
  id: crypto.randomUUID(),
  type: "info",
  title,
  message,
  action: null,
  durationMs: DEFAULT_TOAST_MS,
});

/** Signing in is a two-step form: an email (with an optional password, or a
 *  passkey), then the code that was mailed out if neither shortcut applied. */
export const LoginStep = Schema.Literals(["email", "code", "done"]);
export type LoginStep = typeof LoginStep.Type;

export const Model = Schema.Struct({
  route: Route,
  session: Session,
  account: Account,
  loginStep: LoginStep,
  loginEmail: Schema.String,
  loginPassword: Schema.String,
  loginCode: Schema.String,
  loginError: Schema.NullOr(Schema.String),
  loginBusy: Schema.Boolean,
  passkeysAvailable: Schema.Boolean,
  groups: Schema.Array(GroupSummary),
  newGroupName: Schema.String,
  creatingClub: Schema.Boolean,
  newGroupPending: Schema.Boolean,
  newGroupError: Schema.NullOr(Schema.String),
  currentGroup: Schema.NullOr(GroupSummary),
  membership: Schema.NullOr(Membership),
  members: Schema.Array(RosterEntry),
  /** Why the club on screen could not be opened, when it could not be. Held on
   *  the Model rather than raised as a toast because each answer is a page. */
  clubError: Schema.NullOr(Schema.Literals(["notfound", "offline"])),
  joinGroupRef: Schema.String,
  /** The token an invite link arrived with, held until the club reports whether
   *  this reader is already a member. */
  pendingInvite: Schema.NullOr(Schema.String),
  inviteToken: Schema.String,
  accountPasskeys: Schema.Array(PasskeyInfo),
  hasPassword: Schema.Boolean,
  passkeyLabel: Schema.String,
  currentPassword: Schema.String,
  newPassword: Schema.String,
  accountBusy: Schema.Boolean,
  selectedSourceId: Schema.NullOr(Schema.String),
  reader: Schema.NullOr(ReaderWorkspace),
  overlay: Overlay,
  info: InfoModel,
  settings: SettingsModel,
  presence: PresenceModel,
  upload: UploadModel,
  invite: InviteModel,
  renamingTarget: Schema.NullOr(Schema.String),
  renameDraft: Schema.String,
  splitShare: Schema.Number,
  splitDragging: Schema.Boolean,
  expandedPane: Schema.NullOr(Schema.Literals(["left", "right"])),
  viewport: Viewport,
  notes: NotesModel,
  toasts: Schema.Array(Toast),
  online: Schema.Boolean,
});
export type Model = typeof Model.Type;

export const LoadedSession = m("LoadedSession", { user: SessionUser });
/** The sign-in check finished and nobody is signed in. Silent on purpose: an
 *  anonymous visitor is an ordinary state, not a failure to report. */
export const NoSession = m("NoSession");
export const SpawnedToast = m("SpawnedToast", { toast: Toast });
export const OpenedOverlay = m("OpenedOverlay", { overlay: Overlay });
export const ClosedOverlay = m("ClosedOverlay");
export const StartedRename = m("StartedRename", { target: Schema.String, value: Schema.String });
export const ChangedRenameDraft = m("ChangedRenameDraft", { value: Schema.String });
export const CommittedRename = m("CommittedRename");
export const CancelledRename = m("CancelledRename");
export const SteppedExpandedPane = m("SteppedExpandedPane", {
  direction: Schema.Literals(["left", "right"]),
});
export const StartedSplitDrag = m("StartedSplitDrag");
export const MovedSplitDivider = m("MovedSplitDivider", { share: Schema.Number });
export const EndedSplitDrag = m("EndedSplitDrag");
export const DismissedToast = m("DismissedToast", { id: Schema.String });
export const ChangedOnline = m("ChangedOnline", { online: Schema.Boolean });
export const ResizedViewport = m("ResizedViewport", { viewport: Viewport });
export const Navigated = m("Navigated", { route: Route });
// One message per field. A message carrying both would have to read the other
// from the model its handler closed over, and a handler that outlives an edit to
// the other field then writes a stale value back over it.
export const ChangedLoginEmail = m("ChangedLoginEmail", { email: Schema.String });
export const ChangedLoginPassword = m("ChangedLoginPassword", { password: Schema.String });
export const ChangedLoginCode = m("ChangedLoginCode", { code: Schema.String });
export const SubmittedLogin = m("SubmittedLogin");
export const SubmittedLoginCode = m("SubmittedLoginCode");
export const RequestedPasskeyLogin = m("RequestedPasskeyLogin");
export const SentLoginCode = m("SentLoginCode");
export const FailedLogin = m("FailedLogin", { error: Schema.String });
export const DismissedLogin = m("DismissedLogin");
export const LoadedGroups = m("LoadedGroups", { groups: Schema.Array(GroupSummary) });
/** The club list could not be refreshed. Whatever is already on screen — the
 *  copy this device cached — stays there. */
export const FailedGroups = m("FailedGroups");
export const StartedCreatingClub = m("StartedCreatingClub");
export const CancelledCreatingClub = m("CancelledCreatingClub");
export const FailedCreateGroup = m("FailedCreateGroup", { error: Schema.String });
export const JoinedGroup = m("JoinedGroup", { group: GroupSummary });
export const FailedJoin = m("FailedJoin");
export const RequestedUrl = m("RequestedUrl", { href: Schema.String });
export const LeftForExternalUrl = m("LeftForExternalUrl", { href: Schema.String });
export const LeftTheApp = m("LeftTheApp");
export const ChangedNewGroupName = m("ChangedNewGroupName", { name: Schema.String });
export const SubmittedNewGroup = m("SubmittedNewGroup");
export const CreatedGroup = m("CreatedGroup", { group: GroupSummary });
export const LoadedGroup = m("LoadedGroup", {
  group: GroupSummary,
  membership: Membership,
  members: Schema.Array(RosterEntry),
});
/** The server answered that there is no such club. Authoritative, so it is a
 *  page and not a toast. */
export const MissingGroup = m("MissingGroup");
/** The server never answered. If this device has read the club before it opens
 *  from that copy; otherwise the reader is told they are offline. */
export const UnreachableGroup = m("UnreachableGroup", { groupRef: Schema.String });
export const LoadedAccountSecurity = m("LoadedAccountSecurity", {
  passkeys: Schema.Array(PasskeyInfo),
  hasPassword: Schema.Boolean,
});
export const LoadedInvite = m("LoadedInvite", { token: Schema.String });
export const ChangedInviteToken = m("ChangedInviteToken", { token: Schema.String });
export const ChangedJoinGroupRef = m("ChangedJoinGroupRef", { groupRef: Schema.String });
export const CompletedAccountAction = m("CompletedAccountAction", {
  title: Schema.String,
  message: Schema.String,
});
export const FailedAccountAction = m("FailedAccountAction", { error: Schema.String });
export const ChangedPasskeyLabel = m("ChangedPasskeyLabel", { label: Schema.String });
export const ChangedCurrentPassword = m("ChangedCurrentPassword", { password: Schema.String });
export const ChangedNewPassword = m("ChangedNewPassword", { password: Schema.String });
export const SelectedBook = m("SelectedBook", { sourceId: Schema.String });
export const RequestedBookRename = m("RequestedBookRename", {
  sourceId: Schema.String,
  title: Schema.String,
});
export const RenamedBook = m("RenamedBook", { group: GroupSummary });
export const RestoredSelectedSource = m("RestoredSelectedSource", {
  sourceId: Schema.NullOr(Schema.String),
});
export const RememberedSelectedSource = m("RememberedSelectedSource");
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
  | typeof NoSession.Type
  | typeof SpawnedToast.Type
  | typeof OpenedOverlay.Type
  | typeof ClosedOverlay.Type
  | InfoMessage
  | SettingsMessage
  | PresenceMessage
  | UploadMessage
  | InviteMessage
  | typeof StartedRename.Type
  | typeof ChangedRenameDraft.Type
  | typeof CommittedRename.Type
  | typeof CancelledRename.Type
  | typeof SteppedExpandedPane.Type
  | typeof StartedSplitDrag.Type
  | typeof MovedSplitDivider.Type
  | typeof EndedSplitDrag.Type
  | typeof DismissedToast.Type
  | typeof ChangedOnline.Type
  | typeof ResizedViewport.Type
  | typeof Navigated.Type
  | typeof ChangedLoginEmail.Type
  | typeof ChangedLoginPassword.Type
  | typeof ChangedLoginCode.Type
  | typeof SubmittedLogin.Type
  | typeof SubmittedLoginCode.Type
  | typeof RequestedPasskeyLogin.Type
  | typeof SentLoginCode.Type
  | typeof FailedLogin.Type
  | typeof DismissedLogin.Type
  | typeof LoadedGroups.Type
  | typeof FailedGroups.Type
  | typeof StartedCreatingClub.Type
  | typeof CancelledCreatingClub.Type
  | typeof FailedCreateGroup.Type
  | typeof JoinedGroup.Type
  | typeof FailedJoin.Type
  | typeof RequestedUrl.Type
  | typeof LeftForExternalUrl.Type
  | typeof LeftTheApp.Type
  | typeof ChangedNewGroupName.Type
  | typeof SubmittedNewGroup.Type
  | typeof CreatedGroup.Type
  | typeof LoadedGroup.Type
  | typeof MissingGroup.Type
  | typeof UnreachableGroup.Type
  | typeof LoadedAccountSecurity.Type
  | typeof LoadedInvite.Type
  | typeof ChangedInviteToken.Type
  | typeof ChangedJoinGroupRef.Type
  | typeof CompletedAccountAction.Type
  | typeof FailedAccountAction.Type
  | typeof ChangedPasskeyLabel.Type
  | typeof ChangedCurrentPassword.Type
  | typeof ChangedNewPassword.Type
  | typeof SelectedBook.Type
  | typeof RequestedBookRename.Type
  | typeof RenamedBook.Type
  | typeof RestoredSelectedSource.Type
  | typeof RememberedSelectedSource.Type
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

/**
 * Who is signed in, according to the server. Nothing else in the app asks, so
 * without this the cookie a returning reader still holds is never presented and
 * they are shown the signed-out page.
 *
 * A server that answers is believed, including when it says nobody. Only a
 * server that never answered falls back to the identity this device cached,
 * which is what keeps a reader signed in with no connection.
 */
export const LoadSession = Command.define("LoadSession", {
  messages: [LoadedSession, NoSession],
  execute: bookclubClient.pipe(
    Effect.flatMap((client) => client.auth.me({})),
    Effect.map(({ user }) => {
      rememberSessionUser(user);
      return LoadedSession({ user });
    }),
    Effect.catch((error) =>
      Effect.sync(() => {
        if (apiFailure(error) !== "unreachable") {
          forgetSessionUser();
          return NoSession();
        }
        const cached = cachedSessionUser();
        return cached === null ? NoSession() : LoadedSession({ user: cached });
      }),
    ),
  ),
});

export const LoadGroups = Command.define("LoadGroups", {
  messages: [LoadedGroups, FailedGroups],
  execute: bookclubClient.pipe(
    Effect.flatMap((client) => client.groups.list({})),
    Effect.map(({ groups }) => {
      const user = cachedSessionUser();
      if (user !== null) rememberGroups(user.id, groups);
      return LoadedGroups({ groups });
    }),
    Effect.catch(() => Effect.succeed(FailedGroups())),
  ),
});

/** Every API failure carries a code the sign-in form turns into a sentence; a
 *  transport or decode failure has none and reads as the generic apology. */
const loginErrorCode = (error: unknown): string =>
  typeof error === "object" && error !== null && "error" in error && typeof error.error === "string"
    ? error.error
    : "unknown";

/** The native app carries its session as a bearer token rather than a cookie, so
 *  a session is only signed in once the token is stored. */
const rememberSession = (session: { user: SessionUser; token?: string }) =>
  Effect.promise(() => setSessionToken(session.token ?? null)).pipe(
    Effect.tap(() => Effect.sync(() => rememberSessionUser(session.user))),
    Effect.as(LoadedSession({ user: session.user })),
  );

export const PasswordLogin = Command.define("PasswordLogin", {
  args: { email: Schema.String, password: Schema.String },
  messages: [LoadedSession, FailedLogin],
  execute: ({ email, password }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) => client.auth.passwordLogin({ payload: { email, password } })),
      Effect.flatMap(({ body }) => rememberSession(body)),
      Effect.catch((error) => Effect.succeed(FailedLogin({ error: loginErrorCode(error) }))),
    ),
});

/** The email step when no password was typed. A dev worker signs the reader in
 *  outright; a real one mails a code and answers with no content. */
export const StartLogin = Command.define("StartLogin", {
  args: { email: Schema.String },
  messages: [LoadedSession, SentLoginCode, FailedLogin],
  execute: ({ email }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) => client.auth.start({ payload: { email } })),
      Effect.flatMap(
        (result): Effect.Effect<typeof LoadedSession.Type | typeof SentLoginCode.Type> =>
          result === undefined ? Effect.succeed(SentLoginCode()) : rememberSession(result.body),
      ),
      Effect.catch((error) => Effect.succeed(FailedLogin({ error: loginErrorCode(error) }))),
    ),
});

export const VerifyLoginCode = Command.define("VerifyLoginCode", {
  args: { email: Schema.String, code: Schema.String },
  messages: [LoadedSession, FailedLogin],
  execute: ({ email, code }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) => client.auth.verify({ payload: { email, code } })),
      Effect.flatMap(({ body }) => rememberSession(body)),
      Effect.catch((error) => Effect.succeed(FailedLogin({ error: loginErrorCode(error) }))),
    ),
});

/** The passkey ceremony runs against the browser's authenticator rather than the
 *  API contract, so it goes through the same client the React modal uses. */
export const PasskeyLogin = Command.define("PasskeyLogin", {
  args: { email: Schema.String },
  messages: [LoadedSession, FailedLogin],
  execute: ({ email }) =>
    Effect.promise(() => passkeyLogin(email)).pipe(
      Effect.flatMap(
        (result): Effect.Effect<typeof LoadedSession.Type | typeof FailedLogin.Type> =>
          result.ok
            ? rememberSession(result.value)
            : Effect.succeed(FailedLogin({ error: result.error })),
      ),
    ),
});

/** React's account settings map their own small set of codes. */
const ACCOUNT_MESSAGES = new Map([
  ["weak_password", "Password must be at least 8 characters."],
  ["bad_current", "Current password is incorrect."],
  ["passkey_cancelled", "Passkey setup was cancelled."],
  ["verification_failed", "Couldn't register that passkey. Try again."],
  ["challenge_expired", "That took too long. Try again."],
  ["unauthenticated", "Please sign in again."],
]);

const accountErrorCode = (error: unknown): string =>
  typeof error === "object" && error !== null && "error" in error && typeof error.error === "string"
    ? error.error
    : "unknown";

const accountErrorMessage = (error: string): string =>
  ACCOUNT_MESSAGES.get(error) ?? "Something went wrong. Try again.";

/** Which book a club opens on is a per-device choice React keeps in local
 *  storage; reading and writing it is a side effect either way. */
const selectedSourceKey = (groupId: string): string => `bookclub.selectedSource.${groupId}`;

export const RenameBook = Command.define("RenameBook", {
  args: { groupRef: Schema.String, sourceId: Schema.String, title: Schema.String },
  messages: [RenamedBook, FailedClientCommand],
  execute: ({ groupRef, sourceId, title }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) =>
        client.groups.renameBook({ params: { groupRef }, payload: { sourceId, title } }),
      ),
      Effect.map(({ group }) => RenamedBook({ group })),
      Effect.catch(() =>
        Effect.succeed(FailedClientCommand({ message: "Couldn't rename that book." })),
      ),
    ),
});

export const RestoreSelectedSource = Command.define("RestoreSelectedSource", {
  args: { groupId: Schema.String },
  messages: [RestoredSelectedSource],
  execute: ({ groupId }) =>
    Effect.sync(() =>
      RestoredSelectedSource({
        sourceId: globalThis.localStorage?.getItem(selectedSourceKey(groupId)) ?? null,
      }),
    ),
});

export const RememberSelectedSource = Command.define("RememberSelectedSource", {
  args: { groupId: Schema.String, sourceId: Schema.NullOr(Schema.String) },
  messages: [RememberedSelectedSource],
  execute: ({ groupId, sourceId }) =>
    Effect.sync(() => {
      if (sourceId === null) globalThis.localStorage?.removeItem(selectedSourceKey(groupId));
      else globalThis.localStorage?.setItem(selectedSourceKey(groupId), sourceId);
      return RememberedSelectedSource();
    }),
});

/** A link that leaves the app is a full page load, which only the runtime can
 *  perform — an `update` cannot touch the browser itself. */
/** Navigation the reader did not click: landing on a club just created, or on
 *  the clubs card after signing out. The Model and the address bar move
 *  together or the back button lies. */
export const PushUrl = Command.define("PushUrl", {
  args: { href: Schema.String },
  messages: [LeftTheApp],
  execute: ({ href }) => Navigation.pushUrl(href).pipe(Effect.as(LeftTheApp())),
});

/** The same, without a history entry: used to drop a spent `?invite=` token so
 *  the back button cannot re-offer it. */
export const ReplaceUrl = Command.define("ReplaceUrl", {
  args: { href: Schema.String },
  messages: [LeftTheApp],
  execute: ({ href }) => Navigation.replaceUrl(href).pipe(Effect.as(LeftTheApp())),
});

export const LoadExternalUrl = Command.define("LoadExternalUrl", {
  args: { href: Schema.String },
  // The page is being replaced, so this arrives only if the browser refused the
  // navigation; a Command has to name a Message either way.
  messages: [LeftTheApp],
  execute: ({ href }) => Navigation.load(href).pipe(Effect.as(LeftTheApp())),
});

export const CreateGroup = Command.define("CreateGroup", {
  args: { displayName: Schema.String },
  messages: [CreatedGroup, FailedCreateGroup],
  execute: ({ displayName }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) => client.groups.create({ payload: { displayName } })),
      Effect.map(({ group }) => CreatedGroup({ group })),
      Effect.catch((error) => Effect.succeed(FailedCreateGroup({ error: loginErrorCode(error) }))),
    ),
});

/**
 * A club, from the server when it answers and from this device's copy when it
 * does not. The cache key comes from the cached identity rather than the Model
 * because a cold start on a club URL loads the club and the session at once —
 * the identity that can be relied on here is the one already written down.
 */
export const LoadGroup = Command.define("LoadGroup", {
  args: { groupRef: Schema.String },
  messages: [LoadedGroup, MissingGroup, UnreachableGroup],
  execute: ({ groupRef }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) => client.groups.get({ params: { groupRef } })),
      Effect.map(({ group, membership, members }) => {
        const user = cachedSessionUser();
        if (user !== null) rememberGroupView(user.id, groupRef, { group, membership, members });
        return LoadedGroup({ group, membership, members });
      }),
      Effect.catch((error) =>
        Effect.sync(() => {
          if (apiFailure(error) === "notfound") return MissingGroup();
          const user = cachedSessionUser();
          const view = user === null ? null : cachedGroupView(user.id, groupRef);
          return view === null ? UnreachableGroup({ groupRef }) : LoadedGroup(view);
        }),
      ),
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
  messages: [CompletedAccountAction, FailedAccountAction],
  execute: ({ password, currentPassword }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) =>
        client.auth.setPassword({
          payload: currentPassword === undefined ? { password } : { password, currentPassword },
        }),
      ),
      Effect.as(
        CompletedAccountAction({
          title: "Password saved",
          message: "You can now sign in with your password.",
        }),
      ),
      Effect.catch((error) =>
        Effect.succeed(FailedAccountAction({ error: accountErrorCode(error) })),
      ),
    ),
});

export const RemoveAccountPassword = Command.define("RemoveAccountPassword", {
  args: { currentPassword: Schema.String },
  messages: [CompletedAccountAction, FailedAccountAction],
  execute: ({ currentPassword }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) => client.auth.removePassword({ payload: { currentPassword } })),
      Effect.as(
        CompletedAccountAction({
          title: "Password removed",
          message: "You'll sign in with a code or passkey.",
        }),
      ),
      Effect.catch((error) =>
        Effect.succeed(FailedAccountAction({ error: accountErrorCode(error) })),
      ),
    ),
});

export const RemoveAccountPasskey = Command.define("RemoveAccountPasskey", {
  args: { id: Schema.String },
  messages: [CompletedAccountAction, FailedAccountAction],
  execute: ({ id }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) => client.auth.removePasskey({ params: { id } })),
      Effect.as(CompletedAccountAction({ title: "Passkey", message: "That passkey is gone." })),
      Effect.catch((error) =>
        Effect.succeed(FailedAccountAction({ error: accountErrorCode(error) })),
      ),
    ),
});

export const SignOut = Command.define("SignOut", {
  messages: [SignedOut, FailedClientCommand],
  execute: bookclubClient.pipe(
    Effect.tap(() => Effect.sync(forgetSessionUser)),
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
  messages: [JoinedGroup, FailedJoin],
  execute: ({ groupRef, token }) =>
    bookclubClient.pipe(
      Effect.flatMap((client) => client.groups.join({ params: { groupRef }, payload: { token } })),
      Effect.map(({ group }) => JoinedGroup({ group })),
      Effect.catch(() => Effect.succeed(FailedJoin())),
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
      Effect.as(CompletedAccountAction({ title: "Role changed", message: `Now a ${role}.` })),
      Effect.catch(() =>
        Effect.succeed(FailedClientCommand({ message: "Couldn't change that member's role." })),
      ),
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

export const DismissToastLater = Command.define("DismissToastLater", {
  args: { id: Schema.String, durationMs: Schema.Number },
  messages: [DismissedToast],
  // React's store sets a `setTimeout` per toast; the Command is that timer.
  execute: ({ id, durationMs }) =>
    Effect.sleep(Duration.millis(durationMs)).pipe(Effect.as(DismissedToast({ id }))),
});

/** React leaves the success note up for a beat before the modal goes away, and
 *  a sign-in that vanishes instantly reads as a failure. */
export const CloseLoginAfterSuccess = Command.define("CloseLoginAfterSuccess", {
  messages: [DismissedLogin],
  execute: Effect.sleep("1200 millis").pipe(Effect.as(DismissedLogin())),
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

/**
 * Reader and notes, laid out the way the viewport asks for: side by side on a
 * wide screen, and as two pages of a swipeable track on a phone, where the
 * reader's `pane` decides which one is showing. Dragging the divider past
 * either shoulder expands the pane on the other side.
 */
const DESKTOP_READER_SHARE = 62;
const MIN_SPLIT_SHARE = 25;
const MAX_SPLIT_SHARE = 80;

/**
 * The first paint of whatever URL the browser opened on. Asking who is signed
 * in is part of starting up: the session cookie is only worth anything if
 * something presents it.
 */
export const initFromUrl = (url: Url.Url): Update => {
  const [model] = init();
  const [routed, commands] = navigateTo(model, routeOf(url));
  return [routed, [LoadSession(), ...commands]];
};

export const init = (): readonly [Model, []] => [
  {
    route: Home(),
    session: LoadingSession(),
    account: UnavailableAccount(),
    loginStep: "email",
    loginEmail: "",
    loginPassword: "",
    loginCode: "",
    loginError: null,
    loginBusy: false,
    passkeysAvailable: passkeysSupported(),
    groups: [],
    newGroupName: "",
    creatingClub: false,
    newGroupPending: false,
    newGroupError: null,
    currentGroup: null,
    membership: null,
    members: [],
    clubError: null,
    joinGroupRef: "",
    pendingInvite: null,
    inviteToken: "",
    accountPasskeys: [],
    hasPassword: false,
    passkeyLabel: "",
    currentPassword: "",
    newPassword: "",
    accountBusy: false,
    selectedSourceId: null,
    reader: null,
    overlay: NoOverlay(),
    info: initialInfoModel(),
    settings: initialSettingsModel(),
    presence: initialPresenceModel(),
    upload: initialUploadModel(),
    invite: initialInviteModel(),
    renamingTarget: null,
    renameDraft: "",
    splitShare: DESKTOP_READER_SHARE,
    splitDragging: false,
    expandedPane: null,
    notes: initialNotesModel(),
    viewport: currentViewport(),
    toasts: [],
    online: globalThis.navigator?.onLine ?? true,
  },
  [],
];

/** A toast is raised and its own dismissal is scheduled in one move, so nothing
 *  can put one on screen and forget to take it off again. */
const withToast = (model: Model, toast: Toast): Update => [
  { ...model, toasts: [toast, ...model.toasts] },
  [DismissToastLater({ id: toast.id, durationMs: toast.durationMs })],
];

/** Every way into or out of the sign-in modal leaves the form as it was found. */
const blankLogin = {
  loginStep: "email",
  loginEmail: "",
  loginPassword: "",
  loginCode: "",
  loginError: null,
  loginBusy: false,
} as const;

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
  // React reports a rejected operation as a toast rather than in the panel, so
  // the note list never carries an error line of its own.
  const withNotes =
    message._tag === "RejectedNoteOperations"
      ? withToast(
          { ...model, notes },
          errorToast(
            "Some changes couldn't sync",
            "A note was edited or removed by someone else. Your change to it was skipped.",
          ),
        )[0]
      : { ...model, notes };
  if (withNotes.reader === null) return [withNotes, commands];
  const highlights = notesHighlights(notes, withNotes.reader.sourceId);
  if (sameHighlights(withNotes.reader.highlights, highlights)) return [withNotes, commands];
  const painted = updateReader(withNotes.reader, ShowedReaderHighlights({ highlights }));
  return painted === null
    ? [withNotes, commands]
    : [{ ...withNotes, reader: painted[0] }, [...commands, ...painted[1]]];
};

/**
 * Arriving at a route, however the reader got there: a link click, a redirect
 * after creating a club, or the first paint of a URL typed into the bar.
 * Leaving a club puts its book away, the way React unmounts the workspace when
 * the route changes.
 */
const navigateTo = (model: Model, route: Route): Update => {
  if (route._tag === "Home") {
    return [
      { ...model, route, reader: null, currentGroup: null, pendingInvite: null, clubError: null },
      [],
    ];
  }
  const { groupRef, invite } = route;
  return [
    // The token is held rather than acted on: only the club's own answer says
    // whether this reader still needs it.
    { ...model, route, pendingInvite: invite ?? null, clubError: null },
    [LoadGroup({ groupRef })],
  ];
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
    const { groupRef } = message;
    const [reader, commands] = updateReader(openReader(message), message) ?? [
      openReader(message),
      [],
    ];
    // A club *is* its open book; opening one changes what the club page shows
    // rather than where the reader is.
    return [{ ...model, route: Club({ groupRef }), reader }, commands];
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

/**
 * Settings publishes what React answered with a toast rather than spawning one
 * itself, so every toast in the application is raised in one place. Reading the
 * notice consumes it.
 */
const updateSettingsSlice = (model: Model, message: SettingsMessage): Update => {
  const [settings, commands] = updateSettings(model.settings, message);
  const layout = settingsPrefs(settings).reader.pdfPageLayout;
  const relaid =
    model.reader === null || model.reader.layout === layout
      ? null
      : updateReader(model.reader, ChangedReaderLayout({ layout }));
  const applied =
    relaid === null ? { ...model, settings } : { ...model, settings, reader: relaid[0] };
  const withLayout = relaid === null ? commands : [...commands, ...relaid[1]];
  const notice = settingsNotice(settings);
  if (notice === null) return [applied, withLayout];
  const [read] = updateSettings(settings, DismissedSettingsNotice());
  const [toasted, toastCommands] = withToast(
    { ...applied, settings: read },
    notice.tone === "error"
      ? errorToast(notice.title, notice.body)
      : infoToast(notice.title, notice.body),
  );
  return [toasted, [...withLayout, ...toastCommands]];
};

/** A finished upload is the club's first book: the modal closes and the club is
 *  re-read, which is what opens the reader on it. */
const updateUploadSlice = (model: Model, message: UploadMessage): Update => {
  const [upload, commands] = updateUpload(model.upload, message);
  const withUpload = { ...model, upload };
  if (message._tag === "FailedBookUpload") {
    return withToast(
      withUpload,
      errorToast("Upload failed", "Couldn't store that file. Try again."),
    );
  }
  if (message._tag !== "UploadedBook") return [withUpload, commands];
  const group = model.currentGroup;
  return [
    { ...withUpload, overlay: NoOverlay(), selectedSourceId: message.sourceId },
    group === null
      ? commands
      : [
          ...commands,
          RememberSelectedSource({ groupId: group.groupId, sourceId: message.sourceId }),
          LoadGroup({ groupRef: groupUrlName(group) }),
        ],
  ];
};

/** Presence owns the club's roster, its books and its images, so what it
 *  changes is the host's own club state rather than a copy of it. */
const updatePresenceSlice = (model: Model, message: PresenceMessage): Update => {
  const [presence, commands] = updatePresence(model.presence, message);
  const withPresence = { ...model, presence };
  switch (message._tag) {
    case "DeletedBook":
    case "SavedBookMetadata":
      return [{ ...withPresence, currentGroup: message.group }, commands];
    case "ChangedMemberRole":
      return [{ ...withPresence, members: message.members }, commands];
    case "FailedBookDownload":
      return withToast(withPresence, errorToast("Download failed", "Couldn't download that book."));
    default:
      return [withPresence, commands];
  }
};

const updateInviteSlice = (model: Model, message: InviteMessage): Update => {
  const [invite, commands] = updateInvite(model.invite, message);
  const withInvite = { ...model, invite };
  switch (message._tag) {
    case "SentInvite":
      return withToast(withInvite, infoToast("Invite sent", `Invited ${message.email}.`));
    case "FailedInvite":
      return withToast(withInvite, errorToast("Invite failed", "Couldn't send that invite."));
    case "FailedInviteLinkRotation":
      return withToast(withInvite, errorToast("Failed", "Couldn't regenerate the link."));
    default:
      return [withInvite, commands];
  }
};

export const update = (model: Model, message: Message): Update =>
  reconcileReaderIdentity(updateSlices(model, message));

const updateSlices = (model: Model, message: Message): Update => {
  if (message._tag === "ToggledReaderLayout") {
    // Page layout is a stored preference in React, not reader-local state, so
    // the key that flips it writes the preference and the reader follows.
    return updateSettingsSlice(
      model,
      ChosePdfPageLayout({
        value: settingsPrefs(model.settings).reader.pdfPageLayout === "auto" ? "single" : "auto",
      }),
    );
  }
  if (isReaderMessage(message)) return updateReaderSlice(model, message);
  if (isNotesMessage(message)) return updateNotesSlice(model, message);
  if (isInfoMessage(message)) {
    const [info, commands] = updateInfo(model.info, message);
    return [{ ...model, info }, commands];
  }
  if (isSettingsMessage(message)) return updateSettingsSlice(model, message);
  if (isPresenceMessage(message)) return updatePresenceSlice(model, message);
  if (isUploadMessage(message)) return updateUploadSlice(model, message);
  if (isInviteMessage(message)) return updateInviteSlice(model, message);
  switch (message._tag) {
    case "LoadedSession": {
      const signingIn = model.overlay._tag === "LoginOverlay";
      return [
        {
          ...model,
          session: AuthenticatedSession({ user: message.user }),
          account: ReadyAccount({ user: message.user }),
          // The clubs this device already knows about paint now rather than
          // when the network answers, and remain the answer if it never does.
          groups: model.groups.length === 0 ? cachedGroups(message.user.id) : model.groups,
          // The login modal stays up long enough to say it worked; the page
          // behind it was already where the reader wanted to be.
          loginStep: signingIn ? "done" : model.loginStep,
          loginBusy: false,
          loginError: null,
          loginPassword: "",
          loginCode: "",
        },
        signingIn ? [LoadGroups(), CloseLoginAfterSuccess()] : [LoadGroups()],
      ];
    }
    case "NoSession":
      // Nobody is signed in, so nobody's clubs belong on screen — a session
      // that expired must not leave the last reader's list behind.
      return [
        { ...model, session: AnonymousSession(), account: UnavailableAccount(), groups: [] },
        [],
      ];
    case "SpawnedToast":
      return withToast(model, message.toast);
    case "DismissedToast":
      return [{ ...model, toasts: model.toasts.filter((toast) => toast.id !== message.id) }, []];
    case "OpenedOverlay": {
      // A reopened modal starts over rather than showing whatever the last one
      // left behind; React gets that from remounting the component.
      const opened =
        message.overlay._tag === "LoginOverlay"
          ? { ...model, overlay: message.overlay, ...blankLogin }
          : { ...model, overlay: message.overlay };
      switch (message.overlay._tag) {
        case "SettingsOverlay": {
          const [next, commands] = updateSettingsSlice(opened, OpenedSettings());
          return [next, [LoadAccountSecurity(), ...commands]];
        }
        case "InviteOverlay":
          return updateInviteSlice(opened, OpenedInvite({ groupRef: message.overlay.groupRef }));
        case "UploadOverlay":
          return [{ ...opened, upload: initialUploadModel() }, []];
        case "PresenceOverlay": {
          const group = model.currentGroup;
          if (group === null) return [opened, []];
          // The people page nests the roster inside the invite controls, so both
          // are told the modal opened.
          const groupRef = groupUrlName(group);
          const [shown, presenceCommands] = updatePresenceSlice(
            opened,
            OpenedPresence({ groupRef }),
          );
          const [invited, inviteCommands] = updateInviteSlice(shown, OpenedInvite({ groupRef }));
          return [invited, [...presenceCommands, ...inviteCommands]];
        }
        default:
          return [opened, []];
      }
    }
    case "ClosedOverlay":
      return [{ ...model, overlay: NoOverlay() }, []];
    case "StartedRename":
      return [{ ...model, renamingTarget: message.target, renameDraft: message.value }, []];
    case "ChangedRenameDraft":
      return [{ ...model, renameDraft: message.value }, []];
    case "CancelledRename":
      return [{ ...model, renamingTarget: null, renameDraft: "" }, []];
    case "CommittedRename": {
      // An empty or unchanged name is not a rename; the field just closes.
      const title = model.renameDraft.trim();
      const unchanged = model.currentGroup === null || title === model.currentGroup.displayName;
      return [
        { ...model, renamingTarget: null, renameDraft: "" },
        title === "" || unchanged || model.currentGroup === null
          ? []
          : [RenameGroup({ groupRef: groupUrlName(model.currentGroup), title })],
      ];
    }
    case "SteppedExpandedPane":
      return [
        { ...model, expandedPane: stepExpandedPane(model.expandedPane, message.direction) },
        [],
      ];
    case "StartedSplitDrag":
      return [{ ...model, splitDragging: true }, []];
    case "MovedSplitDivider":
      return [{ ...model, splitShare: message.share }, []];
    case "EndedSplitDrag":
      // Dragging a pane most of the way out expands the other one outright,
      // which is the only way to reach the expanded states.
      return [
        {
          ...model,
          splitDragging: false,
          expandedPane:
            model.splitShare <= MIN_SPLIT_SHARE
              ? "right"
              : model.splitShare >= MAX_SPLIT_SHARE
                ? "left"
                : null,
        },
        [],
      ];
    case "ChangedOnline": {
      const online = { ...model, online: message.online };
      // Coming back is the moment everything held from cache is stale. React
      // refetched on reconnect; without it the app stays in whatever failed
      // state it landed in until the reader thinks to reload.
      if (!message.online) return [online, []];
      return [
        online,
        model.route._tag === "Club"
          ? [LoadSession(), LoadGroup({ groupRef: model.route.groupRef })]
          : [LoadSession()],
      ];
    }
    case "ResizedViewport":
      return [{ ...model, viewport: message.viewport }, []];
    case "Navigated":
      return navigateTo(model, message.route);
    case "ChangedLoginEmail":
      return [{ ...model, loginEmail: message.email }, []];
    case "ChangedLoginPassword":
      return [{ ...model, loginPassword: message.password }, []];
    case "ChangedLoginCode":
      return [{ ...model, loginCode: message.code }, []];
    case "SubmittedLogin":
      // A typed password is the shortcut; without one the server mails a code.
      // A wrong password does not lock anyone out — clearing it asks for a code.
      return [
        { ...model, loginBusy: true, loginError: null },
        [
          model.loginPassword === ""
            ? StartLogin({ email: model.loginEmail })
            : PasswordLogin({ email: model.loginEmail, password: model.loginPassword }),
        ],
      ];
    case "SubmittedLoginCode":
      return [
        { ...model, loginBusy: true, loginError: null },
        [VerifyLoginCode({ email: model.loginEmail, code: model.loginCode })],
      ];
    case "RequestedPasskeyLogin":
      return [
        { ...model, loginBusy: true, loginError: null },
        [PasskeyLogin({ email: model.loginEmail })],
      ];
    case "SentLoginCode":
      return [{ ...model, loginStep: "code", loginBusy: false }, []];
    case "FailedLogin":
      return [{ ...model, loginBusy: false, loginError: loginErrorMessage(message.error) }, []];
    case "DismissedLogin":
      return [{ ...model, overlay: NoOverlay(), ...blankLogin }, []];
    case "LoadedGroups":
      return [{ ...model, groups: message.groups }, []];
    case "FailedGroups":
      // The cached list is already on screen and is the best answer available,
      // so a refusal is only worth saying when there is nothing behind it.
      return model.groups.length > 0
        ? [model, []]
        : withToast(
            model,
            errorToast("Couldn't load your clubs", "You appear to be offline. Try again later."),
          );
    case "ChangedNewGroupName":
      return [{ ...model, newGroupName: message.name }, []];
    case "StartedCreatingClub":
      return [{ ...model, creatingClub: true, newGroupError: null }, []];
    case "CancelledCreatingClub":
      return [{ ...model, creatingClub: false, newGroupName: "", newGroupError: null }, []];
    case "SubmittedNewGroup":
      return model.newGroupPending
        ? [model, []]
        : [{ ...model, newGroupPending: true }, [CreateGroup({ displayName: model.newGroupName })]];
    case "FailedCreateGroup": {
      // React says it twice: inline under the field, and as a toast.
      const sentence = clubNameErrorMessage(message.error);
      return withToast(
        { ...model, newGroupPending: false, newGroupError: sentence },
        errorToast("Invalid club name", sentence),
      );
    }
    case "CreatedGroup":
      return [
        {
          ...model,
          groups: [
            ...model.groups.filter((group) => group.groupId !== message.group.groupId),
            message.group,
          ],
          newGroupName: "",
          creatingClub: false,
          newGroupPending: false,
          newGroupError: null,
          currentGroup: message.group,
        },
        [PushUrl({ href: hrefFor(Club({ groupRef: groupUrlName(message.group) })) })],
      ];
    case "JoinedGroup":
      // The token is spent; leaving it in the address bar would let the back
      // button and a copied link try to redeem it again. Dropping it is a URL
      // change, so the club reloads through the same path every arrival takes.
      return [
        { ...model, currentGroup: message.group },
        [ReplaceUrl({ href: hrefFor(Club({ groupRef: groupUrlName(message.group) })) })],
      ];
    case "LoadedGroup": {
      // An invite link is only spent once the club says this reader is not
      // already in it, which is the order React redeems in too.
      if (!message.membership.isMember && model.pendingInvite !== null) {
        return [
          { ...model, pendingInvite: null },
          [JoinGroup({ groupRef: groupUrlName(message.group), token: model.pendingInvite })],
        ];
      }
      const loaded = {
        ...model,
        pendingInvite: null,
        clubError: null,
        currentGroup: message.group,
        membership: message.membership,
        members: message.members,
      };
      // A club is its open book, so loading one asks which book this device
      // was last reading before deciding what the page shows.
      return [loaded, [RestoreSelectedSource({ groupId: message.group.groupId })]];
    }
    case "MissingGroup":
      return [{ ...model, clubError: "notfound", currentGroup: null, reader: null }, []];
    case "UnreachableGroup":
      return [{ ...model, clubError: "offline", currentGroup: null, reader: null }, []];
    case "RestoredSelectedSource": {
      const group = model.currentGroup;
      if (group === null) return [model, []];
      const stored =
        message.sourceId !== null && group.sources.includes(message.sourceId)
          ? message.sourceId
          : (group.sources[0] ?? null);
      const meta = stored === null ? undefined : group.sourceMeta[stored];
      const chosen = { ...model, selectedSourceId: stored };
      return stored === null || meta === undefined || model.reader?.sourceId === stored
        ? [chosen, []]
        : updateReaderSlice(
            chosen,
            SelectedReaderSource({
              groupRef: groupUrlName(group),
              sourceId: stored,
              kind: meta.kind,
            }),
          );
    }
    case "RememberedSelectedSource":
      return [model, []];
    case "SelectedBook": {
      const group = model.currentGroup;
      const meta = group?.sourceMeta[message.sourceId];
      if (group === undefined || group === null || meta === undefined) return [model, []];
      const [opened, commands] = updateReaderSlice(
        { ...model, selectedSourceId: message.sourceId },
        SelectedReaderSource({
          groupRef: groupUrlName(group),
          sourceId: message.sourceId,
          kind: meta.kind,
        }),
      );
      return [
        opened,
        [
          ...commands,
          RememberSelectedSource({ groupId: group.groupId, sourceId: message.sourceId }),
        ],
      ];
    }
    case "RequestedBookRename":
      return model.currentGroup === null
        ? [model, []]
        : [
            model,
            [
              RenameBook({
                groupRef: groupUrlName(model.currentGroup),
                sourceId: message.sourceId,
                title: message.title,
              }),
            ],
          ];
    case "RenamedBook":
      return [{ ...model, currentGroup: message.group }, []];
    case "LoadedAccountSecurity":
      return [
        { ...model, accountPasskeys: message.passkeys, hasPassword: message.hasPassword },
        [],
      ];
    case "LoadedInvite":
      return [{ ...model, inviteToken: message.token }, []];
    case "ChangedInviteToken":
      return [{ ...model, inviteToken: message.token }, []];
    case "ChangedJoinGroupRef":
      return [{ ...model, joinGroupRef: message.groupRef }, []];
    case "CompletedAccountAction":
      return withToast(
        { ...model, accountBusy: false, passkeyLabel: "", currentPassword: "", newPassword: "" },
        infoToast(message.title, message.message),
      );
    case "FailedAccountAction":
      return withToast(
        { ...model, accountBusy: false },
        errorToast("Account", accountErrorMessage(message.error)),
      );
    case "ChangedPasskeyLabel":
      return [{ ...model, passkeyLabel: message.label }, []];
    case "ChangedCurrentPassword":
      return [{ ...model, currentPassword: message.password }, []];
    case "ChangedNewPassword":
      return [{ ...model, newPassword: message.password }, []];
    case "SignedOut":
      return [
        {
          ...model,
          // Signing out leaves you on the clubs card as an anonymous reader,
          // not staring at the form you just left.
          session: AnonymousSession(),
          account: UnavailableAccount(),
          groups: [],
        },
        [PushUrl({ href: hrefFor(Home()) })],
      ];
    case "DeletedGroup":
      return [
        {
          ...model,
          groups: model.groups.filter((group) => group.groupId !== message.groupId),
          currentGroup: null,
          members: [],
          membership: null,
        },
        [PushUrl({ href: hrefFor(Home()) })],
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
    case "RequestedUrl":
      return [model, [PushUrl({ href: message.href })]];
    case "LeftForExternalUrl":
      return [model, [LoadExternalUrl({ href: message.href })]];
    case "LeftTheApp":
      return [model, []];
    case "FailedJoin":
      return withToast(model, errorToast("Invite failed", "That invite link isn't valid."));
    case "FailedClientCommand":
      return withToast(model, errorToast("Something went wrong", message.message));
    case "CompletedPasskeyRegistration":
      return message.error === null
        ? [model, []]
        : withToast(model, errorToast("Passkey failed", loginErrorMessage(message.error)));
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

const paneKeySubscriptions = Subscription.make<Model, Message>()((entry) => ({
  expandedPaneKeys: entry(
    { active: Schema.Boolean },
    {
      modelToDependencies: (model) => ({
        active:
          model.reader !== null && model.viewport === "wide" && model.overlay._tag === "NoOverlay",
      }),
      dependenciesToStream: ({ active }) =>
        Stream.when(
          Subscription.fromEventFilterMap<KeyboardEvent, Message>({
            target: globalThis.document,
            type: "keydown",
            toMessage: (event) => {
              if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
                return Option.none();
              }
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return Option.none();
              event.preventDefault();
              return Option.some(
                SteppedExpandedPane({ direction: event.key === "ArrowLeft" ? "left" : "right" }),
              );
            },
          }),
          Effect.sync(() => active),
        ),
    },
  ),
}));

const connectivitySubscriptions = Subscription.make<Model, Message>()((entry) => ({
  online: entry(
    {},
    {
      modelToDependencies: () => ({}),
      dependenciesToStream: () =>
        Stream.merge(
          Subscription.fromEvent<Event, Message>({
            target: globalThis.window,
            type: "online",
            toMessage: () => ChangedOnline({ online: true }),
          }),
          Subscription.fromEvent<Event, Message>({
            target: globalThis.window,
            type: "offline",
            toMessage: () => ChangedOnline({ online: false }),
          }),
        ),
    },
  ),
}));

const overlaySubscriptions = Subscription.make<Model, Message>()((entry) => ({
  overlayDismissal: entry(
    { open: Schema.Boolean },
    {
      modelToDependencies: (model) => ({ open: model.overlay._tag !== "NoOverlay" }),
      // React's modal closes on Escape and on a press outside its body; both
      // only exist while one is up.
      dependenciesToStream: ({ open }) =>
        Stream.when(
          Stream.merge(
            escapeKeyStream<Message>(ClosedOverlay()),
            pressOutsideModalStream<Message>(ClosedOverlay()),
          ),
          Effect.sync(() => open),
        ),
    },
  ),
}));

const splitSubscriptions = Subscription.make<Model, Message>()((entry) => ({
  splitDrag: entry(
    { dragging: Schema.Boolean },
    {
      // The divider's share follows the pointer against the layout's own box,
      // which is why the geometry is read here rather than carried in the Model.
      modelToDependencies: (model) => ({ dragging: model.splitDragging }),
      dependenciesToStream: ({ dragging }) =>
        Stream.when(
          Stream.merge(
            Subscription.fromEventFilterMap<PointerEvent, Message>({
              target: globalThis.window,
              type: "pointermove",
              toMessage: (event) => {
                const layout = globalThis.document?.querySelector(".workspace-layout");
                if (layout === null || layout === undefined) return Option.none();
                const box = layout.getBoundingClientRect();
                if (box.width === 0) return Option.none();
                const share = ((event.clientX - box.left) / box.width) * 100;
                return Option.some(MovedSplitDivider({ share: Math.min(100, Math.max(0, share)) }));
              },
            }),
            Subscription.fromEvent<PointerEvent, Message>({
              target: globalThis.window,
              type: "pointerup",
              toMessage: () => EndedSplitDrag(),
            }),
          ),
          Effect.sync(() => dragging),
        ),
    },
  ),
}));

const subscriptions = Subscription.aggregate<Model, Message, NoteAgentService>()(
  noteAgentSubscriptions,
  readerSubscriptions,
  viewportSubscriptions,
  connectivitySubscriptions,
  overlaySubscriptions,
  splitSubscriptions,
  paneKeySubscriptions,
);

const paneClass = (base: string, hidden: boolean): string =>
  hidden ? `${base} split-pane--hidden` : base;

const workspaceLayoutView = (
  model: Model,
  reader: ReaderWorkspace,
  groupRef: string,
  h: HtmlBuilder<Message>,
): Html => {
  const narrow = model.viewport === "narrow";
  const viewerId = model.session._tag === "AuthenticatedSession" ? model.session.user.id : "";
  const membersById = new Map(model.members.map((member) => [member.id, member]));
  const prefs = settingsPrefs(model.settings);
  const notes = notesView(
    model.notes,
    {
      sourceId: reader.sourceId,
      groupRef,
      jumpToHighlight: (anchor) => JumpedToHighlight({ anchor }),
      viewer: { userId: viewerId, isOwner: model.currentGroup?.ownerId === viewerId },
      canWrite: model.membership?.isMember === true,
      // Avatars are a preference; without the resolver the panel falls through
      // to React's avatar-less markup, which is what turning them off means.
      avatarFor: prefs.notes.showAvatars
        ? (author) => {
            const member = membersById.get(author.id);
            return {
              url:
                member?.avatarImageId === undefined
                  ? null
                  : avatarImagePath(author.id, member.avatarImageId),
              initials: avatarInitial(author.name),
              name: author.name,
            };
          }
        : undefined,
      bookTitles: new Map(
        (model.currentGroup?.sources ?? []).map((id) => [
          id,
          model.currentGroup?.bookTitles[id] ??
            model.currentGroup?.sourceMeta[id]?.title ??
            "Untitled book",
        ]),
      ),
    },
    h,
  );
  // An expanded pane is a share of 100 or 0; mid-drag the panes both stay
  // rendered so the one being uncovered is already there when the press ends.
  const share =
    model.expandedPane === "left" ? 100 : model.expandedPane === "right" ? 0 : model.splitShare;
  const hideReader = !model.splitDragging && model.expandedPane === "right";
  const hideNotes = !model.splitDragging && model.expandedPane === "left";
  const track = h.div(
    [
      h.Class(narrow ? "workspace-layout-track pager-track" : "workspace-layout-track"),
      ...(narrow && reader.pane === "notes" ? [h.Style({ transform: "translateX(-100%)" })] : []),
    ],
    [
      h.div(
        [
          h.Key("reader"),
          h.Class(narrow ? "pager-page" : paneClass("split-pane", hideReader)),
          ...(narrow ? [] : [h.Style({ width: `${share}%` }), h.AriaHidden(hideReader)]),
        ],
        [
          readerView(
            reader,
            {
              books: model.currentGroup === null ? [] : books(model.currentGroup),
              title: model.currentGroup?.bookTitles[reader.sourceId] ?? null,
              onSelectBook: (sourceId) => SelectedBook({ sourceId }),
              // Renaming a book is a permission, not a decoration.
              onRenameBook: permits(model.membership?.role ?? "visitor", GroupAction.RenameBook)
                ? (sourceId, title) => RequestedBookRename({ sourceId, title })
                : null,
              onAddBook: OpenedOverlay({ overlay: UploadOverlay() }),
            },
            h,
          ),
        ],
      ),
      ...(narrow
        ? []
        : [
            h.div(
              [
                h.Key("divider"),
                h.Class("split-divider"),
                h.OnPointerDown(() => Option.some(StartedSplitDrag())),
              ],
              [],
            ),
          ]),
      h.div(
        [
          h.Key("notes"),
          h.Class(narrow ? "pager-page" : paneClass("split-pane split-pane--grow", hideNotes)),
          ...(narrow ? [] : [h.AriaHidden(hideNotes)]),
        ],
        [notes],
      ),
    ],
  );
  if (!narrow) {
    const expanded = model.expandedPane === null ? "" : ` split--expanded-${model.expandedPane}`;
    return h.div(
      [
        h.Class(
          `workspace-layout ${model.splitDragging ? "split is-dragging" : "split"}${expanded}`,
        ),
      ],
      [
        track,
        // A transparent sheet over both panes for the length of the drag, so a
        // press that starts on the divider cannot be stolen by the book.
        ...(model.splitDragging ? [h.div([h.Class("split-overlay")], [])] : []),
      ],
    );
  }
  return h.div(
    [h.Class("workspace-layout pager")],
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

/** Whatever overlay is up, over whichever page is showing. Each module owns its
 *  own markup; the host owns only which one is on screen. */
export const overlayView = (model: Model, h: HtmlBuilder<Message>): Html[] => {
  switch (model.overlay._tag) {
    case "LoginOverlay":
      return [loginModalView(model, h)];
    case "InfoOverlay":
      return [infoView(model.info, { onClose: ClosedOverlay() }, h)];
    case "SettingsOverlay":
      return [
        settingsView(
          model.settings,
          {
            book: model.currentGroup === null ? null : settingsBook(model, model.currentGroup),
            signedIn: model.session._tag === "AuthenticatedSession",
            onClose: ClosedOverlay(),
            accountSection: accountSectionView(model, h),
          },
          h,
        ),
      ];
    case "UploadOverlay":
      return model.currentGroup === null
        ? []
        : [uploadView(model.upload, { group: model.currentGroup, onClose: ClosedOverlay() }, h)];
    case "PresenceOverlay": {
      const group = model.currentGroup;
      if (group === null) return [];
      const roster = {
        members: model.members,
        peers: model.notes.peers,
        viewerRole: model.membership?.role ?? "visitor",
      };
      return [
        presenceView(
          model.presence,
          {
            group,
            ...roster,
            viewerId: model.session._tag === "AuthenticatedSession" ? model.session.user.id : "",
            onClose: ClosedOverlay(),
            // React nests the roster inside the invite controls and puts the
            // backup controls at the head of the books page.
            inviteControls: inviteControlsView(
              model.invite,
              { group, children: [presencePeopleView(model.presence, roster, h)] },
              h,
            ),
            backupControls: [backupControlsView(model.settings, group, h)],
          },
          h,
        ),
      ];
    }
    case "InviteOverlay": {
      const overlay = model.overlay;
      const group = model.groups.find((candidate) => groupUrlName(candidate) === overlay.groupRef);
      return group === undefined
        ? []
        : [inviteView(model.invite, { group, onClose: ClosedOverlay() }, h)];
    }
    default:
      return [];
  }
};

/** The club's own profile for the settings modal: who the reader is inside this
 *  club, which is a roster entry rather than the account. */
const settingsBook = (model: Model, group: GroupSummary) => {
  const viewerId = model.session._tag === "AuthenticatedSession" ? model.session.user.id : "";
  const me = model.members.find((member) => member.id === viewerId);
  const profile =
    me?.avatarImageId === undefined
      ? { id: viewerId, displayName: me?.name ?? "You" }
      : { id: viewerId, displayName: me.name, avatarImageId: me.avatarImageId };
  return { groupId: group.groupId, slug: group.slug, publicId: group.publicId, profile };
};

/** React's `RenamableText`: a double-click turns the text into a field that
 *  saves on blur or Enter and abandons on Escape. */
const renamableTitle = (
  model: Model,
  target: string,
  value: string,
  h: HtmlBuilder<Message>,
): Html =>
  model.renamingTarget === target
    ? h.input([
        h.Class("topbar-title-edit"),
        h.Autofocus(true),
        h.AriaLabel("club name"),
        h.Value(model.renameDraft),
        h.OnInput((next) => ChangedRenameDraft({ value: next })),
        h.OnBlur(CommittedRename()),
        h.OnKeyDownPreventDefault((key) =>
          key === "Enter"
            ? Option.some(CommittedRename())
            : key === "Escape"
              ? Option.some(CancelledRename())
              : Option.none(),
        ),
      ])
    : h.h1(
        [
          h.Title("Double-click to rename the club"),
          h.OnDoubleClick(StartedRename({ target, value })),
        ],
        [value],
      );

export const workspaceHeaderView = (
  model: Model,
  displayName: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.header(
    [h.Class("topbar")],
    [
      h.a(
        [h.Class("topbar-home"), h.Href(hrefFor(Home())), h.AriaLabel("back to your clubs")],
        ["\u2039"],
      ),
      renamableTitle(model, "club", displayName, h),
      presenceIndicatorView(
        model.notes.peers.length,
        OpenedOverlay({ overlay: PresenceOverlay() }),
        h,
      ),
      h.button(
        [
          h.Type("button"),
          h.Class("settings-button icon-button"),
          h.AriaLabel("settings"),
          h.Title("Settings"),
          h.OnClick(OpenedOverlay({ overlay: SettingsOverlay() })),
        ],
        [h.img([h.Src(settingsIcon), h.Alt(""), h.AriaHidden(true)])],
      ),
      h.button(
        [
          h.Type("button"),
          h.Class("workspace-info-button"),
          h.AriaLabel("open info"),
          h.Title("About & release log"),
          h.OnClick(OpenedOverlay({ overlay: InfoOverlay() })),
        ],
        ["i"],
      ),
    ],
  );

/** The club, open on its book: React's `.app` shell, its header, and the split.
 *  Chrome hiding is a class on the shell, which is what the CSS keys off. */
const workspaceView = (
  model: Model,
  reader: ReaderWorkspace,
  groupRef: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class(reader.chromeLevel >= 1 ? "app app--chrome-hidden" : "app")],
    [
      workspaceHeaderView(model, model.currentGroup?.displayName ?? "Bookclub", h),
      workspaceLayoutView(model, reader, groupRef, h),
      ...overlayView(model, h),
    ],
  );

/** The card the whole signed-out and club-picking experience sits on. React's
 *  `home.css` draws its stacked border, its centre rule, and its bookmark. */
const homeCard = (h: HtmlBuilder<Message>, children: Html[], overlay: Html[] = []): Html =>
  h.div([h.Class("home")], [h.div([h.Class("home-card")], children), ...overlay]);

/** The card's top-left corner: the way into settings and into the info screen. */
const homeTopButtons = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class("home-top-buttons")],
    [
      ...(model.session._tag === "AuthenticatedSession"
        ? [
            h.button(
              [
                h.Type("button"),
                h.Class("home-settings-button icon-button"),
                h.AriaLabel("settings"),
                h.Title("Settings"),
                h.OnClick(OpenedOverlay({ overlay: SettingsOverlay() })),
              ],
              [h.img([h.Src(settingsIcon), h.Alt(""), h.AriaHidden(true)])],
            ),
          ]
        : []),
      h.button(
        [
          h.Type("button"),
          h.Class("home-info-button"),
          h.AriaLabel("open info"),
          h.Title("About & release log"),
          h.OnClick(OpenedOverlay({ overlay: InfoOverlay() })),
        ],
        ["i"],
      ),
    ],
  );

/** The card's top-right corner: who you are, or the way in. */
const loginCorner = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class("home-corner home-corner--login")],
    model.session._tag === "AuthenticatedSession"
      ? [
          h.div(
            [h.Class("login login--authed")],
            [
              h.span([h.Class("login-email")], [model.session.user.email]),
              h.button(
                [
                  h.Type("button"),
                  h.Class("login-link plain-button"),
                  h.Title("Sign out"),
                  h.OnClick(RequestedSignOut()),
                ],
                ["sign out"],
              ),
            ],
          ),
        ]
      : [
          h.button(
            [
              h.Type("button"),
              h.Class("login-signin"),
              h.Title("Sign in"),
              h.OnClick(OpenedOverlay({ overlay: LoginOverlay() })),
            ],
            ["sign in"],
          ),
        ],
  );

const backToClubs = (h: HtmlBuilder<Message>): Html =>
  h.a(
    [h.Class("home-back"), h.Href(hrefFor(Home())), h.AriaLabel("back to your clubs")],
    ["\u2039"],
  );

const clubList = (model: Model, h: HtmlBuilder<Message>): Html =>
  model.session._tag !== "AuthenticatedSession"
    ? h.span([h.Class("home-existing-label")], ["sign in to see your clubs"])
    : model.groups.length === 0
      ? h.span([h.Class("home-existing-label")], ["no clubs yet \u2014 create one above"])
      : h.ul(
          [h.Class("home-club-list")],
          model.groups.map((group) =>
            h.li(
              [h.Key(group.groupId)],
              [
                h.a(
                  [h.Href(hrefFor(Club({ groupRef: groupUrlName(group) })))],
                  [group.displayName],
                ),
                h.button(
                  [
                    h.Type("button"),
                    h.Class("login-link plain-button"),
                    h.Title("Invite people"),
                    h.OnClick(
                      OpenedOverlay({
                        overlay: InviteOverlay({
                          groupRef: groupUrlName(group),
                          displayName: group.displayName,
                        }),
                      }),
                    ),
                  ],
                  ["invite"],
                ),
              ],
            ),
          ),
        );

const homeView = (model: Model, h: HtmlBuilder<Message>, overlay: Html[] = []): Html =>
  homeCard(
    h,
    [
      homeTopButtons(model, h),
      loginCorner(model, h),
      h.div(
        [h.Class("home-main")],
        [
          h.h1([h.Class("home-title")], ["Bookclub"]),
          ...(model.session._tag !== "AuthenticatedSession"
            ? []
            : model.creatingClub
              ? [
                  h.form(
                    [h.Class("home-create"), h.OnSubmit(SubmittedNewGroup())],
                    [
                      h.input([
                        h.Type("text"),
                        h.AriaLabel("Club name"),
                        h.Placeholder("club name"),
                        h.Value(model.newGroupName),
                        h.OnInput((name) => ChangedNewGroupName({ name })),
                        h.OnKeyDownPreventDefault((key) =>
                          key === "Escape" ? Option.some(CancelledCreatingClub()) : Option.none(),
                        ),
                      ]),
                      h.button(
                        [
                          h.Type("submit"),
                          h.Class("home-create-confirm"),
                          h.AriaLabel("create"),
                          h.Title("Create club"),
                          h.Disabled(model.newGroupName === "" || model.newGroupPending),
                        ],
                        ["+"],
                      ),
                    ],
                  ),
                ]
              : [
                  h.button(
                    [
                      h.Type("button"),
                      h.Class("home-action"),
                      h.Title("Create a new bookclub"),
                      h.OnClick(StartedCreatingClub()),
                    ],
                    ["create a new bookclub"],
                  ),
                ]),
          ...(model.newGroupError === null
            ? []
            : [h.p([h.Class("login-error")], [model.newGroupError])]),
          h.div([h.Class("home-clubs")], [clubList(model, h)]),
        ],
      ),
      h.div([h.Class("home-corner home-corner--credit")], ["a project by Byron Li"]),
    ],
    overlay,
  );

/** Signing in is a modal over whatever page is showing, the way React presents
 *  it, rather than a page of its own. */
export const loginModalView = (model: Model, h: HtmlBuilder<Message>): Html =>
  modalView({ title: "sign in", onClose: DismissedLogin() }, h, [
    h.div([h.Class("modal-body")], loginBody(model, h)),
  ]);

const loginBody = (model: Model, h: HtmlBuilder<Message>): Html[] => [
  ...(model.loginStep === "done"
    ? [h.p([h.Class("modal-success")], ["\u2713 Sign in successful"])]
    : model.loginStep === "email"
      ? [loginEmailForm(model, h)]
      : [loginCodeForm(model, h)]),
  ...(model.loginError === null ? [] : [h.p([h.Class("login-error")], [model.loginError])]),
];

const loginEmailForm = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.form(
    [h.OnSubmit(SubmittedLogin())],
    [
      h.input([
        h.Id("login-email"),
        h.Type("email"),
        // `webauthn` is what offers a passkey from the browser's own autofill.
        h.Autocomplete("username webauthn"),
        h.AriaLabel("Email address"),
        h.Placeholder("you@example.com"),
        h.Value(model.loginEmail),
        h.OnInput((email) => ChangedLoginEmail({ email })),
      ]),
      h.input([
        h.Id("login-password"),
        h.Type("password"),
        h.Autocomplete("current-password"),
        h.AriaLabel("Password (optional)"),
        h.Placeholder("password (optional)"),
        h.Value(model.loginPassword),
        h.OnInput((password) => ChangedLoginPassword({ password })),
      ]),
      h.button(
        [
          h.Type("submit"),
          h.Class("primary"),
          h.Title(model.loginPassword === "" ? "Send a sign-in code" : "Sign in with password"),
          h.Disabled(model.loginBusy || model.loginEmail === ""),
        ],
        [model.loginPassword === "" ? "send code" : "sign in"],
      ),
      ...(model.passkeysAvailable
        ? [
            h.button(
              [
                h.Type("button"),
                h.Class("login-passkey plain-button"),
                h.Title("Sign in with a passkey"),
                h.Disabled(model.loginBusy || model.loginEmail === ""),
                h.OnClick(RequestedPasskeyLogin()),
              ],
              ["use a passkey"],
            ),
          ]
        : []),
    ],
  );

const loginCodeForm = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.form(
    [h.OnSubmit(SubmittedLoginCode())],
    [
      h.p([h.Class("modal-note")], [`Enter the code we sent to ${model.loginEmail}.`]),
      h.input([
        h.Id("login-code"),
        h.Type("text"),
        h.InputMode("numeric"),
        h.AriaLabel("Verification code"),
        h.Placeholder("6-digit code"),
        h.Value(model.loginCode),
        h.OnInput((code) => ChangedLoginCode({ code })),
      ]),
      h.button(
        [
          h.Type("submit"),
          h.Class("primary"),
          h.Title("Verify code"),
          h.Disabled(model.loginBusy || model.loginCode === ""),
        ],
        ["verify"],
      ),
    ],
  );

/** React's `AccountSettings`, which is a page of the settings modal rather than
 *  a screen of its own. */
export const accountSectionView = (model: Model, h: HtmlBuilder<Message>): Html[] => [
  h.section(
    [h.Class("settings-item settings-item--stacked")],
    [
      h.div(
        [h.Class("settings-item-text")],
        [
          h.h2([h.Class("settings-item-head")], ["Passkeys"]),
          h.p(
            [h.Class("settings-item-desc")],
            ["Sign in with Face ID, Touch ID, or a security key."],
          ),
        ],
      ),
      ...(model.passkeysAvailable
        ? [
            ...(model.accountPasskeys.length === 0
              ? []
              : [
                  h.ul(
                    [h.Class("account-passkey-list")],
                    model.accountPasskeys.map((passkey) =>
                      h.li(
                        [h.Key(passkey.id), h.Class("account-passkey")],
                        [
                          h.span([h.Class("account-passkey-label truncate")], [passkey.label]),
                          h.button(
                            [
                              h.Type("button"),
                              h.Class("login-link plain-button"),
                              h.Title("Remove this passkey"),
                              h.OnClick(RequestedRemovePasskey({ id: passkey.id })),
                            ],
                            ["remove"],
                          ),
                        ],
                      ),
                    ),
                  ),
                ]),
            h.div(
              [h.Class("account-passkey-add")],
              [
                h.input([
                  h.Type("text"),
                  h.AriaLabel("Passkey name"),
                  h.Placeholder("passkey name (optional)"),
                  h.Value(model.passkeyLabel),
                  h.OnInput((label) => ChangedPasskeyLabel({ label })),
                ]),
                h.button(
                  [
                    h.Type("button"),
                    h.Class("settings-action"),
                    h.Title("Add a passkey"),
                    h.Disabled(model.accountBusy),
                    h.OnClick(
                      RequestedPasskeyRegistration({
                        label: model.passkeyLabel.trim() === "" ? "Passkey" : model.passkeyLabel,
                      }),
                    ),
                  ],
                  ["add passkey"],
                ),
              ],
            ),
          ]
        : [h.p([h.Class("settings-item-desc")], ["This browser doesn't support passkeys."])]),
    ],
  ),
  h.section(
    [h.Class("settings-item settings-item--stacked")],
    [
      h.div([h.Class("settings-item-text")], [h.h2([h.Class("settings-item-head")], ["Password"])]),
      h.form(
        [
          h.Class("account-password-form"),
          h.OnSubmit(
            RequestedSetPassword(
              model.hasPassword
                ? { password: model.newPassword, currentPassword: model.currentPassword }
                : { password: model.newPassword },
            ),
          ),
        ],
        [
          ...(model.hasPassword
            ? [
                h.input([
                  h.Type("password"),
                  h.Autocomplete("current-password"),
                  h.AriaLabel("Current password"),
                  h.Placeholder("current password"),
                  h.Value(model.currentPassword),
                  h.OnInput((password) => ChangedCurrentPassword({ password })),
                ]),
              ]
            : []),
          h.input([
            h.Type("password"),
            h.Autocomplete("new-password"),
            h.AriaLabel("New password"),
            h.Placeholder(model.hasPassword ? "new password" : "password"),
            h.Value(model.newPassword),
            h.OnInput((password) => ChangedNewPassword({ password })),
          ]),
          h.button(
            [
              h.Type("submit"),
              h.Class("settings-action"),
              h.Title(model.hasPassword ? "Change password" : "Set password"),
              h.Disabled(
                model.accountBusy ||
                  model.newPassword === "" ||
                  (model.hasPassword && model.currentPassword === ""),
              ),
            ],
            [model.hasPassword ? "change" : "set password"],
          ),
          ...(model.hasPassword
            ? [
                h.button(
                  [
                    h.Type("button"),
                    h.Class("login-link plain-button"),
                    h.Title("Remove password"),
                    h.Disabled(model.accountBusy || model.currentPassword === ""),
                    h.OnClick(RequestedRemovePassword({ currentPassword: model.currentPassword })),
                  ],
                  ["remove"],
                ),
              ]
            : []),
        ],
      ),
    ],
  ),
];

/** A club that cannot be shown, on the same card the clubs list lives on. */
const clubMessageView = (h: HtmlBuilder<Message>, title: string, body: string): Html =>
  homeCard(h, [
    backToClubs(h),
    h.div([h.Class("home-main")], [h.h1([h.Class("home-title")], [title]), h.p([], [body])]),
  ]);

/** A club with no book yet: the one place a book gets added from. */
const noBookView = (model: Model, group: GroupSummary, h: HtmlBuilder<Message>): Html =>
  homeCard(
    h,
    [
      backToClubs(h),
      h.div(
        [h.Class("home-main")],
        [
          h.h1([h.Class("home-title")], [group.displayName]),
          h.button(
            [
              h.Type("button"),
              h.Class("home-upload-link plain-button"),
              h.Title("Upload a book or PDF"),
              h.OnClick(OpenedOverlay({ overlay: UploadOverlay() })),
            ],
            ["upload the club's book or PDF"],
          ),
        ],
      ),
    ],
    overlayView(model, h),
  );

/** The chrome a club wears while it is still resolving, so the page does not
 *  jump when the book arrives. */
const workspaceLoadingView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class("app")],
    [
      h.header(
        [h.Class("topbar")],
        [
          h.a(
            [h.Class("topbar-home"), h.Href(hrefFor(Home())), h.AriaLabel("back to your clubs")],
            ["\u2039"],
          ),
          h.span(
            [h.Class("presence-indicator"), h.AriaHidden(true)],
            [h.span([h.Class("presence-count")], ["0"]), h.span([h.Class("presence-dot")], [])],
          ),
        ],
      ),
      h.div(
        [
          h.Class(
            model.viewport === "narrow" ? "workspace-layout pager" : "workspace-layout split",
          ),
        ],
        [
          h.div(
            [h.Class("workspace-layout-track")],
            [
              h.div(
                [h.Class(model.viewport === "narrow" ? "pager-page" : "split-pane")],
                [
                  h.div(
                    [h.Class("reader")],
                    [
                      h.div(
                        [h.Class("reader-bar")],
                        [h.span([h.Class("reader-title")], []), h.span([h.Class("spacer")], [])],
                      ),
                      h.div(
                        [h.Class("reader-stage")],
                        [h.div([h.Class("reader-surface")], [loadingView(h, "loading--reader")])],
                      ),
                    ],
                  ),
                ],
              ),
              h.div(
                [
                  h.Class(
                    model.viewport === "narrow" ? "pager-page" : "split-pane split-pane--grow",
                  ),
                ],
                [
                  h.aside(
                    [h.Class("note-panel")],
                    [h.h2([], ["Notes"]), loadingView(h, "loading--note-panel")],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  );

/** A club, in whichever of React's states it is in: still resolving, closed to
 *  you, empty, or open on its book. */
const clubPageView = (model: Model, groupRef: string, h: HtmlBuilder<Message>): Html => {
  if (model.session._tag === "AnonymousSession") {
    return homeCard(
      h,
      [
        loginCorner(model, h),
        h.div(
          [h.Class("home-main")],
          [h.h1([h.Class("home-title")], ["Bookclub"]), h.p([], ["Sign in to open this club."])],
        ),
      ],
      [loginModalView(model, h)],
    );
  }
  // A club that cannot be opened says so. Without these the page spins forever
  // behind a toast, which is what a reader sees as the app being broken.
  if (model.clubError === "notfound") {
    return clubMessageView(h, "No such club", `"${groupRef}" doesn't exist.`);
  }
  if (model.clubError === "offline") {
    return clubMessageView(
      h,
      "You're offline",
      "Can't reach the server, and this club isn't cached on this device yet. Reconnect and try again.",
    );
  }
  const group = model.currentGroup;
  if (group === null || group.publicId !== groupRef.slice(groupRef.lastIndexOf("-") + 1)) {
    return workspaceLoadingView(model, h);
  }
  if (model.membership !== null && !model.membership.isMember) {
    return clubMessageView(h, "Members only", "You need an invite to join this club.");
  }
  if (group.sources.length === 0) return noBookView(model, group, h);
  return model.reader === null
    ? workspaceLoadingView(model, h)
    : workspaceView(model, model.reader, groupRef, h);
};

/** The page for a route, with whatever overlay is up over it. */
const pageView = (model: Model, h: HtmlBuilder<Message>): Html => {
  switch (model.route._tag) {
    case "Club":
      return clubPageView(model, model.route.groupRef, h);
    default:
      return homeView(model, h, overlayView(model, h));
  }
};

/** React's `ToastViewport`: newest first, each dismissable, each carrying the
 *  dwell time the stylesheet animates against. */
const toastViewportView = (model: Model, h: HtmlBuilder<Message>): Html[] =>
  model.toasts.length === 0
    ? []
    : [
        h.div(
          [h.Class("toast-viewport"), h.AriaLive("polite"), h.AriaAtomic(false)],
          model.toasts.map((toast) =>
            h.div(
              [
                h.Key(toast.id),
                h.Class(`toast toast--${toast.type}`),
                h.Style({ "--toast-duration": `${toast.durationMs}ms` }),
              ],
              [
                h.div(
                  [h.Class("toast-head")],
                  [
                    h.strong([], [toast.title]),
                    h.button(
                      [
                        h.Type("button"),
                        h.AriaLabel("dismiss toast"),
                        h.Title("Dismiss"),
                        h.OnClick(DismissedToast({ id: toast.id })),
                      ],
                      ["x"],
                    ),
                  ],
                ),
                h.div(
                  [h.Class("toast-body")],
                  [
                    h.p([], [toast.message]),
                    ...(toast.action === null
                      ? []
                      : [h.a([h.Href(toast.action.href)], [toast.action.label])]),
                  ],
                ),
              ],
            ),
          ),
        ),
      ];

/** Reassurance that reading and note-taking keep working with no connection. */
const offlineBannerView = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class("offline-banner"), h.Role("status"), h.AriaLive("polite")],
    ["You're offline — you can keep reading and taking notes; changes sync when you reconnect."],
  );

/**
 * React's `App`: a banner, the route, and the toasts. The page owns its own
 * full-screen chrome — the workspace renders `.app` and the card pages render
 * `.home` — so the shell adds none of its own.
 */
export const shellView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class("foldkit-root")],
    [
      ...(model.online ? [] : [offlineBannerView(h)]),
      pageView(model, h),
      ...toastViewportView(model, h),
    ],
  );

/**
 * A link to somewhere in the app pushes its URL and nothing more; the route
 * change comes back through `onUrlChange`. Keeping that one way round is what
 * makes the address bar and the Model incapable of disagreeing — every route
 * change in the app, clicked or programmatic, arrives as a URL first.
 */
export const onUrlRequest = (request: Navigation.UrlRequest): Message =>
  request._tag === "Internal"
    ? RequestedUrl({ href: Url.toString(request.url) })
    : LeftForExternalUrl({ href: request.href });

export const makeBookclubApplication = (container: HTMLElement) => {
  container.id = FOLDKIT_RUNTIME_ID;
  return Runtime.makeApplication<Model, Message, never, NoteAgentService>({
    Model,
    container,
    routing: { onUrlRequest, onUrlChange: (url) => Navigated({ route: routeOf(url) }) },
    init: initFromUrl,
    update,
    managedResources: noteAgentResources,
    subscriptions,
    view: (model, h) => ({ title: "Bookclub", body: shellView(model, h) }),
    devTools: false,
  });
};
