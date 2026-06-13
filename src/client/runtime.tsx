import type * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { createContext, useCallback, useContext, type ReactNode } from "react";
import type { NoteStore } from "./storage/NoteStore.ts";
import { NoteStoreLive } from "./storage/NoteStore.ts";

const runtime = ManagedRuntime.make(NoteStoreLive);

type AppServices = NoteStore;

const RuntimeContext = createContext(runtime);

export function RuntimeProvider({ children }: { children: ReactNode }) {
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

// Run an app effect from react, returning a promise.
export function useRun() {
  const rt = useContext(RuntimeContext);
  return useCallback(
    <A, E>(effect: Effect.Effect<A, E, AppServices>) => rt.runPromise(effect),
    [rt],
  );
}
