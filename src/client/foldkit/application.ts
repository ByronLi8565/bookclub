import { Schema } from "effect";
import { Runtime } from "foldkit";
import { m } from "foldkit/message";
import { r } from "foldkit/route";
import { ts } from "foldkit/schema";

export const FOLDKIT_RUNTIME_ID = "bookclub-foldkit";

export const Home = r("Home");
export const Login = r("Login");
export const AccountSettings = r("AccountSettings");
export const Route = Schema.Union([Home, Login, AccountSettings]);
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

export const ErrorToast = Schema.Struct({ message: Schema.String });
export type ErrorToast = typeof ErrorToast.Type;

export const Model = Schema.Struct({
  route: Route,
  session: Session,
  account: Account,
  errorToast: Schema.NullOr(ErrorToast),
});
export type Model = typeof Model.Type;

export const LoadedSession = m("LoadedSession", { user: SessionUser });
export const FailedSession = m("FailedSession", { message: Schema.String });
export const DismissedErrorToast = m("DismissedErrorToast");
export type Message =
  | typeof LoadedSession.Type
  | typeof FailedSession.Type
  | typeof DismissedErrorToast.Type;

export const init = (): readonly [Model, []] => [
  { route: Home(), session: LoadingSession(), account: UnavailableAccount(), errorToast: null },
  [],
];

export const update = (model: Model, message: Message): readonly [Model, []] => {
  switch (message._tag) {
    case "LoadedSession":
      return [
        {
          ...model,
          session: AuthenticatedSession({ user: message.user }),
          account: ReadyAccount({ user: message.user }),
        },
        [],
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
  }
};

export const makeBookclubApplication = (container: HTMLElement) => {
  container.id = FOLDKIT_RUNTIME_ID;
  return Runtime.makeApplication<Model, Message>({
    Model,
    container,
    init,
    update,
    view: (model, h) => ({
      title: "Bookclub",
      body: h.main(
        [],
        [
          h.h1([], ["Bookclub"]),
          h.p([], [model.session._tag]),
          ...(model.errorToast === null ? [] : [h.p([], [model.errorToast.message])]),
        ],
      ),
    }),
    devTools: false,
  });
};
