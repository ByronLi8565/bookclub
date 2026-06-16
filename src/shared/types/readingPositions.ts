import * as Schema from "effect/Schema";

export const EpubReadingPosition = Schema.Struct({
  kind: Schema.Literal("epub"),
  cfi: Schema.String,
  percentage: Schema.Number,
});

export const PdfReadingPosition = Schema.Struct({
  kind: Schema.Literal("pdf"),
  page: Schema.Number,
  scrollRatio: Schema.Number,
  zoom: Schema.Number,
  percentage: Schema.Number,
});

export const SourceReadingPosition = Schema.Union([EpubReadingPosition, PdfReadingPosition]);

const StoredPositionMeta = {
  groupId: Schema.String,
  sourceId: Schema.String,
  updatedAt: Schema.String,
};

export const StoredReadingPosition = Schema.Union([
  Schema.Struct({
    ...StoredPositionMeta,
    kind: Schema.Literal("epub"),
    cfi: Schema.String,
    percentage: Schema.Number,
  }),
  Schema.Struct({
    ...StoredPositionMeta,
    kind: Schema.Literal("pdf"),
    page: Schema.Number,
    scrollRatio: Schema.Number,
    zoom: Schema.Number,
    percentage: Schema.Number,
  }),
]);

export const SetReadingPositionRequest = Schema.Struct({
  groupId: Schema.String,
  sourceId: Schema.String,
  position: StoredReadingPosition,
});

export const ReadingPositionResponse = Schema.Struct({
  position: Schema.NullOr(StoredReadingPosition),
});

export const ReadingPositionSyncStatus = Schema.Union([
  Schema.Literal("dirty"),
  Schema.Literal("syncing"),
  Schema.Literal("clean"),
  Schema.Literal("error"),
]);

export const ReadingPositionRecord = Schema.Struct({
  position: StoredReadingPosition,
  lastSyncedPosition: Schema.NullOr(StoredReadingPosition),
  sync: Schema.Struct({
    status: ReadingPositionSyncStatus,
    lastSyncAttemptAt: Schema.NullOr(Schema.String),
    lastSyncError: Schema.NullOr(Schema.String),
  }),
});

export const ReadingPositionCache = Schema.Record(Schema.String, ReadingPositionRecord);

export type SourceReadingPosition = Schema.Schema.Type<typeof SourceReadingPosition>;
export type StoredReadingPosition = Schema.Schema.Type<typeof StoredReadingPosition>;
export type ReadingPositionRecord = Schema.Schema.Type<typeof ReadingPositionRecord>;
