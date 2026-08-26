/**
 * Trial analytics queries for Wajom.
 *
 * Mirrors the admin "User Free Trial" dashboard (wajom commit c6c7679):
 *   - message_counter = SUM(whatsapps.trial_sent_count) per user
 *   - status          = computeTrialStatus(...) from core/trial.ts
 *   - last_activity   = MAX(activity_tracking_events.created_at)
 *
 * These tools answer the questions raised in the Aug-2026 trial readout
 * (wajom-free-trial-august.vercel.app) and the SlugPost "mcpipditis"
 * brief: cohort funnel, paid_user/purchase_number audit, trial message
 * distribution, and conversion signals — all from data already in the DB.
 */

import { SqlDatabase } from "./db.ts";
import { stripPii } from "./pii.ts";
import { convertEpochs, parseDateRange, epochMsToIso, nowMs } from "./time.ts";
import {
  TRIAL,
  TRIAL_STATUS_LABELS,
  computeTrialStatus,
  type TrialStatus,
} from "./trial.ts";

type Row = Record<string, unknown>;

const DAY_MS = 86_400_000;

interface TrialListOpts {
  status?: string | null;
  search?: string | null;
  planId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  minMessages?: number | null;
  maxMessages?: number | null;
  limit?: number;
  offset?: number;
}

interface TrialRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  plan_id: string | null;
  is_verified: number;
  paid_user: number;
  purchase_number: number;
  purchase_amount: number;
  chat_gpt_token: number;
  created_at: number;
  membership_date: string | null;
  last_membership_date: string | null;
  message_counter: number;
  total_sent_count: number;
  chat_ai_sent_count: number;
  cap_reached_at: number | null;
  last_message_at: number | null;
  last_activity_at: number | null;
  activity_count: number;
  device_count: number;
  connected_devices: number;
  trial_expired_at: number;
  status: TrialStatus;
  status_label: string;
}

/**
 * Core query: trial-like users (no membership_date) joined with
 * aggregated whatsapp trial_sent_count + activity events.
 *
 * "Trial-like" = users without membership_date, matching the admin
 * dashboard definition. Returns enriched rows with computed status.
 */
