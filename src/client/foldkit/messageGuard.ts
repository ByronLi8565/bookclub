import { Schema } from "effect";

/**
 * Routes a Message to the slice whose union names its tag. Messages are built
 * by `m()` and already typed, so re-validating the whole payload on every
 * dispatch would only repeat the work their constructors did.
 */
export const tagGuard = <
  const Members extends ReadonlyArray<Schema.Top & { readonly Type: { readonly _tag: string } }>,
>(
  union: Schema.Union<Members>,
) => {
  const tags: ReadonlySet<string> = new Set(union.pipe(Schema.toTaggedUnion("_tag")).discriminants);
  return (message: { readonly _tag: string }): message is Members[number]["Type"] =>
    tags.has(message._tag);
};
