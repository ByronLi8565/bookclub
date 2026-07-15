import * as Schema from "effect/Schema";

type SchemaType<S extends Schema.Top> = S["Type"];

export const SmartArrows = Schema.Union([
  Schema.Literal("off"),
  Schema.Literal("smooth"),
  Schema.Literal("instant"),
]);

export const ReadingPositionOpenPolicy = Schema.Union([
  Schema.Literal("prefer-local"),
  Schema.Literal("prefer-sync"),
]);

// "auto" shows a two-page (book) spread for PDFs only when it fits nicely
// (wide enough viewport); otherwise it falls back to a single page.
export const PdfPageLayout = Schema.Union([Schema.Literal("single"), Schema.Literal("auto")]);

const ReaderPrefs = Schema.Struct({
  smartArrows: SmartArrows,
  readingPositionOpenPolicy: ReadingPositionOpenPolicy,
  pdfPageLayout: PdfPageLayout,
});

const NotesPrefs = Schema.Struct({
  showAvatars: Schema.Boolean,
  hashtagsAddTags: Schema.Boolean,
  showHashtags: Schema.Boolean,
});

export const UserPrefs = Schema.Struct({ reader: ReaderPrefs, notes: NotesPrefs });

export const UserPrefsPatch = Schema.Struct({
  reader: Schema.optionalKey(
    Schema.Struct({
      smartArrows: Schema.optionalKey(SmartArrows),
      readingPositionOpenPolicy: Schema.optionalKey(ReadingPositionOpenPolicy),
      pdfPageLayout: Schema.optionalKey(PdfPageLayout),
    }),
  ),
  notes: Schema.optionalKey(
    Schema.Struct({
      showAvatars: Schema.optionalKey(Schema.Boolean),
      hashtagsAddTags: Schema.optionalKey(Schema.Boolean),
      showHashtags: Schema.optionalKey(Schema.Boolean),
    }),
  ),
});

export const UserPrefsResponse = Schema.Struct({ prefs: UserPrefs });
export const SetUserPrefsRequest = Schema.Struct({ prefs: UserPrefs });

export type SmartArrows = typeof SmartArrows.Type;
export type ReadingPositionOpenPolicy = typeof ReadingPositionOpenPolicy.Type;
export type PdfPageLayout = typeof PdfPageLayout.Type;
export interface UserPrefs extends SchemaType<typeof UserPrefs> {}
export interface UserPrefsPatch extends SchemaType<typeof UserPrefsPatch> {}

export const DEFAULT_USER_PREFS: UserPrefs = {
  reader: {
    smartArrows: "instant",
    readingPositionOpenPolicy: "prefer-sync",
    pdfPageLayout: "single",
  },
  notes: { showAvatars: true, hashtagsAddTags: true, showHashtags: true },
};

export function mergeUserPrefs(raw: UserPrefsPatch | null | undefined): UserPrefs {
  return {
    reader: { ...DEFAULT_USER_PREFS.reader, ...raw?.reader },
    notes: { ...DEFAULT_USER_PREFS.notes, ...raw?.notes },
  };
}
