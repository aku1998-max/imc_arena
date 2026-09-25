/**
 * Product defaults from the specification. They are configurable defaults, not hard rules;
 * change them here (or via environment in the apps) and record the change in docs/decisions.md.
 */
export const productDefaults = {
  dailyQuestionCount: 5,
  topicQuestionCount: 5,
  mistakesQuestionCount: 5,
  /** Target difficulty mix for a five-item session: two easy, two medium, one harder. */
  difficultyMix: { 1: 2, 2: 2, 3: 1 } as Record<1 | 2 | 3, number>,
  recentRepeatDays: 7,
  childSessionDays: 7,
  adultGrantMinutes: 5,
  signedUrlSeconds: 300,
  idempotencyHours: 24,
  weeklyActivityGoal: 3,
  freeHistoryDays: 14,
  proHistoryDays: 366,
  maxProgressRangeDays: 366,
  purchaseIntentMinutes: 60,
  exportRetentionDays: 7,
  expiredTokenPurgeDays: 30,
  jobMaxAttempts: 8,
  jobLeaseSeconds: 120,
  reportRateLimitPerHour: 10,
  scoringVersion: 1,
  rewards: { sessionComplete: 10, perfectSession: 5 },
} as const;

export type ProductDefaults = typeof productDefaults;
