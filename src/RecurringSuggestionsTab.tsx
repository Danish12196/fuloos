import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  Check,
  ChevronDown,
  Info,
  Pencil,
  ReceiptText,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { money, type Ledger } from "./domain.ts";
import { transactionLabel } from "./recurringMerchant.ts";
import type { DetectedPattern } from "./recurringDetection.ts";
import type {
  MatchCandidate,
  ReconciliationResult,
} from "./recurringReconcile.ts";
import {
  categoryHintLabels,
  formatFullDate,
  formatShortDate,
  frequencyLabels,
} from "./RecurringView";

export function RecurringSuggestionsTab({
  ledger,
  detectedPatterns,
  reconciliation,
  suggestionsBadgeCount,
  busy,
  onAcceptPattern,
  onEditPattern,
  onDismissPattern,
  onConfirmMatchCandidate,
  onDismissMatchCandidate,
  onRunReconciliation,
}: {
  ledger: Ledger;
  detectedPatterns: DetectedPattern[];
  reconciliation: ReconciliationResult;
  suggestionsBadgeCount: number;
  busy: boolean;
  onAcceptPattern?: (pattern: DetectedPattern) => Promise<void> | void;
  onEditPattern?: (pattern: DetectedPattern) => void;
  onDismissPattern?: (patternKey: string) => Promise<void> | void;
  onConfirmMatchCandidate?: (candidate: MatchCandidate) => Promise<void> | void;
  onDismissMatchCandidate?: (matchKey: string) => Promise<void> | void;
  onRunReconciliation?: () => Promise<void> | void;
}) {
  const [expandedPattern, setExpandedPattern] = useState<string | null>(null);

  const accountById = useMemo(
    () => new Map(ledger.accounts.map((a) => [a.id, a])),
    [ledger.accounts],
  );
  const categoryById = useMemo(
    () => new Map(ledger.categories.map((c) => [c.id, c])),
    [ledger.categories],
  );

  const activePatterns = useMemo(
    () => detectedPatterns.filter((p) => p.status === "active"),
    [detectedPatterns],
  );
  const pastPatterns = useMemo(
    () => detectedPatterns.filter((p) => p.status === "ended"),
    [detectedPatterns],
  );

  const renderPatternCard = (pattern: DetectedPattern) => {
    const isExpanded = expandedPattern === pattern.patternKey;
    const cat = categoryById.get(pattern.categoryId ?? "");
    const acc = accountById.get(pattern.accountId);
    return (
      <article className="suggestion-card" key={pattern.patternKey}>
        <div className="card-top">
          <span className="card-kind-badge">
            <Sparkles size={14} />
            {categoryHintLabels[pattern.categoryHint] ?? pattern.categoryHint}
          </span>
          <span className={`confidence-pill ${pattern.confidenceTier}`}>
            {Math.round(pattern.confidence * 100)}%{" "}
            {pattern.confidenceTier === "high" ? "High" : "Medium"} confidence
          </span>
        </div>

        <div className="card-main">
          <div className="card-heading-row">
            <div>
              <h4>{pattern.displayName}</h4>
              <p className="card-subtitle">
                {frequencyLabels[pattern.frequency]} · {pattern.type} ·{" "}
                {acc?.name ?? "Account"} {cat ? `· ${cat.name}` : ""}
              </p>
              {pattern.status === "ended" && (
                <p className="card-subtitle">
                  Ended · paid {formatFullDate(pattern.firstDate)} –{" "}
                  {formatFullDate(pattern.lastDate)}
                </p>
              )}
            </div>
            <div className="card-amount">
              <b>
                {pattern.amountType === "variable" ? "~" : ""}
                {money(pattern.estimatedAmount)}
              </b>
              <small>
                {pattern.amountType === "variable"
                  ? `Range ${money(pattern.minAmount)} – ${money(pattern.maxAmount)}`
                  : "Consistent amount"}
              </small>
            </div>
          </div>

          <div className="pattern-explanation-box">
            <Info size={14} />
            <span>{pattern.explanation}</span>
          </div>

          <div className="supporting-disclosure">
            <button
              type="button"
              className="text-button small disclosure-btn"
              onClick={() =>
                setExpandedPattern(isExpanded ? null : pattern.patternKey)
              }
            >
              {isExpanded ? "Hide" : "View"}{" "}
              {pattern.supportingTransactions.length} supporting transactions
              <ChevronDown
                size={14}
                style={{
                  transform: isExpanded ? "rotate(180deg)" : "none",
                }}
              />
            </button>

            {isExpanded && (
              <div className="supporting-list">
                {pattern.supportingTransactions.map((tx) => (
                  <div className="supporting-row" key={tx.id}>
                    <span>{formatShortDate(tx.date)}</span>
                    <span className="supporting-payee">
                      {transactionLabel(tx)}
                    </span>
                    <b>{money(tx.amount)}</b>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card-actions">
          <button
            type="button"
            className="secondary compact-btn"
            disabled={busy}
            onClick={() => onDismissPattern?.(pattern.patternKey)}
          >
            Dismiss
          </button>
          <button
            type="button"
            className="secondary compact-btn"
            disabled={busy}
            onClick={() => onEditPattern?.(pattern)}
          >
            <Pencil size={13} /> Edit &amp; create
          </button>
          <button
            type="button"
            className="primary compact-btn"
            disabled={busy}
            onClick={() => onAcceptPattern?.(pattern)}
          >
            <Check size={14} />{" "}
            {pattern.status === "ended"
              ? "Add to history"
              : "Accept & schedule"}
          </button>
        </div>
      </article>
    );
  };

  return (
    <section className="panel section suggestions-tab-content">
      <div className="panel-heading recurring-panel-head">
        <div>
          <h2>
            Recurring suggestions &amp; match reviews{" "}
            <span className="count">{suggestionsBadgeCount}</span>
          </h2>
          <p>
            Statistical pattern detection across your transaction history and
            bank imports. Nothing is scheduled or altered until you accept.
          </p>
        </div>
        {onRunReconciliation && (
          <button
            type="button"
            className="secondary compact-btn"
            disabled={busy}
            onClick={onRunReconciliation}
          >
            <RefreshCw size={14} /> Scan transactions
          </button>
        )}
      </div>

      {reconciliation.reviewCandidates.length > 0 && (
        <div className="review-candidates-block">
          <div className="sub-block-heading">
            <span className="eyebrow amber">MATCH CONFIRMATION NEEDED</span>
            <h3>
              Transactions matching existing schedules (
              {reconciliation.reviewCandidates.length})
            </h3>
            <p>
              These transactions resemble your scheduled payments but had slight
              amount/date variance or multiple possible matches.
            </p>
          </div>

          <div className="suggestion-cards-grid">
            {reconciliation.reviewCandidates.map((candidate) => (
              <article
                className="suggestion-card review-card"
                key={candidate.matchKey}
              >
                <div className="card-top">
                  <span className="card-kind-badge">
                    {candidate.schedule.type === "income" ? (
                      <ArrowDownLeft size={14} />
                    ) : (
                      <ReceiptText size={14} />
                    )}
                    Match Candidate
                  </span>
                  <span className="confidence-pill medium">
                    {Math.round(candidate.confidence * 100)}% match
                  </span>
                </div>

                <div className="card-main">
                  <h4>{candidate.schedule.name}</h4>
                  <p className="card-detail-line">
                    Scheduled for{" "}
                    <b>{formatShortDate(candidate.occurrenceDate)}</b> (
                    {money(candidate.schedule.amount)})
                  </p>

                  <div className="match-tx-preview">
                    <span className="preview-label">Bank transaction:</span>
                    <b>{transactionLabel(candidate.transaction)}</b>
                    <span>
                      {formatShortDate(candidate.transaction.date)} ·{" "}
                      {money(candidate.transaction.amount)}
                    </span>
                  </div>

                  <div className="reasons-pill-row">
                    {candidate.reasons.map((r) => (
                      <span className="reason-tag" key={r}>
                        {r}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="card-actions">
                  <button
                    type="button"
                    className="secondary compact-btn"
                    disabled={busy}
                    onClick={() =>
                      onDismissMatchCandidate?.(candidate.matchKey)
                    }
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    className="primary compact-btn"
                    disabled={busy}
                    onClick={() => onConfirmMatchCandidate?.(candidate)}
                  >
                    <Check size={14} /> Confirm match
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      <div className="detected-patterns-block">
        <div className="sub-block-heading">
          <span className="eyebrow green">UNSCHEDULED RECURRING PATTERNS</span>
          <h3>Discovered from your history ({activePatterns.length})</h3>
          <p>
            Deterministic frequency analysis over your historical transactions
            and bank statements.
          </p>
        </div>

        {activePatterns.length ? (
          <div className="suggestion-cards-grid">
            {activePatterns.map(renderPatternCard)}
          </div>
        ) : (
          <div className="empty">
            <Check size={28} />
            <h3>All caught up</h3>
            <p>
              No unscheduled recurring patterns detected in your recent
              transactions. As you record transactions or import bank
              statements, new patterns will appear here.
            </p>
          </div>
        )}
      </div>

      {pastPatterns.length > 0 && (
        <div className="detected-patterns-block">
          <div className="sub-block-heading">
            <span className="eyebrow">PAST RECURRING PAYMENTS</span>
            <h3>Stopped series ({pastPatterns.length})</h3>
            <p>
              Subscriptions, instalments and bills that used to repeat but have
              stopped. Adding one keeps it as an ended schedule with its
              payments linked, without any future due dates.
            </p>
          </div>
          <div className="suggestion-cards-grid">
            {pastPatterns.map(renderPatternCard)}
          </div>
        </div>
      )}
    </section>
  );
}
