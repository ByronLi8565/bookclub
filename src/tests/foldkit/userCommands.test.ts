// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  rankCommands,
  readCommandHistory,
  rememberCommand,
  writeCommandHistory,
  type UserCommand,
} from "../../client/foldkit/userCommands.ts";

const commands: readonly UserCommand<string>[] = [
  {
    id: "settings",
    title: "Settings",
    category: "Application",
    keywords: ["preferences"],
    message: "settings",
  },
  {
    id: "club",
    title: "Switch to club: Café Astronomy Circle",
    category: "Clubs",
    message: "club",
  },
  { id: "book", title: "Switch to book: Dorian Gray", category: "Books", message: "book" },
];

describe("command suggestions", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("suggests frequent actions before recent actions, with recency breaking ties", () => {
    const history = {
      settings: { count: 5, lastUsed: 1 },
      club: { count: 2, lastUsed: 2 },
      book: { count: 2, lastUsed: 3 },
    };
    expect(rankCommands(commands, "", history).map(({ id }) => id)).toEqual([
      "settings",
      "book",
      "club",
    ]);
  });

  it("finds names across accents and reordered words even when another action is used more", () => {
    const history = { settings: { count: 100, lastUsed: 100 } };
    expect(rankCommands(commands, "astronomy cafe", history).map(({ id }) => id)).toEqual(["club"]);
    expect(rankCommands(commands, "preferences", history).map(({ id }) => id)).toEqual([
      "settings",
    ]);
    expect(rankCommands(commands, "missing", history)).toEqual([]);
  });

  it("remembers counts by stable identity and ignores commands that are no longer available", () => {
    const history = rememberCommand(rememberCommand({}, "club"), "club");
    writeCommandHistory(history);
    expect(readCommandHistory().club?.count).toBe(2);
    expect(
      rankCommands(
        commands.filter(({ id }) => id !== "club"),
        "",
        history,
      ).map(({ id }) => id),
    ).toEqual(["settings", "book"]);
  });

  it("discards malformed stored history at the storage boundary", () => {
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue(
      '{"settings":{"count":-1,"lastUsed":1}}',
    );
    expect(readCommandHistory()).toEqual({});
  });

  it("keeps commands usable when browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Quota exceeded");
    });
    expect(readCommandHistory()).toEqual({});
    expect(() => writeCommandHistory(rememberCommand({}, "settings"))).not.toThrow();
  });
});
