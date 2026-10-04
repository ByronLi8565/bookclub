import { Schema } from "effect";
import { m } from "foldkit/message";

export const CommandBinding = Schema.Struct({
  key: Schema.String,
  modifier: Schema.Literals(["none", "shift", "command"]),
  whileTyping: Schema.optionalKey(Schema.Boolean),
});
export type CommandBinding = typeof CommandBinding.Type;

/** User intentions are separate from Foldkit Commands, which execute effects. */
export interface UserCommand<Message> {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly keywords?: readonly string[];
  readonly binding?: CommandBinding;
  readonly message: Message;
}

export type CommandProvider<Context, Message> = (
  context: Context,
) => readonly UserCommand<Message>[];

/** Controls and the palette resolve the same live registry at invocation time. */
export const commandRegistry =
  <Context, Message>(...providers: readonly CommandProvider<Context, Message>[]) =>
  (context: Context): readonly UserCommand<Message>[] =>
    providers.flatMap((provide) => provide(context));

export const InvokedUserCommand = m("InvokedUserCommand", { id: Schema.String });

export const shortcutLabel = ({ key, modifier }: CommandBinding): string => {
  const arrows = new Map([
    ["ArrowLeft", "←"],
    ["ArrowRight", "→"],
    ["ArrowUp", "↑"],
    ["ArrowDown", "↓"],
  ]);
  const prefix = modifier === "command" ? "⌘" : modifier === "shift" ? "⇧" : "";
  return `${prefix}${arrows.get(key) ?? key.toUpperCase()}`;
};

export const matchesCommandBinding = (event: KeyboardEvent, binding: CommandBinding): boolean => {
  if (event.defaultPrevented || event.isComposing || event.altKey) return false;
  const modifier = event.metaKey || event.ctrlKey ? "command" : event.shiftKey ? "shift" : "none";
  if (modifier !== binding.modifier || (modifier === "command" && event.shiftKey)) return false;
  if (
    !binding.whileTyping &&
    event.target instanceof HTMLElement &&
    (event.target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName))
  )
    return false;
  return event.key.toLowerCase() === binding.key.toLowerCase();
};

const CommandUsage = Schema.Struct({
  count: Schema.Int.check(Schema.isGreaterThan(0)),
  lastUsed: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
});
export const CommandHistory = Schema.Record(Schema.String, CommandUsage);
export type CommandHistory = typeof CommandHistory.Type;

const HISTORY_KEY = "bookclub:command-history:v1";
const HISTORY_LIMIT = 200;

export const readCommandHistory = (): CommandHistory => {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw === null ? {} : Schema.decodeUnknownSync(CommandHistory)(JSON.parse(raw));
  } catch {
    // Storage can be unavailable as well as malformed; either leaves commands usable.
    return {};
  }
};

export const writeCommandHistory = (history: CommandHistory): void => {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Remembering suggestions is optional in private or full storage.
  }
};

export const rememberCommand = (history: CommandHistory, id: string): CommandHistory =>
  Object.fromEntries(
    Object.entries({
      ...history,
      [id]: { count: (history[id]?.count ?? 0) + 1, lastUsed: Date.now() },
    })
      .toSorted(([, a], [, b]) => b.lastUsed - a.lastUsed)
      .slice(0, HISTORY_LIMIT),
  );

const normalize = (value: string): string =>
  value.normalize("NFKD").replaceAll(/\p{M}/gu, "").toLocaleLowerCase().trim();

const searchScore = <Message>(command: UserCommand<Message>, query: string): number => {
  if (query === "") return 0;
  const title = normalize(command.title);
  const searchable = normalize(
    [command.title, command.category, ...(command.keywords ?? [])].join(" "),
  );
  if (!query.split(/\s+/u).every((word) => searchable.includes(word))) return -1;
  if (title === query) return 4;
  if (title.startsWith(query)) return 3;
  if (title.includes(query)) return 2;
  return 1;
};

/** Relevance wins while searching; frequency and recency order equally good matches. */
export const rankCommands = <Message>(
  commands: readonly UserCommand<Message>[],
  query: string,
  history: CommandHistory,
): readonly UserCommand<Message>[] => {
  const normalized = normalize(query);
  return commands
    .map((command, order) => ({ command, order, score: searchScore(command, normalized) }))
    .filter(({ score }) => score >= 0)
    .toSorted(
      (a, b) =>
        b.score - a.score ||
        (history[b.command.id]?.count ?? 0) - (history[a.command.id]?.count ?? 0) ||
        (history[b.command.id]?.lastUsed ?? 0) - (history[a.command.id]?.lastUsed ?? 0) ||
        a.order - b.order,
    )
    .map(({ command }) => command);
};