function fetchTrialUsers(
  db: SqlDatabase,
  opts: TrialListOpts,
  forSingleId?: string
): TrialRow[] {
  const b: { clauses: string[]; params: unknown[] } = { clauses: [], params: [] };

  // Trial-like: no membership_date (never converted to paid membership).
  // Use IS NULL OR empty to be safe across schema versions.
  b.clauses.push("(u.membership_date IS NULL OR u.membership_date = '')");
  b.clauses.push("u.is_admin = 0");

  if (forSingleId) {
    b.clauses.push("u.id = ?");
    b.params.push(forSingleId);
  }
  if (opts.search) {
    b.clauses.push("(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)");
    const like = `%${opts.search}%`;
    b.params.push(like, like, like);
  }
  if (opts.planId) {
    b.clauses.push("u.plan_id = ?");
    b.params.push(opts.planId);
  }
  const [startMs, endMs] = parseDateRange(opts.dateFrom, opts.dateTo);
  if (startMs !== null) {
    b.clauses.push("u.created_at >= ?");
    b.params.push(startMs);
  }
  if (endMs !== null) {
    b.clauses.push("u.created_at <= ?");
    b.params.push(endMs);
  }

  const whereSql = `WHERE ${b.clauses.join(" AND ")}`;
  const now = nowMs();

  // Main join: users LEFT JOIN whatsapps (aggregate trial_sent_count).
  const rows = db.query<Row>(
    `SELECT
        u.id, u.name, u.email, u.phone, u.plan_id, u.is_verified,
        u.paid_user, u.purchase_number, u.purchase_amount, u.chat_gpt_token,
        u.created_at, u.membership_date, u.last_membership_date,
        COALESCE(SUM(w.trial_sent_count), 0) AS message_counter,
        COALESCE(SUM(w.total_sent_count), 0) AS total_sent_count,
        COALESCE(SUM(w.chat_ai_sent_count), 0) AS chat_ai_sent_count,
        MAX(w.cap_reached_at) AS cap_reached_at,
        MAX(w.updated_at) AS last_message_at,
        COUNT(w.id) AS device_count,
        SUM(CASE WHEN w.status = 'Connected' THEN 1 ELSE 0 END) AS connected_devices
      FROM users AS u
      LEFT JOIN whatsapps AS w ON w.user_id = u.id
        AND (w.delete_time IS NULL OR w.delete_time = 0)
      ${whereSql}
      GROUP BY u.id
      ORDER BY u.created_at DESC`,
    ...b.params
  );

  if (rows.length === 0) return [];

  // Activity events in a single pass.
  const userIds = rows.map((r) => r.id as string);
  const placeholders = userIds.map(() => "?").join(",");
  const activity = db.query<{ user_id: string; last_activity_at: number; activity_count: number }>(
    `SELECT user_id,
        MAX(created_at) AS last_activity_at,
        COUNT(id) AS activity_count
      FROM activity_tracking_events
      WHERE user_id IN (${placeholders})
      GROUP BY user_id`,
    ...userIds
  );
  const activityMap = new Map<string, { last_activity_at: number; activity_count: number }>();
  for (const a of activity) {
    activityMap.set(a.user_id, {
      last_activity_at: Number(a.last_activity_at),
      activity_count: Number(a.activity_count) || 0,
    });
  }

  const enriched: TrialRow[] = rows.map((r) => {
    const messageCounter = Number(r.message_counter) || 0;
    const createdAt = Number(r.created_at) || 0;
    const act = activityMap.get(r.id as string);
    const lastActivityAt = act ? act.last_activity_at : null;
    const status = computeTrialStatus({
      messageCounter,
      createdAt,
      lastActivityAt,
      purchaseNumber: Number(r.purchase_number) || 0,
      now,
    });
    return {
      id: r.id as string,
      name: r.name as string,
      email: r.email as string,
      phone: r.phone as string,
      plan_id: (r.plan_id as string | null) ?? null,
      is_verified: Number(r.is_verified) || 0,
      paid_user: Number(r.paid_user) || 0,
      purchase_number: Number(r.purchase_number) || 0,
      purchase_amount: Number(r.purchase_amount) || 0,
      chat_gpt_token: Number(r.chat_gpt_token) || 0,
      created_at: createdAt,
      membership_date: (r.membership_date as string | null) ?? null,
      last_membership_date: (r.last_membership_date as string | null) ?? null,
      message_counter: messageCounter,
      total_sent_count: Number(r.total_sent_count) || 0,
      chat_ai_sent_count: Number(r.chat_ai_sent_count) || 0,
      cap_reached_at: r.cap_reached_at ? Number(r.cap_reached_at) : null,
      last_message_at: r.last_message_at ? Number(r.last_message_at) : null,
      last_activity_at: lastActivityAt,
      activity_count: act ? act.activity_count : 0,
      device_count: Number(r.device_count) || 0,
      connected_devices: Number(r.connected_devices) || 0,
      trial_expired_at: createdAt + TRIAL.TRIAL_DURATION_DAYS * DAY_MS,
      status,
      status_label: TRIAL_STATUS_LABELS[status],
    };
  });

  // Post-filter by status / message range (computed fields, not in DB).
  let filtered = enriched;
  if (opts.status) {
    filtered = filtered.filter((r) => r.status === opts.status);
  }
  if (opts.minMessages !== null && opts.minMessages !== undefined) {
    filtered = filtered.filter((r) => r.message_counter >= (opts.minMessages as number));
  }
  if (opts.maxMessages !== null && opts.maxMessages !== undefined) {
    filtered = filtered.filter((r) => r.message_counter <= (opts.maxMessages as number));
  }

  // Pagination after filtering (computed status can't be paginated in SQL).
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  const offset = Math.max(0, opts.offset ?? 0);
  const paged = filtered.slice(offset, offset + limit);

  // Convert epochs to ISO for output.
  return paged.map((r) => ({
    ...r,
    created_at: epochMsToIso(r.created_at) ?? "",
    last_message_at: epochMsToIso(r.last_message_at),
    last_activity_at: epochMsToIso(r.last_activity_at),
    trial_expired_at: epochMsToIso(r.trial_expired_at) ?? "",
    cap_reached_at: epochMsToIso(r.cap_reached_at),
  })) as unknown as TrialRow[];
}

// --------------------------------------------------------------------- tools

export function listTrialUsers(db: SqlDatabase, opts: TrialListOpts): Row[] {
  if (!db.hasTable("users") || !db.hasTable("whatsapps")) {
    return [{ error: "required tables (users, whatsapps) not found" }];
  }
  return fetchTrialUsers(db, opts) as unknown as Row[];
}

