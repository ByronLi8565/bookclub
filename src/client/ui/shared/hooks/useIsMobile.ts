import { useEffect, useState } from "react";

// True on narrow (phone-sized) viewports, kept live across resizes/rotations.
// Drives the single-pane swipe layout instead of the side-by-side split.
const QUERY = "(max-width: 720px)";

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
