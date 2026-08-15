import { spawnToast } from "./toastStore.ts";

export const BUG_REPORT_EMAIL = "bookclub@byron.land";

interface ReportErrorOptions {
  title: string;
  message: string;
  context: string;
  error: unknown;
}

export function reportUnexpectedError({
  title,
  message,
  context,
  error,
}: ReportErrorOptions): void {
  console.error(context, error);
  const params = new URLSearchParams({
    subject: `Bookclub bug: ${title}`,
    body: `What happened:\n${message}\n\nWhat I was doing:\n`,
  });
  spawnToast(title, message, {
    type: "error",
    durationMs: 30_000,
    dedupeKey: context,
    action: { label: "File a bug report", href: `mailto:${BUG_REPORT_EMAIL}?${params.toString()}` },
  });
}
