import { Agent } from "agents";
import type { Env } from "../env.ts";

export const REGISTRY_ID = "global";

export interface RegistryState {
  names?: Record<string, string>;
  publicIds?: Record<string, string>;
}

export const RegistryFailureReason = { Taken: "taken" } as const;
export type RegistryFailureReason =
  (typeof RegistryFailureReason)[keyof typeof RegistryFailureReason];

export type ReservePublicIdResult = { ok: true } | { ok: false; reason: RegistryFailureReason };

export class GroupRegistry extends Agent<Env, RegistryState> {
  initialState: RegistryState = { names: {}, publicIds: {} };

  reservePublicId(publicId: string, groupId: string): ReservePublicIdResult {
    const publicIds = this.state.publicIds ?? {};
    const existing = publicIds[publicId];
    if (existing !== undefined && existing !== groupId) {
      return { ok: false, reason: RegistryFailureReason.Taken };
    }
    this.setState({ ...this.state, publicIds: { ...publicIds, [publicId]: groupId } });
    return { ok: true };
  }

  resolvePublicId(publicId: string): string | null {
    return this.state.publicIds?.[publicId] ?? null;
  }

  releaseGroup(groupId: string): void {
    this.setState({
      ...this.state,
      names: Object.fromEntries(
        Object.entries(this.state.names ?? {}).filter(([, id]) => id !== groupId),
      ),
      publicIds: Object.fromEntries(
        Object.entries(this.state.publicIds ?? {}).filter(([, id]) => id !== groupId),
      ),
    });
  }

  exportState(): RegistryState {
    return this.state;
  }

  importState(state: RegistryState): void {
    this.setState(state);
  }
}
