import { Effect } from "effect";
import type { SourceReadingPosition } from "../../shared/types/readingPositions.ts";
import type { SourceKind } from "../../shared/types/sources.ts";
import { bookclubClient } from "../logic/net/bookclubClient.ts";
import {
  fetchReadingPositionWith,
  getReadingPosition,
  setLocalReadingPosition,
  syncReadingPositionWith,
  type ReadingPositionTransport,
} from "../logic/settings/readingPositions.ts";

/**
 * Where the reader's place is kept. The local record cache is authoritative for
 * opening — it answers offline and without a round trip — while the server copy
 * is merged in when it arrives and pushed back when it falls behind.
 *
 * This is injected into the reader slice rather than imported by it, so the
 * browser harness can open a book with no account at all.
 */
export interface ReaderPositions {
  /** The place to open at, preferring the newer of local and server. */
  restore: (input: {
    userId: string;
    groupId: string;
    sourceId: string;
    kind: SourceKind;
  }) => Effect.Effect<SourceReadingPosition | null>;
  /** Record where the reader is now. Local only: syncing is its own step. */
  record: (input: {
    userId: string;
    groupId: string;
    sourceId: string;
    position: SourceReadingPosition;
  }) => Effect.Effect<void>;
  /** Push a local place the server has not seen yet. */
  sync: (input: { userId: string; groupId: string; sourceId: string }) => Effect.Effect<void>;
}

const clientTransport: ReadingPositionTransport<unknown> = {
  fetch: (groupId, sourceId) =>
    bookclubClient.pipe(
      Effect.flatMap((client) => client.accounts.readingPosition({ query: { groupId, sourceId } })),
      Effect.map(({ position }) => position ?? null),
    ),
  push: (groupId, sourceId, position) =>
    bookclubClient.pipe(
      Effect.flatMap((client) =>
        client.accounts.setReadingPosition({ payload: { groupId, sourceId, position } }),
      ),
      Effect.map(({ position: stored }) => stored ?? null),
    ),
};

export const browserReaderPositions: ReaderPositions = {
  restore: ({ userId, groupId, sourceId, kind }) =>
    Effect.sync(() => getReadingPosition(userId, groupId, sourceId, kind)?.position ?? null).pipe(
      Effect.flatMap((local) =>
        fetchReadingPositionWith(clientTransport, userId, groupId, sourceId).pipe(
          Effect.map((server) => server ?? local),
          // A failed lookup must not strand an offline-capable reader on a
          // loading shell; the last local place remains the safe fallback.
          Effect.orElseSucceed(() => local),
        ),
      ),
    ),
  record: ({ userId, groupId, sourceId, position }) =>
    Effect.sync(() => {
      setLocalReadingPosition(userId, groupId, sourceId, position);
    }),
  sync: ({ userId, groupId, sourceId }) =>
    syncReadingPositionWith(clientTransport, userId, groupId, sourceId).pipe(
      Effect.asVoid,
      Effect.orElseSucceed(() => {}),
    ),
};

/** A reader with no account keeps no place: the harness and any signed-out
 *  surface open at the beginning and record nothing. */
export const noReaderPositions: ReaderPositions = {
  restore: () => Effect.succeed(null),
  record: () => Effect.void,
  sync: () => Effect.void,
};
