import { describe, expect, it } from "vitest";
import { selectStaleBackups, type RetainableBackup } from "../server/backup.ts";

const NOW = Date.parse("2026-06-30T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function at(ageMs: number, key: string): RetainableBackup {
  return { key, uploaded: NOW - ageMs };
}

describe("selectStaleBackups", () => {
  it("keeps every snapshot from the last 24h", () => {
    const backups = [at(1 * HOUR, "a"), at(12 * HOUR, "b"), at(23 * HOUR, "c")];
    expect(selectStaleBackups(backups, NOW)).toEqual([]);
  });

  it("keeps only the newest snapshot per day in the 1-7 day tier", () => {
    const backups = [
      at(3 * DAY + 2 * HOUR, "newer-same-day"),
      at(3 * DAY + 8 * HOUR, "older-same-day"),
    ];
    expect(selectStaleBackups(backups, NOW)).toEqual(["older-same-day"]);
  });

  it("keeps only the newest snapshot per week in the 7-30 day tier", () => {
    const backups = [at(15 * DAY, "newer-same-week"), at(15 * DAY + 3 * HOUR, "older-same-week")];
    expect(selectStaleBackups(backups, NOW)).toEqual(["older-same-week"]);
  });

  it("deletes everything older than 30 days", () => {
    const backups = [at(31 * DAY, "x"), at(90 * DAY, "y")];
    expect(selectStaleBackups(backups, NOW).toSorted()).toEqual(["x", "y"]);
  });

  it("retains across tiers without dropping representatives", () => {
    const backups = [
      at(2 * HOUR, "recent"),
      at(2 * DAY, "day-keep"),
      at(20 * DAY, "week-keep"),
      at(45 * DAY, "too-old"),
    ];
    expect(selectStaleBackups(backups, NOW)).toEqual(["too-old"]);
  });
});
