const DEFAULT_DURATION_MS = 2000;

type ToastType = "info" | "error";

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message: string;
  durationMs: number;
}

export interface ToastOptions {
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

export function dismissToast(id: string): void {
  const timer = timers.get(id);
  if (timer !== undefined) window.clearTimeout(timer);
  timers.delete(id);
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => listeners.delete(listener);
}

function emit(): void {
  for (const listener of listeners) listener(toasts);
}
