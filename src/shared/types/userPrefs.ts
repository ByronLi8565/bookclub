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

export const UserPrefs = Schema.Struct({
  reader: Schema.Struct({
    smartArrows: SmartArrows,
    readingPositionOpenPolicy: ReadingPositionOpenPolicy,
    pdfPageLayout: PdfPageLayout,
  }),
  notes: Schema.Struct({ showAvatars: Schema.Boolean }),
});

export const UserPrefsResponse = Schema.Struct({ prefs: UserPrefs });
export const SetUserPrefsRequest = Schema.Struct({ prefs: UserPrefs });

export type SmartArrows = typeof SmartArrows.Type;
export type ReadingPositionOpenPolicy = typeof ReadingPositionOpenPolicy.Type;
export type PdfPageLayout = typeof PdfPageLayout.Type;
export interface UserPrefs extends SchemaType<typeof UserPrefs> {}

export const DEFAULT_USER_PREFS: UserPrefs = {
  reader: {
    smartArrows: "instant",
    readingPositionOpenPolicy: "prefer-sync",
    pdfPageLayout: "single",
  },
  notes: { showAvatars: true },
};

export function mergeUserPrefs(raw: Partial<UserPrefs> | null | undefined): UserPrefs {
  return {
    reader: { ...DEFAULT_USER_PREFS.reader, ...raw?.reader },
    notes: { ...DEFAULT_USER_PREFS.notes, ...raw?.notes },
  };
}
