import { Agent, type Connection } from "agents";

const RECONCILE_RETRY_SECONDS = 60;

/** An Agent whose state only its own methods may change. The SDK otherwise
 *  applies any `cf_agent_state` frame a connected client sends, which would let
 *  a socket replace notes, memberships, or credentials wholesale and skip every
 *  role check the callables enforce. */
export class ServerOwnedAgent<Env extends Cloudflare.Env, State> extends Agent<Env, State> {
  override validateStateChange(_nextState: State, source: Connection | "server"): void {
    if (source !== "server") throw new Error("agent state is server-owned");
  }

  /**
   * Carries a committed change into the objects that project it. A failure is
   * not the caller's failure: the change already stands, so the step is queued
   * again on this object's durable schedule until the projection converges.
   * `callback` names the public method that runs this same step, which must
   * re-read current state and be safe to repeat.
   */
  protected async reconcile<P>(
    callback: keyof this & string,
    payload: P,
    step: () => Promise<void>,
  ): Promise<void> {
    try {
      await step();
    } catch (error) {
      console.error(`${callback} failed; retrying in ${RECONCILE_RETRY_SECONDS}s`, error);
      await this.schedule(RECONCILE_RETRY_SECONDS, callback, payload, { idempotent: true });
    }
  }
}
