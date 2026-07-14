import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { useEffect } from "react";
import { Route, Switch } from "wouter";
import { useSession } from "./useSession.ts";
import { hydrateUserPrefs } from "../logic/settings/userPrefs.ts";
import { GroupView } from "../ui/group/GroupView.tsx";
import { Home } from "../ui/home/Home.tsx";
import { OfflineBanner } from "../ui/shared/OfflineBanner.tsx";
import { ToastViewport } from "../ui/shared/toast/ToastViewport.tsx";

export default function App() {
  const session = useSession();
  useEffect(() => {
    if (session.status !== "authed") return;
    const fiber = Effect.runFork(hydrateUserPrefs());
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [session.status]);
  return (
    <>
      <OfflineBanner />
      <Switch>
        <Route path="/">{() => <Home session={session} />}</Route>
        <Route path="/clubs/:groupRef">
          {(params) => <GroupView groupRef={params.groupRef} session={session} />}
        </Route>
      </Switch>
      <ToastViewport />
    </>
  );
}
