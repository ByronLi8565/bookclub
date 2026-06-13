import * as Data from "effect/Data";

export class HashError extends Data.TaggedError("HashError")<{ cause: unknown }> {}
