// A Target is one running deployment of the product that scenarios drive purely
// through its public surfaces. This is the seam executor's e2e suite is built
// around ("one scenario, many targets"); bookclub is a single-deployment app, so
// it currently has one target (`wrangler` — the built worker), but the shape is
// kept so adding another (a real preview URL, a future host) is a new registry
// entry, not a rewrite of every scenario.
//
// `capabilities` is what makes capability-gated skips work: a scenario asks the
// context for a surface (`ctx.need("notes")`), and if this target doesn't list
// that capability the scenario is skipped with the reason recorded, rather than
// failing.

export type Capability = "api" | "notes" | "auth";

export interface Target {
  /** Stable id; matches the vitest project name and E2E_TARGET. */
  readonly name: string;
  /** Base origin the surfaces talk to, e.g. http://127.0.0.1:8842. */
  readonly baseUrl: string;
  /** What this target can provide. Missing => scenarios needing it skip. */
  readonly capabilities: ReadonlySet<Capability>;
}
