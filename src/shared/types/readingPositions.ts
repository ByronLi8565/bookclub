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
  position: SourceReadingPosition,
});

export const ReadingPositionCache = Schema.Record(Schema.String, StoredReadingPosition);

export type SourceReadingPosition = Schema.Schema.Type<typeof SourceReadingPosition>;
export type StoredReadingPosition = Schema.Schema.Type<typeof StoredReadingPosition>;
