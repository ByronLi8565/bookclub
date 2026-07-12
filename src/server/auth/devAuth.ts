export interface DevAuthEnv {
  DEV_AUTH?: string;
  EMAIL?: unknown;
  EMAIL_FROM?: string;
}

export function isDevAuth(env: DevAuthEnv): boolean {
  return env.DEV_AUTH === "true" || !env.EMAIL || !env.EMAIL_FROM;
}
