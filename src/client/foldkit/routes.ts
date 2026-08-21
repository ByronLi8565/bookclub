import { pipe, Schema } from "effect";
import { Route } from "foldkit";
import type { Url } from "foldkit/url";

/**
 * The application's two URLs, as React serves them: the clubs card at `/` and a
 * club's workspace at `/clubs/:groupRef`. A club URL may carry `?invite=<token>`
 * — that is the link the invite modal hands out, and the only way a reader who
 * is not yet a member gets in.
 */
export const Home = Route.r("Home");
export const Club = Route.r("Club", {
  groupRef: Schema.String,
  invite: Schema.optionalKey(Schema.String),
});

export const AppRoute = Schema.Union([Home, Club]);
export type AppRoute = typeof AppRoute.Type;

const homeRouter = pipe(Route.root, Route.mapTo(Home));

const clubRouter = pipe(
  Route.literal("clubs"),
  Route.slash(Route.string("groupRef")),
  Route.query(Schema.Struct({ invite: Schema.optionalKey(Schema.String) })),
  Route.mapTo(Club),
);

/**
 * A URL the app does not serve lands on the clubs card. React renders nothing at
 * all for one — `Switch` with no matching `Route` — which reads as a broken
 * page; this is the one place the Foldkit client deliberately does better.
 */
export const routeOf: (url: Url) => AppRoute = Route.parseUrlWithFallback(
  Route.oneOf(homeRouter, clubRouter),
  { make: (_notFound: { path: string }) => Home() },
);

/** The `href` a route is reached by, so links are written once and the runtime's
 *  own click handling does the navigating. */
export const hrefFor = (route: AppRoute): string =>
  route._tag === "Home" ? homeRouter() : clubRouter({ groupRef: route.groupRef });
