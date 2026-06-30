// Pre-deploy safety net: snapshot the currently-deployed prod Durable Object
// state to R2 before `wrangler deploy` ships new code, so a bad deploy or
// migration can be rolled back via /admin/restore. The backup endpoint also
// prunes stale snapshots, so this keeps retention tidy too.
//
// Required by default: any failure (missing token, unreachable prod, non-2xx)
// aborts the deploy. Opt out with PREDEPLOY_BACKUP_OPTIONAL=1 — e.g. the very
// first deploy, where there is no prod yet to back up.

const url = process.env.DEPLOY_BACKUP_URL ?? "https://bookclub.byron.land/admin/backup";
const token = process.env.ADMIN_API_TOKEN;
const optional = process.env.PREDEPLOY_BACKUP_OPTIONAL === "1";

function bail(message: string): never {
  console[optional ? "warn" : "error"](`[predeploy-backup] ${message}`);
  if (!optional) {
    console.error("[predeploy-backup] aborting deploy; set PREDEPLOY_BACKUP_OPTIONAL=1 to bypass");
  }
  process.exit(optional ? 0 : 1);
}

if (!token) bail("ADMIN_API_TOKEN not set; cannot take pre-deploy backup");

try {
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) bail(`backup request failed: ${res.status} ${await res.text()}`);
  console.log("[predeploy-backup] ok", await res.json());
} catch (error) {
  bail(`backup request errored: ${String(error)}`);
}
