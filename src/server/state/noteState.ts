// Note reducers live in shared/ so the client's optimistic op-log applies the
// exact same logic the server commits, guaranteeing the offline view converges
// with the authoritative state (modulo server-assigned seq).
export * from "../../shared/notes/noteState.ts";
