import { useEffect, useState, type CSSProperties } from "react";

const DEFAULT_DURATION_MS = 2000;

type ToastType = "info" | "error";

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message: string;
  durationMs: number;
}

interface ToastOptions {
  type?: ToastType;
  durationMs?: number;
}

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
const listeners = new Set<Listener>();
const timers = new Map<string, number>();

export function spawnToast(title: string, message: string, options: ToastOptions = {}): string {
  const toast: Toast = {
    id: crypto.randomUUID(),
    type: options.type ?? "info",
    title,
    message,
    durationMs: options.durationMs ?? DEFAULT_DURATION_MS,
  };
  toasts = [toast, ...toasts];
  timers.set(
    toast.id,
    window.setTimeout(() => dismissToast(toast.id), toast.durationMs),
  );
  emit();
  return toast.id;
}

function dismissToast(id: string): void {
  const timer = timers.get(id);
  if (timer !== undefined) window.clearTimeout(timer);
  timers.delete(id);
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => listeners.delete(listener);
}

function emit(): void {
  for (const listener of listeners) listener(toasts);
}

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
