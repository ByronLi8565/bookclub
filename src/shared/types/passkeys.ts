// Client-facing view of a registered passkey. Deliberately excludes the public
// key and counter — the browser only needs to identify and label credentials.
export interface PasskeyInfo {
  id: string;
  label: string;
  createdAt: string;
}
