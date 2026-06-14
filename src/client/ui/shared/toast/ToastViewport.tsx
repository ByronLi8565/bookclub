import { useEffect, useState, type CSSProperties } from "react";
import { dismissToast, subscribe, type Toast } from "./store.ts";

export function ToastViewport() {
  const [visible, setVisible] = useState<Toast[]>([]);

  useEffect(() => subscribe(setVisible), []);

  if (visible.length === 0) return null;

  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="false">
      {visible.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast--${toast.type}`}
          style={{ "--toast-duration": `${toast.durationMs}ms` } as CSSProperties}
        >
          <div className="toast-head">
            <strong>{toast.title}</strong>
            <button type="button" onClick={() => dismissToast(toast.id)} aria-label="dismiss toast">
              x
            </button>
          </div>
          <p>{toast.message}</p>
        </div>
      ))}
    </div>
  );
}
