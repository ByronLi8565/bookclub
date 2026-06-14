import type { Session } from "../auth/useSession.ts";
import { Login } from "./Login.tsx";

// The landing page (future `/` route). Sign-in lives in the top-right; the
// create / existing-club actions are placeholders until Phase B wires groups.
export function Home({ session }: { session: Session }): React.ReactElement {
  const authed = session.status === "authed";
  return (
    <div className="home">
      <div className="home-card">
        <div className="home-corner home-corner--login">
          <Login session={session} />
        </div>

        <div className="home-main">
          <h1 className="home-title">Bookclub</h1>
          {/* Placeholders: no functionality until Phase B (groups + routing). */}
          <button type="button" className="home-action" disabled={!authed}>
            create a new bookclub
          </button>
          <label className="home-action home-existing">
            go to an existing club
            <select disabled={!authed} defaultValue="">
              <option value="" disabled>
                {authed ? "select a club" : "sign in first"}
              </option>
            </select>
          </label>
        </div>

        <div className="home-corner home-corner--credit">a project by Byron Li</div>
      </div>
    </div>
  );
}
