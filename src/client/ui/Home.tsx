import { useState } from "react";
import type { Session } from "../auth/useSession.ts";
import { Login, LoginModal } from "./Login.tsx";

// The landing page (future `/` route). Sign-in lives in the top-right; the
// create / existing-club actions are placeholders until Phase B wires groups.
// The login modal is owned here so both the top-right link and the existing-club
// prompt can open it.
export function Home({ session }: { session: Session }): React.ReactElement {
  const authed = session.status === "authed";
  const [loginOpen, setLoginOpen] = useState(false);
  const openLogin = () => setLoginOpen(true);

  return (
    <div className="home">
      <div className="home-card">
        <div className="home-corner home-corner--login">
          <Login session={session} onSignIn={openLogin} />
        </div>

        <div className="home-main">
          <h1 className="home-title">Bookclub</h1>
          {/* Placeholders: no functionality until Phase B (groups + routing). */}
          <button type="button" className="home-action" disabled={!authed}>
            create a new bookclub
          </button>
          <div className="home-action home-existing">
            <span className="home-existing-label">go to an existing club</span>
            <select defaultValue="" disabled={!authed}>
              <option value="" disabled>
                {authed ? "select a club" : "sign in first"}
              </option>
            </select>
          </div>
        </div>

        <div className="home-corner home-corner--credit">a project by Byron Li</div>
      </div>

      {loginOpen && <LoginModal session={session} onClose={() => setLoginOpen(false)} />}
    </div>
  );
}
