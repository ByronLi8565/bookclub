export type Capability = "api" | "notes" | "auth";

export interface Target {
  readonly name: string;
  readonly baseUrl: string;
  readonly capabilities: ReadonlySet<Capability>;
}
