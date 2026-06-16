import * as Schema from "effect/Schema";

export const SmartArrows = Schema.Union([
  Schema.Literal("off"),
  Schema.Literal("smooth"),
  Schema.Literal("instant"),
]);

export const ReadingPositionOpenPolicy = Schema.Union([
  Schema.Literal("prefer-local"),
  Schema.Literal("prefer-sync"),
]);

export const UserPrefs = Schema.Struct({
  reader: Schema.Struct({
    smartArrows: SmartArrows,
    readingPositionOpenPolicy: ReadingPositionOpenPolicy,
  }),
});

export const UserPrefsResponse = Schema.Struct({ prefs: UserPrefs });
export const SetUserPrefsRequest = Schema.Struct({ prefs: UserPrefs });

export type SmartArrows = Schema.Schema.Type<typeof SmartArrows>;
export type ReadingPositionOpenPolicy = Schema.Schema.Type<typeof ReadingPositionOpenPolicy>;
export type UserPrefs = Schema.Schema.Type<typeof UserPrefs>;

export const DEFAULT_USER_PREFS: UserPrefs = {
  reader: { smartArrows: "instant", readingPositionOpenPolicy: "prefer-sync" },
};

export function mergeUserPrefs(raw: Partial<UserPrefs> | null | undefined): UserPrefs {
  return { reader: { ...DEFAULT_USER_PREFS.reader, ...raw?.reader } };
}
