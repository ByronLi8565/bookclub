// Pre-deploy safety net: snapshot the currently-deployed prod Durable Object
// state to R2 before `alchemy deploy` ships new code, so a bad deploy or
// migration can be rolled back via /admin/restore. The backup endpoint also
// prunes stale snapshots, so this keeps retention tidy too.
//
// Best-effort by design: a deploy is never blocked (e.g. the very first deploy
// has no prod to back up), but failures are logged loudly. Set
// PREDEPLOY_BACKUP_REQUIRED=1 to make any failure abort the deploy.

const url = process.env.DEPLOY_BACKUP_URL ?? "https://bookclub.byron.land/admin/backup";
const token = process.env.ADMIN_API_TOKEN;
const required = process.env.PREDEPLOY_BACKUP_REQUIRED === "1";

function bail(message: string): never {
  console[required ? "error" : "warn"](`[predeploy-backup] ${message}`);
  process.exit(required ? 1 : 0);
}

if (!token) bail("ADMIN_API_TOKEN not set; skipping pre-deploy backup");

try {
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) bail(`backup request failed: ${res.status} ${await res.text()}`);
  console.log("[predeploy-backup] ok", await res.json());
} catch (error) {
  bail(`backup request errored: ${String(error)}`);
}
