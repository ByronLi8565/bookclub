import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

// Native webviews call the deployed Worker with bearer auth; web stays same-origin.
const NATIVE_API_ORIGIN = "https://bookclub.byron.land";

export const isNative = Capacitor.isNativePlatform();

export const apiOrigin = isNative ? NATIVE_API_ORIGIN : "";

const TOKEN_KEY = "bc_session_token";
let cachedToken: string | null = null;
let tokenLoaded = false;

export async function loadSessionToken(): Promise<string | null> {
  if (!isNative) return null;
  if (!tokenLoaded) {
    cachedToken = (await Preferences.get({ key: TOKEN_KEY })).value;
    tokenLoaded = true;
  }
  return cachedToken;
}

export async function setSessionToken(token: string | null): Promise<void> {
  if (!isNative) return;
  cachedToken = token;
  tokenLoaded = true;
  if (token) await Preferences.set({ key: TOKEN_KEY, value: token });
  else await Preferences.remove({ key: TOKEN_KEY });
}

function apiUrl(path: string): string {
  return isNative ? `${apiOrigin}${path}` : path;
}

export const SESSION_EXPIRED_EVENT = "bookclub:session-expired";

/** Login refusals belong to the login form; protected-route refusals invalidate the live session. */
export function reportSessionExpiry(status: number, url: string): void {
  if (
    status === 401 &&
    !new URL(url, "https://bookclub.byron.land").pathname.startsWith("/auth/")
  ) {
    globalThis.window?.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!isNative) {
    const response = await fetch(path, init);
    reportSessionExpiry(response.status, path);
    return response;
  }
  const token = await loadSessionToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(apiUrl(path), { ...init, headers });
  reportSessionExpiry(response.status, path);
  return response;
}
