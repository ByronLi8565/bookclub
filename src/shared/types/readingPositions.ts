import * as Schema from "effect/Schema";

type SchemaType<S extends Schema.Top> = S["Type"];

const EpubReadingPosition = Schema.Struct({
  kind: Schema.tag("epub"),
  cfi: Schema.String,
  percentage: Schema.Number,
});

const PdfReadingPosition = Schema.Struct({
  kind: Schema.tag("pdf"),
  page: Schema.Number,
  scrollRatio: Schema.Number,
  zoom: Schema.Number,
  percentage: Schema.Number,
});

export const SourceReadingPosition = Schema.Union([EpubReadingPosition, PdfReadingPosition]).pipe(
  Schema.toTaggedUnion("kind"),
);

const StoredPositionMeta = {
  groupId: Schema.String,
  sourceId: Schema.String,
  updatedAt: Schema.String,
};

export const StoredReadingPosition = Schema.Union([
  Schema.Struct({ ...StoredPositionMeta, ...EpubReadingPosition.fields }),
  Schema.Struct({ ...StoredPositionMeta, ...PdfReadingPosition.fields }),
]).pipe(Schema.toTaggedUnion("kind"));

export const SetReadingPositionRequest = Schema.Struct({
  groupId: Schema.String,
  sourceId: Schema.String,
  position: StoredReadingPosition,
});

export const ReadingPositionResponse = Schema.Struct({
  position: Schema.NullOr(StoredReadingPosition),
});

const ReadingPositionSyncStatus = Schema.Union([
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

export type SourceReadingPosition = typeof SourceReadingPosition.Type;
export type StoredReadingPosition = typeof StoredReadingPosition.Type;
export interface ReadingPositionRecord extends SchemaType<typeof ReadingPositionRecord> {}
