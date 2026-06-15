import { Route, Switch } from "wouter";
import { useSession } from "../auth/useSession.ts";
import { GroupView } from "../ui/group/GroupView.tsx";
import { Home } from "../ui/home/Home.tsx";
import { Loading } from "../ui/shared/Loading.tsx";
import { ToastViewport } from "../ui/shared/toast/ToastViewport.tsx";


export default function App() {
  const session = useSession();
  return (
    <>
      {session.status === "loading" ? (
        <Loading className="loading--app" />
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
