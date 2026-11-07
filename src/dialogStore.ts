// A tiny queue behind the app's own confirm dialog, so any code can await a
// styled, centred confirmation instead of the browser's window.confirm().
export type ConfirmTone = "danger" | "default";

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
};

export type ConfirmRequest = Required<Omit<ConfirmOptions, "message">> & {
  id: number;
  message: string;
};

type Pending = ConfirmRequest & { resolve: (ok: boolean) => void };

let queue: Pending[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Ask the person to confirm. Resolves true on confirm, false on cancel. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [
      ...queue,
      {
        id: nextId++,
        title: options.title,
        message: options.message ?? "",
        confirmLabel:
          options.confirmLabel ??
          (options.tone === "danger" ? "Delete" : "Confirm"),
        cancelLabel: options.cancelLabel ?? "Cancel",
        tone: options.tone ?? "default",
        resolve,
      },
    ];
    emit();
  });
}

/** The request on screen now; later ones wait their turn. */
export function currentConfirm(): ConfirmRequest | null {
  return queue[0] ?? null;
}

export function settleConfirm(id: number, ok: boolean) {
  const item = queue.find((q) => q.id === id);
  if (!item) return;
  queue = queue.filter((q) => q.id !== id);
  item.resolve(ok);
  emit();
}

export function subscribeConfirm(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
