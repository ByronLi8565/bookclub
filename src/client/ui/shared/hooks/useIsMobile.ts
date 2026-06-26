import { useEffect, useState } from "react";

const QUERY = "(max-width: 720px)";

// Synchronous, hook-free viewport check for imperative code paths (e.g. the PDF
// render loop) that need to branch on mobile without subscribing to changes.
export function isMobileViewport(): boolean {
  return window.matchMedia(QUERY).matches;
}

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = () => setMobile(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return mobile;
}
