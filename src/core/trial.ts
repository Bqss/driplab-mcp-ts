/**
 * Trial status logic — ported from wajom/app/constants/trial.ts (commit c6c7679).
 *
 * Kept in sync with the app so MCP-computed statuses match the admin
 * "User Free Trial" dashboard exactly. Thresholds live here as constants;
 * tune them in both places if they change.
 */

export const TRIAL = {
  /** Window after signup where a user is still "golden" for follow-up. */
  GOLDEN_TIME_DAYS: 3,
  /** Total duration of the free trial period, counted from created_at. */
  TRIAL_DURATION_DAYS: 7,
  /** Max outbound messages allowed during trial. */
  TRIAL_MESSAGE_LIMIT: 50,
  /** Days without activity before an active user is considered dormant. */
  DORMANT_DAYS: 5,
} as const;

export type TrialStatus =
  | "converted"
  | "trial_limit_reached"
  | "trial_expired"
  | "active"
  | "golden_time"
  | "dormant";

export const TRIAL_STATUS_LABELS: Record<TrialStatus, string> = {
  converted: "Converted",
  trial_limit_reached: "Trial Limit Reached",
  trial_expired: "Trial Expired",
  active: "Active",
  golden_time: "Golden Time",
  dormant: "Dormant",
};

/**
 * Compute trial status from user activity signals.
 *
 * Priority (highest first):
 *  1. Converted           — has made a purchase
 *  2. Trial Limit Reached — message counter hit the cap
 *  3. Trial Expired       — trial duration elapsed without purchase
 *  4. Active              — sent messages and active recently
 *  5. Golden Time         — freshly registered, still in golden window
 *  6. Dormant             — registered but no meaningful activity
 */
export function computeTrialStatus(args: {
  messageCounter: number;
  createdAt: number;
  lastActivityAt: number | null;
  purchaseNumber: number;
  now?: number;
}): TrialStatus {
  const now = args.now ?? Date.now();
  const ageDays = (now - args.createdAt) / 86_400_000;
  const lastActivityDaysAgo =
    args.lastActivityAt != null
      ? (now - args.lastActivityAt) / 86_400_000
      : null;

  if (args.purchaseNumber > 0) return "converted";
  if (args.messageCounter >= TRIAL.TRIAL_MESSAGE_LIMIT)
    return "trial_limit_reached";
  if (ageDays > TRIAL.TRIAL_DURATION_DAYS) return "trial_expired";
  if (
    args.messageCounter > 0 &&
    lastActivityDaysAgo != null &&
    lastActivityDaysAgo <= TRIAL.DORMANT_DAYS
  )
    return "active";
  if (ageDays <= TRIAL.GOLDEN_TIME_DAYS) return "golden_time";
  return "dormant";
}