export function getTrialUserDetail(db: SqlDatabase, userId: string): Row | undefined {
  if (!db.hasTable("users")) return undefined;
  const base = fetchTrialUsers(db, {}, userId);
  if (base.length === 0) return undefined;
  const user = base[0];

  // Daily activity events (closest proxy to engagement over time;
  // trial_sent_count is a running total, not time-series).
  let dailyActivity: Row[] = [];
  if (db.hasTable("activity_tracking_events")) {
    dailyActivity = db.query<Row>(
      `SELECT DATE(created_at / 1000, 'unixepoch') AS date,
              COUNT(*) AS count
         FROM activity_tracking_events
        WHERE user_id = ?
        GROUP BY DATE(created_at / 1000, 'unixepoch')
        ORDER BY date DESC
        LIMIT 30`,
      userId
    );
  }

  // Recent transactions.
  let transactions: Row[] = [];
  if (db.hasTable("sales")) {
    transactions = convertEpochs(
      stripPii(
        db.query<Row>(
          `SELECT * FROM sales WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`,
          userId
        ),
        "sales"
      ),
      ["created_at", "updated_at", "expired_time"]
    );
  }

  // Plan info.
  let plan: Row | null = null;
  if (user.plan_id && db.hasTable("plans")) {
    const p = db.queryOne<Row>("SELECT * FROM plans WHERE id = ?", user.plan_id);
    if (p) {
      plan = stripPii([p], "plans")[0] ?? null;
      if (plan) convertEpochs([plan]);
    }
  }

  // Devices.
  let devices: Row[] = [];
  if (db.hasTable("whatsapps")) {
    devices = convertEpochs(
      stripPii(
        db.query<Row>(
          `SELECT id, name, phone, status, trial_sent_count, created_at, updated_at
             FROM whatsapps
            WHERE user_id = ?
              AND (delete_time IS NULL OR delete_time = 0)
            ORDER BY updated_at DESC`,
          userId
        ),
        "whatsapps"
      )
    );
  }

  return {
    ...user,
    plan,
    devices,
    transactions,
    daily_activity: dailyActivity,
  };
}

export function trialStats(
  db: SqlDatabase,
  opts: { dateFrom?: string | null; dateTo?: string | null } = {}
): Record<string, unknown> {
  if (!db.hasTable("users") || !db.hasTable("whatsapps")) {
    return { error: "required tables (users, whatsapps) not found" };
  }
  const all = fetchTrialUsers(db, {
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
    limit: 200,
    offset: 0,
  });

  const total = all.length;
  const byStatus: Record<string, number> = {};
  let converted = 0;
  let verified = 0;
  let withDevices = 0;
  let withMessages = 0;
  let limitReached = 0;
  let capReachedCount = 0;
  let totalMessages = 0;
  let totalSentAll = 0;
  let totalChatAi = 0;
  let maxMessages = 0;

  // Message buckets: 0, 1-10, 11-25, 26-49, 50 (cap).
  const msgBuckets = { "0": 0, "1-10": 0, "11-25": 0, "26-49": 0, "50 (cap)": 0 };

  for (const u of all) {
    byStatus[u.status] = (byStatus[u.status] ?? 0) + 1;
    if (u.status === "converted") converted++;
    if (u.is_verified) verified++;
    if (u.device_count > 0) withDevices++;
    if (u.message_counter > 0) withMessages++;
    if (u.message_counter >= TRIAL.TRIAL_MESSAGE_LIMIT) limitReached++;
    if (u.cap_reached_at) capReachedCount++;
    totalMessages += u.message_counter;
    totalSentAll += u.total_sent_count || 0;
    totalChatAi += u.chat_ai_sent_count || 0;
    if (u.message_counter > maxMessages) maxMessages = u.message_counter;

    if (u.message_counter === 0) msgBuckets["0"]++;
    else if (u.message_counter <= 10) msgBuckets["1-10"]++;
    else if (u.message_counter <= 25) msgBuckets["11-25"]++;
    else if (u.message_counter < TRIAL.TRIAL_MESSAGE_LIMIT) msgBuckets["26-49"]++;
    else msgBuckets["50 (cap)"]++;
  }

  return {
    totals: {
      trial_users: total,
      converted,
      verified,
      with_devices: withDevices,
      with_messages: withMessages,
      limit_reached: limitReached,
      cap_reached: capReachedCount,
      conversion_rate: total ? +(converted / total * 100).toFixed(2) : 0,
      avg_messages: total ? +(totalMessages / total).toFixed(2) : 0,
      max_messages: maxMessages,
      total_messages: totalMessages,
      total_sent_count: totalSentAll,
      chat_ai_sent_count: totalChatAi,
    },
    by_status: byStatus,
    message_distribution: msgBuckets,
    thresholds: TRIAL,
  };
}

