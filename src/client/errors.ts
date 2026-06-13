import * as Data from "effect/Data";

export class HashError extends Data.TaggedError("HashError")<{ cause: unknown }> {}

export class StorageError extends Data.TaggedError("StorageError")<{ cause: unknown }> {}
