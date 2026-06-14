import { useSession } from "./auth/useSession.ts";
import { Home } from "./ui/Home.tsx";
import { ToastViewport } from "./ui/toast.tsx";

// Phase A root: the home page with email sign-in. The reader workspace lives in
// Workspace.tsx and becomes reachable once Phase B adds group routing.
export default function App() {
  const session = useSession();
  return (
    <>
      {session.status === "loading" ? (
        <div className="home-loading">loading…</div>
      ) : (
        <Home session={session} />
      )}
      <ToastViewport />
    </>
  );
}
