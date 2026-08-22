/**
 * How long snapshots are kept. Pure arithmetic over keys and timestamps, with
 * no Worker runtime behind it, so it can be exercised directly in a unit test —
 * which is what lets `backup.ts` reach for `agents` at the top of the file like
 * every other server module.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface RetainableBackup {
  key: string;
  uploaded: number;
}

// Tiered retention: keep every snapshot from the last 24h, then one per
// calendar-day bucket for the past week, one per 7-day bucket for the past
// month, and discard anything older. Returns the keys that should be deleted.
export function selectStaleBackups(backups: RetainableBackup[], now: number): string[] {
  const newestFirst = backups.toSorted((a, b) => b.uploaded - a.uploaded);
  const seenDailyBuckets = new Set<number>();
  const seenWeeklyBuckets = new Set<number>();
  const stale: string[] = [];

  for (const backup of newestFirst) {
    const age = now - backup.uploaded;
    if (age < DAY_MS) continue; // recent: keep all
    if (age < 7 * DAY_MS) {
      // Keep the newest snapshot in each day bucket, drop the rest.
      const bucket = Math.floor(backup.uploaded / DAY_MS);
      if (seenDailyBuckets.has(bucket)) stale.push(backup.key);
      else seenDailyBuckets.add(bucket);
    } else if (age < 30 * DAY_MS) {
      // Keep the newest snapshot in each week bucket, drop the rest.
      const bucket = Math.floor(backup.uploaded / (7 * DAY_MS));
      if (seenWeeklyBuckets.has(bucket)) stale.push(backup.key);
      else seenWeeklyBuckets.add(bucket);
    } else {
      stale.push(backup.key); // older than 30 days
    }
  }
  return stale;
}
