import { Agent } from "agents";
import type { Env } from "../env.ts";

export const REGISTRY_ID = "global";

export interface RegistryState {
  names?: Record<string, string>;
  publicIds?: Record<string, string>;
}

export type ReservePublicIdResult = { ok: true } | { ok: false; reason: "taken" };

export class GroupRegistry extends Agent<Env, RegistryState> {
  initialState: RegistryState = { names: {}, publicIds: {} };

  reservePublicId(publicId: string, groupId: string): ReservePublicIdResult {
    const publicIds = this.state.publicIds ?? {};
    const existing = publicIds[publicId];
    if (existing !== undefined && existing !== groupId) return { ok: false, reason: "taken" };
    this.setState({ ...this.state, publicIds: { ...publicIds, [publicId]: groupId } });
    return { ok: true };
  }

  resolvePublicId(publicId: string): string | null {
    return this.state.publicIds?.[publicId] ?? null;
  }
}