/**
 * Cohort funnel: signup -> verified -> has_device -> connected -> purchased.
 *
 * Directly implements recommendation #2 from the Aug-2026 trial readout:
 * "Buat dashboard cohort: signup -> verified -> connected -> purchase".
 *
 * Filters by signup date range (users.created_at).
 */
export function trialFunnel(
  db: SqlDatabase,
  opts: { dateFrom?: string | null; dateTo?: string | null } = {}
): Record<string, unknown> {
  if (!db.hasTable("users")) {
    return { error: "users table not found" };
  }
  const b: { clauses: string[]; params: unknown[] } = { clauses: [], params: [] };
  b.clauses.push("(u.membership_date IS NULL OR u.membership_date = '')");
  b.clauses.push("u.is_admin = 0");
  const [startMs, endMs] = parseDateRange(opts.dateFrom, opts.dateTo);
  if (startMs !== null) {
    b.clauses.push("u.created_at >= ?");
    b.params.push(startMs);
  }
  if (endMs !== null) {
    b.clauses.push("u.created_at <= ?");
    b.params.push(endMs);
  }
  const whereSql = `WHERE ${b.clauses.join(" AND ")}`;

  const signup = db.queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM users u ${whereSql}`,
    ...b.params
  );
  const total = signup?.c ?? 0;
  if (total === 0) {
    return { date_from: opts.dateFrom ?? null, date_to: opts.dateTo ?? null, stages: { signup: 0, verified: 0, has_device: 0, connected: 0, purchased: 0 }, conversion_pct: 0 };
  }

  const verified = db.queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM users u ${whereSql} AND u.is_verified = 1`,
    ...b.params
  )?.c ?? 0;

  // has_device: user has at least one non-deleted whatsapp.
  const hasDevice = db.queryOne<{ c: number }>(
    `SELECT COUNT(DISTINCT u.id) AS c
       FROM users u
       INNER JOIN whatsapps w ON w.user_id = u.id
         AND (w.delete_time IS NULL OR w.delete_time = 0)
      ${whereSql}`,
    ...b.params
  )?.c ?? 0;

  // connected: at least one device with status='Connected'.
  const connected = db.queryOne<{ c: number }>(
    `SELECT COUNT(DISTINCT u.id) AS c
       FROM users u
       INNER JOIN whatsapps w ON w.user_id = u.id
         AND (w.delete_time IS NULL OR w.delete_time = 0)
         AND w.status = 'Connected'
      ${whereSql}`,
    ...b.params
  )?.c ?? 0;

  // purchased: purchase_number > 0 OR a Purchase/Complete sale.
  const purchased = db.queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM users u ${whereSql}
      AND (u.purchase_number > 0
           OR u.id IN (SELECT user_id FROM sales WHERE status IN ('Purchase','Complete')))`,
    ...b.params
  )?.c ?? 0;

  const stages = { signup: total, verified, has_device: hasDevice, connected, purchased };
  const pct = (n: number) => total ? +(n / total * 100).toFixed(2) : 0;

  return {
    date_from: opts.dateFrom ?? null,
    date_to: opts.dateTo ?? null,
    stages,
    stage_pct: {
      signup: 100,
      verified: pct(verified),
      has_device: pct(hasDevice),
      connected: pct(connected),
      purchased: pct(purchased),
    },
    drop_off: {
      signup_to_verified: total - verified,
      verified_to_device: verified - hasDevice,
      device_to_connected: hasDevice - connected,
      connected_to_purchase: connected - purchased,
    },
  };
}

/**
 * Audit: reconcile paid status across multiple signals.
 *
 * The `paid_user` flag in users table is NEVER set by the payment flow.
 * The actual indicator is `membership_date` (set by UserController when
 * a sale completes). This audit cross-checks:
 *  - membership_date (actual paid indicator)
 *  - purchase_number (counter incremented on each sale)
 *  - sales table (Purchase/Complete status)
 *
 * Flags mismatch classes:
 *  - has_sale_no_membership: Purchase/Complete sale but no membership_date
 *  - purchase_number_no_membership: purchase_number > 0 but no membership_date
 *  - membership_no_sale: membership_date set but no Purchase/Complete sale
 *  - sale_no_purchase_number: has sale but purchase_number = 0
 */
export function paidUserAudit(
  db: SqlDatabase,
  opts: { limit?: number; offset?: number } = {}
): Record<string, unknown> {
  if (!db.hasTable("users") || !db.hasTable("sales")) {
    return { error: "required tables (users, sales) not found" };
  }

  // Aggregate counts first.
  const summary = db.queryOne<{
    total: number;
    paid_flagged: number;
    with_membership: number;
    with_purchase_number: number;
    with_purchase_sale: number;
    mismatch_paid_no_sale: number;
    mismatch_pnum_not_paid: number;
    mismatch_sale_no_pnum: number;
  }>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN paid_user = 1 THEN 1 ELSE 0 END) AS paid_flagged,
       SUM(CASE WHEN membership_date IS NOT NULL AND membership_date != '' THEN 1 ELSE 0 END) AS with_membership,
       SUM(CASE WHEN purchase_number > 0 THEN 1 ELSE 0 END) AS with_purchase_number,
       SUM(CASE WHEN id IN (SELECT user_id FROM sales WHERE status IN ('Purchase','Complete')) THEN 1 ELSE 0 END) AS with_purchase_sale,
       SUM(CASE WHEN (membership_date IS NOT NULL AND membership_date != '') AND id NOT IN (SELECT user_id FROM sales WHERE status IN ('Purchase','Complete')) THEN 1 ELSE 0 END) AS mismatch_paid_no_sale,
       SUM(CASE WHEN purchase_number > 0 AND (membership_date IS NULL OR membership_date = '') THEN 1 ELSE 0 END) AS mismatch_pnum_not_paid,
       SUM(CASE WHEN id IN (SELECT user_id FROM sales WHERE status IN ('Purchase','Complete')) AND purchase_number = 0 THEN 1 ELSE 0 END) AS mismatch_sale_no_pnum
      FROM users
      WHERE is_admin = 0`
  );

  // Detail rows: users with any mismatch, paginated.
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  const offset = Math.max(0, opts.offset ?? 0);
  const rows = db.query<Row>(
    `SELECT u.id, u.name, u.email, u.phone, u.paid_user, u.purchase_number,
            u.purchase_amount, u.created_at, u.membership_date,
            (SELECT COUNT(*) FROM sales s WHERE s.user_id = u.id AND s.status IN ('Purchase','Complete')) AS sale_count,
            (SELECT COALESCE(SUM(s.total),0) FROM sales s WHERE s.user_id = u.id AND s.status IN ('Purchase','Complete')) AS sale_total,
            (SELECT MAX(s.created_at) FROM sales s WHERE s.user_id = u.id AND s.status IN ('Purchase','Complete')) AS last_sale_at
       FROM users u
      WHERE u.is_admin = 0
        AND (
          ((u.membership_date IS NOT NULL AND u.membership_date != '') AND u.id NOT IN (SELECT user_id FROM sales WHERE status IN ('Purchase','Complete')))
          OR (u.purchase_number > 0 AND (u.membership_date IS NULL OR u.membership_date = ''))
          OR (u.id IN (SELECT user_id FROM sales WHERE status IN ('Purchase','Complete')) AND (u.membership_date IS NULL OR u.membership_date = ''))
          OR (u.id IN (SELECT user_id FROM sales WHERE status IN ('Purchase','Complete')) AND u.purchase_number = 0)
        )
      ORDER BY u.purchase_number DESC, u.created_at DESC
      LIMIT ? OFFSET ?`,
    limit,
    offset
  );

  const flagged = rows.map((r) => {
    const flags: string[] = [];
    const hasMembership = r.membership_date && r.membership_date !== "";
    const hasSale = Number(r.sale_count) > 0;
    if (hasSale && !hasMembership) flags.push("has_sale_no_membership");
    if (Number(r.purchase_number) > 0 && !hasMembership) flags.push("purchase_number_no_membership");
    if (hasMembership && !hasSale) flags.push("membership_no_sale");
    if (hasSale && Number(r.purchase_number) === 0) flags.push("sale_no_purchase_number");
    return { ...convertEpochs([r], ["created_at", "last_sale_at"])[0], mismatch_flags: flags };
  });

  return { summary, mismatches: flagged };
}
