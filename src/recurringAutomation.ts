export {
  buildMatchDismissKey,
  buildPatternKey,
  defaultDeterministicClassifier,
  inferCategoryHint,
  merchantSimilarity,
  normalizeMerchant,
  transactionLabel,
  type DetectableFrequency,
  type NormalizedMerchant,
  type PatternClassification,
  type PatternClassifier,
  type PatternFeatures,
  type RecurringCategoryHint,
} from "./recurringMerchant.ts";

export {
  DETECTION_BATCH_SIZE,
  MAX_DETECTION_TRANSACTIONS,
  detectRecurringPatterns,
  type DetectedPattern,
} from "./recurringDetection.ts";

export {
  AMBIGUITY_MARGIN,
  AUTO_LINK_THRESHOLD,
  REVIEW_MATCH_THRESHOLD,
  reconcileTransactions,
  type MatchCandidate,
  type ReconciliationResult,
} from "./recurringReconcile.ts";

export {
  analyzeScheduleHistory,
  buildIntelligentForecast,
  type AccountBalanceProjection,
  type ForecastItem,
  type HorizonSummary,
  type IntelligentForecast,
  type ScheduleHistoryProfile,
} from "./recurringForecast.ts";
