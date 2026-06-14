import { Route, Switch } from "wouter";
import { useSession } from "../auth/useSession.ts";
import { GroupView } from "../ui/group/GroupView.tsx";
import { Home } from "../ui/home/Home.tsx";
import { ToastViewport } from "../ui/shared/toast/ToastViewport.tsx";

// Phase B root: `/` is the group home; `/:name` is a group's reader workspace
// (members only). Session state is hydrated once and threaded into both routes.
export default function App() {
  const session = useSession();
  return (
    <>
      {session.status === "loading" ? (
        <div className="home-loading">loading…</div>
      ) : (
        <Switch>
          <Route path="/">{() => <Home session={session} />}</Route>
          <Route path="/:name">
            {(params) => <GroupView name={params.name} session={session} />}
          </Route>
        </Switch>
      )}
      <ToastViewport />
    </>
  );
}
