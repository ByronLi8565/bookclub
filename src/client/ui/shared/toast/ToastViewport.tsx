import { useEffect, useState, type CSSProperties } from "react";
import { dismissToast, subscribe, type Toast } from "./toastStore.ts";

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
          // SAFETY: React's CSSProperties omits custom properties that the stylesheet consumes.
          style={{ "--toast-duration": `${toast.durationMs}ms` } as CSSProperties}
        >
          <div className="toast-head">
            <strong>{toast.title}</strong>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="dismiss toast"
              title="Dismiss"
            >
              x
            </button>
          </div>
          <div className="toast-body">
            <p>{toast.message}</p>
            {toast.action ? <a href={toast.action.href}>{toast.action.label}</a> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
