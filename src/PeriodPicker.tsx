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
  span = "month",
  spans,
  currentMonth,
  activeMonths,
  onChange,
  label = "Period",
}: {
  /** The last month in the period ("YYYY-MM"). */
  month: string;
  span?: PeriodSpan;
  /** Span choices to offer. Leave out for a month-only picker. */
  spans?: PeriodSpan[];
  currentMonth: string;
  /** Months that have activity; they get a small dot in the grid. */
  activeMonths?: Set<string>;
  onChange: (next: { month: string; span: PeriodSpan }) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const [hover, setHover] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const step = periodStep(span);
  const range = periodMonths(span, month);
  const choices = spans
    ? PERIOD_SPANS.filter((s) => spans.includes(s.value))
    : [];

  useEffect(() => {
    if (!open) return;
    setYear(Number(month.slice(0, 4)));
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

  const pick = (next: string) => {
    onChange({ month: next, span });
    setOpen(false);
    trigger.current?.focus();
  };
  // Which months light up while hovering: the period that would end there.
  const preview = hover && span !== "all" ? hover : null;
  const inBand = (m: string) =>
    preview
      ? periodContains(span, preview, m)
      : !!range && periodContains(span, month, m);

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
          onClick={() => onChange({ month: shiftMonth(month, -step), span })}
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
          aria-label={`${label}: ${periodLabel(span, month)}. Change`}
          onClick={() => setOpen((o) => !o)}
        >
          <CalendarDays size={16} aria-hidden />
          <span className="period-trigger-text">
            {periodLabel(span, month)}
          </span>
          <ChevronDown size={15} aria-hidden className="period-caret" />
        </button>
        <button
          type="button"
          className="period-step"
          aria-label={`Next ${span === "month" ? "month" : "period"}`}
          disabled={!step}
          onClick={() => onChange({ month: shiftMonth(month, step), span })}
        >
          <ChevronRight size={17} />
        </button>
      </div>
      {span !== "all" && !periodContains(span, month, currentMonth) && (
        <button
          type="button"
          className="period-today"
          onClick={() => onChange({ month: currentMonth, span })}
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
                  onClick={() => onChange({ month, span: s.value })}
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
                  const anchor = (preview ?? month) === m;
                  const band = inBand(m);
                  const range2 = periodMonths(span, preview ?? month);
                  const edgeStart = band && range2?.first === m;
                  const edgeEnd = band && range2?.last === m;
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
                        month === m &&
                          (!preview || preview === m) &&
                          "is-selected",
                        m === currentMonth && "is-current",
                        m > currentMonth && "is-future",
                        anchor && preview && preview !== month && "is-preview",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-pressed={month === m}
                      aria-label={`${periodLabel(span, m)}${m === currentMonth ? " (this month)" : ""}`}
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
              {span !== "month" && (
                <p className="period-hint">
                  Pick the last month · {periodLabel(span, preview ?? month)}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
