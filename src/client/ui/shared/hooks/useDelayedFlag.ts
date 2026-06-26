import { useEffect, useState } from "react";

export function useDelayedFlag(value: boolean, delayMs: number): boolean {
  const [delayed, setDelayed] = useState(false);

  if (!value && delayed) setDelayed(false);

  useEffect(() => {
    if (!value) return;

    const timeout = window.setTimeout(() => setDelayed(true), delayMs);
    return () => window.clearTimeout(timeout);
  }, [value, delayMs]);

  return delayed;
}
