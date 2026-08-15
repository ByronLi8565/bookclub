/**
 * The sentences a reader sees when a club name is refused. One table, read by
 * both the React home page and the Foldkit one, so the two cannot drift.
 */
const NAME_ERRORS = new Map([
  ["empty", "Enter a name for your club."],
  ["too_long", "That name is too long! 100 characters max."],
]);

export const clubNameErrorMessage = (error: string): string =>
  NAME_ERRORS.get(error) ?? "Couldn't create that club. Try again.";
