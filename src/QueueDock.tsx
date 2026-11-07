import { useEffect, useState, useSyncExternalStore } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, X } from "lucide-react";
import type { QueueTask, TaskQueue } from "./taskQueue";

/** Asks the browser to confirm leaving while saves are still pending. */
export function useLeaveWarning(pending: number) {
  useEffect(() => {
    if (!pending) return;
    const warn = (e: BeforeUnloadEvent) => {
      // Browsers only show their own generic prompt here; custom text and
      // custom dialogs are not allowed on tab close.
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);
}

export function useQueue(queue: TaskQueue) {
  return useSyncExternalStore(queue.subscribe, queue.getSnapshot);
}

function TaskRow({
  task,
  onDismiss,
}: {
  task: QueueTask;
  onDismiss: () => void;
}) {
  const percent = task.total ? Math.round((task.done / task.total) * 100) : 0;
  return (
    <li className={`queue-task ${task.status}`}>
      <div className="queue-task-head">
        <span className="queue-task-label">{task.label}</span>
        <span className="queue-task-state">
          {task.status === "queued" && "Waiting"}
          {task.status === "running" &&
            (task.total > 1 ? `${task.done} / ${task.total}` : "Saving…")}
          {task.status === "done" && "Saved"}
          {task.status === "failed" && "Failed"}
        </span>
        {(task.status === "done" || task.status === "failed") && (
          <button
            className="queue-dismiss"
            aria-label={`Dismiss ${task.label}`}
            onClick={onDismiss}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {(task.status === "running" || task.status === "queued") &&
        task.total > 1 && (
          <progress
            aria-label={task.label}
            value={task.done}
            max={task.total}
            title={`${percent}%`}
          />
        )}
      {task.status === "failed" && (
        <p className="queue-task-error" role="alert">
          {task.error}
          {task.done > 0 &&
            ` ${task.done} of ${task.total} were saved before it stopped.`}
        </p>
      )}
    </li>
  );
}

/** Floating panel in the corner that shows background saves. */
export function QueueDock({ queue }: { queue: TaskQueue }) {
  const { tasks, pending } = useQueue(queue);
  const [open, setOpen] = useState(true);
  const failed = tasks.filter((t) => t.status === "failed").length;
  const finished = tasks.filter((t) => t.status === "done").length;
  // Tidy away successful tasks a few seconds after everything settles.
  useEffect(() => {
    if (pending || failed || !finished) return;
    const timer = window.setTimeout(() => queue.clearDone(), 4000);
    return () => window.clearTimeout(timer);
  }, [pending, failed, finished, queue]);
  if (!tasks.length) return null;
  const running = tasks.find((t) => t.status === "running");
  const summary = pending
    ? `Saving in the background · ${pending} ${pending === 1 ? "task" : "tasks"} left`
    : failed
      ? `${failed} ${failed === 1 ? "task" : "tasks"} failed`
      : "All changes saved";
  return (
    <aside
      className={`queue-dock${failed ? " has-failed" : ""}`}
      aria-label="Background saves"
    >
      <button
        className="queue-dock-head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {pending ? (
          <Loader2 size={16} className="queue-spin" aria-hidden />
        ) : (
          <CheckCircle2 size={16} aria-hidden />
        )}
        <span role="status">{summary}</span>
        {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      {!open && running && running.total > 1 && (
        <progress
          className="queue-mini"
          aria-label={running.label}
          value={running.done}
          max={running.total}
        />
      )}
      {open && (
        <>
          <ul className="queue-list">
            {tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                onDismiss={() => queue.dismiss(t.id)}
              />
            ))}
          </ul>
          {pending > 0 && (
            <p className="queue-note">
              You can keep using Fuloos. Keep this tab open until saving
              finishes.
            </p>
          )}
        </>
      )}
    </aside>
  );
}
