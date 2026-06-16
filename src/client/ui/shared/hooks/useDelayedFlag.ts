import { useEffect, useState } from "react";

export function useDelayedFlag(value: boolean, delayMs: number): boolean {
  const [delayed, setDelayed] = useState(false);

  useEffect(() => {
    if (!value) {
      setDelayed(false);
      return;
    }

    const timeout = window.setTimeout(() => setDelayed(true), delayMs);
    return () => window.clearTimeout(timeout);
  }, [value, delayMs]);

  return delayed;
}
