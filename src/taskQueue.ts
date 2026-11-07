// An app-wide queue for slow saves (imports, bulk edits, transaction adds).
// Tasks run one at a time, in the order they were added, and keep running
// while the user moves between pages. The UI reads a snapshot through
// subscribe/getSnapshot, which fits React's useSyncExternalStore.

export type TaskStatus = "queued" | "running" | "done" | "failed";

export type QueueTask = {
  id: number;
  label: string;
  status: TaskStatus;
  done: number;
  total: number;
  error: string;
};

export type TaskContext = {
  /** Report how many of `total` items are saved so far. */
  progress: (done: number) => void;
};

export type TaskInput = {
  label: string;
  total?: number;
  run: (ctx: TaskContext) => Promise<void>;
};

export type QueueSnapshot = {
  tasks: QueueTask[];
  /** Tasks that are queued or running. */
  pending: number;
};

const EMPTY: QueueSnapshot = { tasks: [], pending: 0 };

export class TaskQueue {
  private tasks: QueueTask[] = [];
  private runners = new Map<number, TaskInput["run"]>();
  private listeners = new Set<() => void>();
  private snapshot: QueueSnapshot = EMPTY;
  private nextId = 1;
  private running = false;
  private idleWaiters: (() => void)[] = [];

  enqueue(input: TaskInput): number {
    const id = this.nextId++;
    this.tasks = [
      ...this.tasks,
      {
        id,
        label: input.label,
        status: "queued",
        done: 0,
        total: Math.max(0, input.total ?? 1),
        error: "",
      },
    ];
    this.runners.set(id, input.run);
    this.emit();
    void this.pump();
    return id;
  }

  /** Remove a finished or failed task from the list. */
  dismiss(id: number) {
    const task = this.tasks.find((t) => t.id === id);
    if (!task || task.status === "queued" || task.status === "running") return;
    this.tasks = this.tasks.filter((t) => t.id !== id);
    this.emit();
  }

  /** Remove every finished task, keeping failures so they are not missed. */
  clearDone() {
    const next = this.tasks.filter((t) => t.status !== "done");
    if (next.length === this.tasks.length) return;
    this.tasks = next;
    this.emit();
  }

  /** Drop queued tasks that have not started yet. */
  cancelQueued() {
    const next = this.tasks.filter((t) => t.status !== "queued");
    if (next.length === this.tasks.length) return;
    for (const t of this.tasks)
      if (t.status === "queued") this.runners.delete(t.id);
    this.tasks = next;
    this.emit();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): QueueSnapshot => this.snapshot;

  /** Resolves once nothing is queued or running. */
  idle(): Promise<void> {
    if (!this.snapshot.pending) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private update(id: number, patch: Partial<QueueTask>) {
    this.tasks = this.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
    this.emit();
  }

  private emit() {
    const pending = this.tasks.filter(
      (t) => t.status === "queued" || t.status === "running",
    ).length;
    this.snapshot = { tasks: this.tasks, pending };
    for (const listener of [...this.listeners]) listener();
    if (!pending && this.idleWaiters.length) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const resolve of waiters) resolve();
    }
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const task = this.tasks.find((t) => t.status === "queued");
        if (!task) return;
        const run = this.runners.get(task.id);
        this.runners.delete(task.id);
        this.update(task.id, { status: "running" });
        try {
          if (!run) throw new Error("Task was lost.");
          await run({
            progress: (done) =>
              this.update(task.id, {
                done: Math.min(Math.max(0, done), task.total),
              }),
          });
          this.update(task.id, { status: "done", done: task.total });
        } catch (e) {
          this.update(task.id, {
            status: "failed",
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    } finally {
      this.running = false;
    }
  }
}
