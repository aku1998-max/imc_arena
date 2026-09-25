/** Capabilities reported by GET /v1/me; clients use them for navigation only, never for security. */
export const CAPABILITIES = {
  practiceDaily: 'practice:daily',
  practiceTopic: 'practice:topic',
  practiceMistakes: 'practice:mistakes',
  progressBasic: 'progress:basic',
  progressHistory: 'progress:history',
  reportsCreate: 'reports:create',
  parentProfiles: 'parent:profiles',
  parentDevices: 'parent:devices',
  parentConsent: 'parent:consent',
  parentBilling: 'parent:billing',
  staffEdit: 'staff:edit',
  staffReview: 'staff:review',
  staffPublish: 'staff:publish',
  staffSupport: 'staff:support',
  staffManage: 'staff:manage',
} as const;
export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];
