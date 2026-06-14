import { useEffect, useState } from "react";
import type { BookUpload, InspectedBook } from "../../groups/useBookUpload.ts";
import type { SourceCapabilities, SourceHealth } from "../../../shared/types/sourceHealth.ts";
import { Loading } from "../shared/Loading.tsx";

// A single line in the "upload info" table. `status` colors the value text to
// communicate health (green/amber/red), matching the mock.
interface InfoRow {
  label: string;
  value: string;
  status?: "ok" | "warn" | "error";
}

const ACCEPT = ".epub,application/epub+zip,.pdf,application/pdf";

// The highlight capabilities the health check probes, in display order. These
// are the per-file health checks (notably for PDFs, whose text layer varies).
const CAPABILITY_ROWS: { key: keyof SourceCapabilities; label: string }[] = [
  { key: "selectableText", label: "Selectable text" },
  { key: "textAnchors", label: "Text anchors" },
  { key: "rectAnchors", label: "Position anchors" },
  { key: "quoteRebind", label: "Quote rebind" },
  { key: "pageNavigation", label: "Page navigation" },
];

// Human-readable byte size (e.g. "1.4 MB").
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

// The per-capability health checks: one row each, green when supported and red
// when not, so the reader knows exactly which highlight features will work.
function capabilityRows(capabilities: SourceCapabilities): InfoRow[] {
  return CAPABILITY_ROWS.map(({ key, label }) => ({
    label,
    value: capabilities[key] ? "yes" : "no",
    status: capabilities[key] ? ("ok" as const) : ("error" as const),
  }));
}

// Turn a health verdict into table rows: the per-capability checks plus a line
// per warning — or, for a rejected file (which has no capabilities), the
// blocking reason(s).
function healthRows(health: SourceHealth): InfoRow[] {
  if (health.status === "error") {
    return health.errors.map((e) => ({
      label: "Problem",
      value: e.message,
      status: "error" as const,
    }));
  }
  const warnings =
    health.status === "warn"
      ? health.warnings.map((w) => ({
          label: "Warning",
          value: w.message,
          status: "warn" as const,
        }))
      : [];
  return [...capabilityRows(health.capabilities), ...warnings];
}

// Build the full "upload info" table for an inspected file: bibliographic
// metadata (rows omitted when absent), file basics, then the health verdict.
function infoRows(inspected: InspectedBook): InfoRow[] {
  const { metadata, file, health } = inspected;
  const rows: InfoRow[] = [];
  if (metadata.title) rows.push({ label: "Title", value: metadata.title });
  if (metadata.author) rows.push({ label: "Author", value: metadata.author });
  if (metadata.wordCount !== null) {
    rows.push({ label: "Words", value: metadata.wordCount.toLocaleString() });
  }
  rows.push({ label: "Size", value: formatBytes(file.size) });
  rows.push(...healthRows(health));
  return rows;
}

// The upload screen the add-a-book flow opens first. Drop or pick an EPUB/PDF,
// preview its parsed metadata and a highlight-readiness health check (colored to
// show status), then commit it. Available to any club member.
export function UploadModal({
  upload,
  onClose,
}: {
  upload: BookUpload;
  onClose: () => void;
}): React.ReactElement {
  const [dragging, setDragging] = useState(false);

  // Reset the hook's picked-file state when the modal unmounts, so reopening it
  // starts clean.
  const { reset } = upload;
  useEffect(() => reset, [reset]);

  function onDrop(e: React.DragEvent): void {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void upload.select(file);
  }

  async function onConfirm(): Promise<void> {
    if (await upload.confirm()) onClose();
  }

  const inspected = upload.inspected;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal modal--upload"
        role="dialog"
        aria-modal="true"
        aria-label="add a book"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <strong>add a book</strong>
          <button type="button" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="modal-body upload-body">
          <label
            className={dragging ? "upload-drop is-dragging" : "upload-drop"}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            {inspected?.metadata.cover ? (
              <img className="upload-cover" src={inspected.metadata.cover} alt="" />
            ) : (
              <UploadIcon />
            )}
            <span className="upload-drop-label">
              {inspected ? inspected.file.name : "attach book here"}
            </span>
            <span className="upload-drop-hint">supported filetypes: pdf, epub</span>
            <input
              type="file"
              accept={ACCEPT}
              disabled={upload.busy}
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload.select(f);
                // Allow re-picking the same file later.
                e.target.value = "";
              }}
            />
          </label>

          {upload.error && <p className="upload-error">{upload.error}</p>}

          {upload.status === "checking" && (
            <div className="upload-checking">
              <Loading className="loading--inline" progress={upload.progress} />
              <span>checking whether highlights will work…</span>
            </div>
          )}

          {inspected && (
            <div className="upload-info">
              <h2 className="upload-info-head">upload info</h2>
              <dl className="upload-info-table">
                {infoRows(inspected).map((row, i) => (
                  <div className="upload-info-row" key={`${row.label}-${i}`}>
                    <dt>{row.label}</dt>
                    <dd className={row.status ? `upload-status--${row.status}` : undefined}>
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          <div className="upload-actions">
            <button
              type="button"
              className="primary upload-submit"
              disabled={!upload.canUpload || upload.busy}
              onClick={() => void onConfirm()}
            >
              {upload.status === "uploading" ? "uploading…" : "upload"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// The upload glyph from assets/upload.svg, inlined so it inherits currentColor.
function UploadIcon(): React.ReactElement {
  return (
    <svg
      className="upload-drop-icon"
      width="28"
      height="28"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5" />
      <path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708z" />
    </svg>
  );
}
