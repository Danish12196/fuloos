import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { shiftMonth } from "./domain";
import {
  PERIOD_SPANS,
  monthsBetween,
  periodContains,
  periodLabel,
  periodMonths,
  periodStep,
  shortMonthName,
  type PeriodSpan,
} from "./period";
import "./periodPicker.css";

/**
 * One control for "which months am I looking at": arrows step a whole period,
 * the label opens a panel with the span choices and a year-at-a-glance month grid.
 */
export function PeriodPicker({
  month,
  from,
  span = "month",
  spans,
  currentMonth,
  activeMonths,
  onChange,
  label = "Period",
}: {
  /** The last month in the period ("YYYY-MM"). */
  month: string;
  /** First month of a custom range. */
  from?: string;
  span?: PeriodSpan;
  /** Span choices to offer. Leave out for a month-only picker. */
  spans?: PeriodSpan[];
  currentMonth: string;
  /** Months that have activity; they get a small dot in the grid. */
  activeMonths?: Set<string>;
  onChange: (next: { month: string; span: PeriodSpan; from?: string }) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const [hover, setHover] = useState<string | null>(null);
  // Custom ranges take two clicks: the first month, then the last.
  const [draftFrom, setDraftFrom] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const custom = span === "custom";
  const step = periodStep(span, month, from);
  const range = periodMonths(span, month, from);
  const title = periodLabel(span, month, from);
  /** Move the whole period by `delta` months, keeping a custom range's length. */
  const shift = (delta: number) =>
    onChange({
      span,
      month: shiftMonth(month, delta),
      from: custom && range ? shiftMonth(range.first, delta) : undefined,
    });
  const choices = spans
    ? PERIOD_SPANS.filter((s) => spans.includes(s.value))
    : [];

  useEffect(() => {
    if (!open) return;
    setYear(Number(month.slice(0, 4)));
    setDraftFrom(null);
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    // Start keyboard users on the selected month.
    requestAnimationFrame(() =>
      (
        root.current?.querySelector<HTMLButtonElement>(
          ".period-month.is-anchor",
        ) ??
        root.current?.querySelector<HTMLButtonElement>(".period-span.is-active")
      )?.focus(),
    );
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
    // Only when opening; month changes inside the panel keep the viewed year.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const pick = (next: string) => {
    if (custom) {
      if (!draftFrom) {
        setDraftFrom(next);
        return;
      }
      const [first, last] = [draftFrom, next].sort();
      setDraftFrom(null);
      onChange({ span, month: last, from: first });
      close();
      return;
    }
    onChange({ month: next, span });
    close();
  };
  // What lights up while hovering: the period the click would choose.
  const preview = hover && span !== "all" ? hover : null;
  const shown: { first: string; last: string } | null = (() => {
    if (custom && draftFrom) {
      const [first, last] = [draftFrom, preview ?? draftFrom].sort();
      return { first, last };
    }
    if (custom) return range;
    return preview ? periodMonths(span, preview) : range;
  })();
  const inBand = (m: string) => !!shown && m >= shown.first && m <= shown.last;
  const ends = (m: string) =>
    !!shown && (m === shown.first || m === shown.last);
  const selected = (m: string) =>
    custom
      ? !draftFrom && !!range && (m === range.first || m === range.last)
      : month === m && (!preview || preview === m);
  const previewing = (m: string) =>
    custom ? !!draftFrom && ends(m) : preview === m && preview !== month;

  function gridKeys(e: ReactKeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -3,
      ArrowDown: 3,
    };
    const delta = moves[e.key];
    const target = e.target as HTMLElement;
    const at = target.dataset.month;
    if (!delta || !at) return;
    e.preventDefault();
    const next = shiftMonth(at, delta);
    const ny = Number(next.slice(0, 4));
    if (ny !== year) setYear(ny);
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLButtonElement>(`[data-month="${next}"]`)
        ?.focus(),
    );
  }

  return (
    <div className="period-picker" ref={root}>
      <div className="period-bar">
        <button
          type="button"
          className="period-step"
          aria-label={`Previous ${span === "month" ? "month" : "period"}`}
          disabled={!step}
          onClick={() => shift(-step)}
        >
          <ChevronLeft size={17} />
        </button>
        <button
          ref={trigger}
          type="button"
          className="period-trigger"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-label={`${label}: ${title}. Change`}
          onClick={() => setOpen((o) => !o)}
        >
          <CalendarDays size={16} aria-hidden />
          <span className="period-trigger-text">{title}</span>
          <ChevronDown size={15} aria-hidden className="period-caret" />
        </button>
        <button
          type="button"
          className="period-step"
          aria-label={`Next ${span === "month" ? "month" : "period"}`}
          disabled={!step}
          onClick={() => shift(step)}
        >
          <ChevronRight size={17} />
        </button>
      </div>
      {span !== "all" && !periodContains(span, month, currentMonth, from) && (
        <button
          type="button"
          className="period-today"
          onClick={() => shift(monthsBetween(month, currentMonth) - 1)}
        >
          {span === "month" ? "This month" : "Back to now"}
        </button>
      )}
      {open && (
        <div
          className="period-panel"
          id={panelId}
          role="dialog"
          aria-label={`Choose ${label.toLowerCase()}`}
        >
          {choices.length > 0 && (
            <div className="period-spans" role="group" aria-label="Length">
              {choices.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  className={`period-span${s.value === span ? " is-active" : ""}`}
                  aria-pressed={s.value === span}
                  title={s.long}
                  onClick={() => {
                    setDraftFrom(null);
                    onChange({
                      month,
                      span: s.value,
                      from:
                        s.value === "custom" && range ? range.first : undefined,
                    });
                  }}
                >
                  {s.short}
                </button>
              ))}
            </div>
          )}
          {span === "all" ? (
            <p className="period-all-note">
              Showing every transaction. Pick a length above to browse by month.
            </p>
          ) : (
            <>
              <div className="period-year">
                <button
                  type="button"
                  className="period-step"
                  aria-label="Previous year"
                  onClick={() => setYear((y) => y - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <strong>{year}</strong>
                <button
                  type="button"
                  className="period-step"
                  aria-label="Next year"
                  onClick={() => setYear((y) => y + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <div
                className="period-months"
                onKeyDown={gridKeys}
                onPointerLeave={() => setHover(null)}
              >
                {Array.from({ length: 12 }, (_, i) => {
                  const m = `${year}-${String(i + 1).padStart(2, "0")}`;
                  const band = inBand(m);
                  const edgeStart = band && shown?.first === m;
                  const edgeEnd = band && shown?.last === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      data-month={m}
                      className={[
                        "period-month",
                        band && "in-band",
                        edgeStart && "band-start",
                        edgeEnd && "band-end",
                        month === m && "is-anchor",
                        selected(m) && "is-selected",
                        m === currentMonth && "is-current",
                        m > currentMonth && "is-future",
                        previewing(m) && "is-preview",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-pressed={
                        !!range && periodContains(span, month, m, from)
                      }
                      aria-label={`${custom ? periodLabel("month", m) : periodLabel(span, m)}${m === currentMonth ? " (this month)" : ""}`}
                      tabIndex={
                        month === m ||
                        (month.slice(0, 4) !== String(year) && i === 0)
                          ? 0
                          : -1
                      }
                      onPointerEnter={() => setHover(m)}
                      onFocus={() => setHover(m)}
                      onBlur={() => setHover(null)}
                      onClick={() => pick(m)}
                    >
                      {shortMonthName(i)}
                      {activeMonths?.has(m) && (
                        <span className="period-dot" aria-hidden />
                      )}
                    </button>
                  );
                })}
              </div>
              {custom ? (
                <p className="period-hint" aria-live="polite">
                  {draftFrom
                    ? `Now pick the last month · ${shown ? periodLabel("custom", shown.last, shown.first) : ""}`
                    : "Pick the first month, then the last"}
                </p>
              ) : (
                span !== "month" && (
                  <p className="period-hint">
                    Pick the last month · {periodLabel(span, preview ?? month)}
                  </p>
                )
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
