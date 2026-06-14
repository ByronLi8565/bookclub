// Source admission health. Before a source is bound to a club, its reader and
// highlight capabilities are checked. Health is modeled as errors and warnings,
// not a boolean: `ok` binds immediately, `warn` binds after explicit
// confirmation, `error` never binds.

export type SourceHealthStatus = "ok" | "warn" | "error";

export interface SourceCapabilities {
  selectableText: boolean;
  textAnchors: boolean;
  rectAnchors: boolean;
  quoteRebind: boolean;
  pageNavigation: boolean;
}

export type SourceWarningCode =
  | "partial_text_layer"
  | "low_text_coverage"
  | "large_file"
  | "mixed_page_support"
  | "rotated_pages"
  | "unusual_text_encoding";

export type SourceErrorCode =
  | "unsupported_type"
  | "parse_failed"
  | "encrypted"
  | "no_text_layer"
  | "anchor_capture_failed"
  | "anchor_locate_failed";

export interface SourceHealthIssue {
  code: SourceWarningCode | SourceErrorCode;
  message: string;
  page?: number;
}

export type SourceHealth =
  | { status: "ok"; capabilities: SourceCapabilities; checkedAt: string }
  | {
      status: "warn";
      capabilities: SourceCapabilities;
      warnings: SourceHealthIssue[];
      checkedAt: string;
    }
  | { status: "error"; errors: SourceHealthIssue[]; checkedAt: string };

export function healthOk(capabilities: SourceCapabilities): SourceHealth {
  return { status: "ok", capabilities, checkedAt: new Date().toISOString() };
}

export function healthWarn(
  capabilities: SourceCapabilities,
  warnings: SourceHealthIssue[],
): SourceHealth {
  return { status: "warn", capabilities, warnings, checkedAt: new Date().toISOString() };
}

export function healthError(errors: SourceHealthIssue[]): SourceHealth {
  return { status: "error", errors, checkedAt: new Date().toISOString() };
}
