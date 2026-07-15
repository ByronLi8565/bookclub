export interface DevAuthEnv {
  DEV_AUTH?: string;
}

export function isDevAuth(env: DevAuthEnv): boolean {
  return env.DEV_AUTH === "true";
}
