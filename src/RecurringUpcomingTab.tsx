import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  Calendar,
  Check,
  List,
  ReceiptText,
  Unlink,
} from "lucide-react";
import { confirmDialog } from "./dialogStore";
import { PeriodPicker } from "./PeriodPicker";
import { today, type Ledger, type RecurringSchedule } from "./domain.ts";
import {
  addDays,
  daysInMonth,
  formatIsoDate,
  listOccurrences,
  monthRange,
  parseIsoDate,
  type OccurrenceItem,
} from "./recurring.ts";
import type { ForecastItem, IntelligentForecast } from "./recurringForecast.ts";
import {
  formatFullDate,
  formatShortDate,
  statusLabels,
} from "./RecurringView";

export function RecurringUpcomingTab({
  ledger,
  asOf,
  forecast,
  concealed,
  busy,
  onConfirmOccurrence,
  onUnlinkOccurrence,
}: {
  ledger: Ledger;
  asOf: string;
  forecast: IntelligentForecast;
  concealed: (v: number) => string;
  busy: boolean;
  onConfirmOccurrence: (s: RecurringSchedule, date: string) => void;
  onUnlinkOccurrence: (occurrenceId: string) => void;
}) {
  const [upcomingView, setUpcomingView] = useState<"timeline" | "calendar">(
    "timeline",
  );
  const [horizonDays, setHorizonDays] = useState<30 | 60 | 90>(30);
  const [calMonth, setCalMonth] = useState(asOf.slice(0, 7));

  const accountById = useMemo(
    () => new Map(ledger.accounts.map((a) => [a.id, a])),
    [ledger.accounts],
  );

  const upcomingFilteredItems = useMemo(() => {
    if (upcomingView !== "timeline") return [];
    const toDate = addDays(asOf, horizonDays);
    return forecast.upcomingItems.filter(
      (it) => it.scheduledDate >= asOf && it.scheduledDate <= toDate,
    );
  }, [forecast.upcomingItems, asOf, horizonDays, upcomingView]);

  const calendarData = useMemo(() => {
    if (upcomingView !== "calendar") {
      return {
        cells: [] as (
          | { day: number; date: string; items: OccurrenceItem[] }
          | null
        )[],
        items: [] as OccurrenceItem[],
      };
    }
    const { start, end } = monthRange(calMonth);
    const items = listOccurrences(ledger, start, end, {
      asOfDate: asOf,
      includeConfirmed: true,
      includePaused: false,
    });
    const byDate = new Map<string, OccurrenceItem[]>();
    for (const item of items) {
      const list = byDate.get(item.date) ?? [];
      list.push(item);
      byDate.set(item.date, list);
    }
    const parsed = parseIsoDate(start)!;
    const firstWeekday =
      (new Date(Date.UTC(parsed.year, parsed.month - 1, 1)).getUTCDay() + 6) %
      7; // Monday = 0
    const totalDays = daysInMonth(parsed.year, parsed.month);
    const cells: ({ day: number; date: string; items: OccurrenceItem[] } | null)[] =
      [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let day = 1; day <= totalDays; day++) {
      const date = formatIsoDate(parsed.year, parsed.month, day);
      cells.push({ day, date, items: byDate.get(date) ?? [] });
    }
    return { cells, items };
  }, [ledger, calMonth, asOf, upcomingView]);

  return (
    <section className="panel section">
      <div className="panel-heading recurring-panel-head">
        <div>
          <h2>Intelligent upcoming forecast</h2>
          <p>
            {upcomingView === "timeline"
              ? `Chronological schedule and predicted clearing dates for the next ${horizonDays} days`
              : "Monthly calendar view of recurring occurrences"}
          </p>
        </div>
        <div className="recurring-head-actions">
          {upcomingView === "timeline" && (
            <div
              className="status-tabs"
              role="tablist"
              aria-label="Forecast horizon"
            >
              {([30, 60, 90] as const).map((h) => (
                <button
                  key={h}
                  type="button"
                  role="tab"
                  aria-selected={horizonDays === h}
                  className={horizonDays === h ? "active" : ""}
                  onClick={() => setHorizonDays(h)}
                >
                  {h} days
                </button>
              ))}
            </div>
          )}
          <div
            className="status-tabs"
            role="tablist"
            aria-label="Upcoming view mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={upcomingView === "timeline"}
              className={upcomingView === "timeline" ? "active" : ""}
              onClick={() => setUpcomingView("timeline")}
            >
              <List size={15} /> Chronological
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={upcomingView === "calendar"}
              className={upcomingView === "calendar" ? "active" : ""}
              onClick={() => setUpcomingView("calendar")}
            >
              <Calendar size={15} /> Calendar
            </button>
          </div>
        </div>
      </div>

      {upcomingView === "timeline" ? (
        upcomingFilteredItems.length ? (
          <div className="transaction-list">
            {upcomingFilteredItems.map((item: ForecastItem) => {
              const account = accountById.get(item.schedule.account_id);
              return (
                <div
                  className="transaction-row recurring-occ-row"
                  key={`${item.schedule.id}:${item.scheduledDate}`}
                >
                  <div className="transaction-main as-static">
                    <span className={`transaction-icon ${item.schedule.type}`}>
                      {item.status === "paid" ? (
                        <Check size={18} />
                      ) : item.schedule.type === "income" ? (
                        <ArrowDownLeft size={18} />
                      ) : (
                        <ReceiptText size={18} />
                      )}
                    </span>
                    <span className="transaction-description">
                      <b className="recurring-title-line">
                        <span>{item.schedule.name}</span>
                        <span className={`status-pill ${item.status}`}>
                          {statusLabels[item.status]}
                        </span>
                        {item.schedule.amount_type === "variable" &&
                          !item.isConfirmed && (
                            <span className="mini-tag variable">Variable</span>
                          )}
                      </b>
                      <small>
                        Scheduled {formatFullDate(item.scheduledDate)}
                        {item.offsetDays !== 0 && !item.isConfirmed && (
                          <span className="predicted-hint">
                            {" "}
                            · Predicted {formatShortDate(item.predictedDate)} (
                            {item.offsetDays > 0
                              ? `+${item.offsetDays}d`
                              : `${item.offsetDays}d`}
                            )
                          </span>
                        )}{" "}
                        · {account?.name ?? "Account"} · {item.explanation}
                      </small>
                    </span>
                    <span className="transaction-value">
                      <b
                        className={
                          item.schedule.type === "income" ? "green-text" : ""
                        }
                      >
                        {item.hasRange ? "~" : ""}
                        {item.schedule.type === "income" ? "+" : "−"}
                        {concealed(item.expectedAmount)}
                      </b>
                      <small>
                        {item.hasRange
                          ? `Range ${concealed(item.lowAmount)} – ${concealed(item.highAmount)}`
                          : item.isConfirmed
                            ? "Recorded"
                            : "Expected"}
                      </small>
                    </span>
                  </div>
                  <div className="recurring-actions">
                    {item.isConfirmed && item.confirmation ? (
                      <button
                        type="button"
                        className="icon-button"
                        disabled={busy}
                        title="Unlink confirmation"
                        aria-label={`Unlink ${item.schedule.name} on ${item.scheduledDate}`}
                        onClick={() =>
                          onUnlinkOccurrence(item.confirmation!.id)
                        }
                      >
                        <Unlink size={15} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="secondary compact-btn"
                        disabled={busy}
                        onClick={() =>
                          onConfirmOccurrence(item.schedule, item.scheduledDate)
                        }
                      >
                        Mark paid
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty">
            <Calendar size={28} />
            <h3>No payments in the next {horizonDays} days</h3>
            <p>
              Active schedules with upcoming payments in this window will appear
              here.
            </p>
          </div>
        )
      ) : (
        <div className="recurring-calendar-wrap">
          <div className="calendar-toolbar">
            <PeriodPicker
              label="Calendar month"
              month={calMonth}
              currentMonth={today().slice(0, 7)}
              onChange={(next) => setCalMonth(next.month)}
            />
            <span className="muted small">
              {calendarData.items.length} scheduled in month
            </span>
          </div>
          <div className="calendar-grid">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div className="calendar-weekday" key={d}>
                {d}
              </div>
            ))}
            {calendarData.cells.map((cell, idx) =>
              cell ? (
                <div
                  key={cell.date}
                  className={`calendar-cell ${cell.date === asOf ? "today" : ""}`}
                >
                  <span className="calendar-day">{cell.day}</span>
                  <div className="calendar-events">
                    {cell.items.map((ev) => (
                      <button
                        key={`${ev.schedule.id}:${ev.date}`}
                        type="button"
                        disabled={busy}
                        className={`calendar-chip ${ev.status} ${ev.schedule.type}`}
                        title={`${ev.schedule.name} · ${concealed(ev.linkedTransaction?.amount ?? ev.schedule.amount)} (${statusLabels[ev.status]}${ev.confirmation ? " — click to unlink" : ""})`}
                        onClick={async () => {
                          if (ev.confirmation) {
                            const confirmationId = ev.confirmation.id;
                            const ok = await confirmDialog({
                              title: `Unlink ${ev.schedule.name}?`,
                              message: `This removes the confirmation for ${formatFullDate(ev.date)}. The recorded ledger transaction will remain untouched.`,
                              confirmLabel: "Unlink",
                            });
                            if (ok) onUnlinkOccurrence(confirmationId);
                          } else {
                            onConfirmOccurrence(ev.schedule, ev.date);
                          }
                        }}
                      >
                        <span>{ev.schedule.name}</span>
                        <b>
                          {concealed(
                            ev.linkedTransaction?.amount ?? ev.schedule.amount,
                          )}
                        </b>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="calendar-cell empty-cell" key={`pad-${idx}`} />
              ),
            )}
          </div>
        </div>
      )}
    </section>
  );
}
