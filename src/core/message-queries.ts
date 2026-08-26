/**
 * Message statistics queries — aggregate outbound message counts from
 * WhatsApp server (wajom-client) instances via HTTP API.
 *
 * Arsitektur: setiap WhatsApp device = 1 WA server instance dengan
 * HTTP endpoint sendiri (whatsapps.connect_url). MCP memanggil:
 *   GET {connect_url}/api/queue/stats?date_from=&date_to=
 *
 * Tidak perlu akses filesystem ke WA server DB — cukup HTTP.
 * Bisa jalan bahkan ketika MCP dan WA server di VPS berbeda.
 *
 * Dua sumber data:
 *   1. Portal DB (whatsapps table): total_sent_count, chat_ai_sent_count,
 *      trial_sent_count, cap_reached_at — persistent running totals.
 *   2. WA server HTTP API: queue status breakdown, daily counts,
 *      recent messages — current queue only (may be cleared by admin).
 *
 * Jawab pertanyaan SlugPost "mcpipditis":
 *   - Berapa pesan terkirim oleh paid user?  → portal_total_sent
 *   - Berapa pesan terkirim oleh free user?  → portal_total_sent
 *   - Per-device breakdown by status.         → WA server API
 *   - Pesan Chat AI per user?                → portal_chat_ai_sent
 *   - Free user cap 100% lalu upgrade?        → cap_reached_at + sales
 */

import { SqlDatabase } from "./db.ts";
import { stripPii } from "./pii.ts";
import { epochMsToIso } from "./time.ts";
import { fetchQueueStats, fetchQueueStatsBatch, type QueueStatsResponse } from "./wa-server-api.ts";

type Row = Record<string, unknown>;

/**
 * Definition of "paid" in Wajom:
 *   membership_date IS NOT NULL AND membership_date > today
 *
 * The `paid_user` flag in users table is NEVER set by the payment flow.
 * The actual indicator is `membership_date` (set by UserController when
 * a sale completes). We use it as the source of truth for paid status.
 */
const PAID_CLAUSE = "(u.membership_date IS NOT NULL AND u.membership_date != '' AND u.membership_date > date('now'))";
const FREE_CLAUSE = "(u.membership_date IS NULL OR u.membership_date = '' OR u.membership_date <= date('now'))";

/** Check if a user is paid based on membership_date (in JS, not SQL). */
function isPaid(membershipDate: string | null): boolean {
  if (!membershipDate || membershipDate === "") return false;
  const today = new Date().toISOString().slice(0, 10);
  return membershipDate > today;
}

interface DeviceMessageCount {
  whatsapp_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  phone: string;
  status: string;
  port: number | null;
  connect_url: string | null;
  paid_user: boolean;
  membership_date: string | null;
  plan_id: string | null;
  sent_count: number;
  read_count: number;
  failed_count: number;
  waiting_count: number;
  total_queue: number;
  db_found: boolean;
  portal_total_sent: number;
  portal_chat_ai_sent: number;
  portal_trial_sent: number;
  cap_reached_at: number | null;
}

/**
 * Aggregate message stats per user (paid vs free).
 *
 * Baca portal DB untuk user/device info + portal counters.
 * Hit WA server HTTP API untuk queue status breakdown.
 * Group per user, return summary + per-user breakdown.
 */
export async function messageStatsByUser(
  mainDb: SqlDatabase,
  _waServerDbDir: string, // kept for backward compat, unused (HTTP mode)
  opts: {
    paidOnly?: boolean | null;
    freeOnly?: boolean | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    limit?: number;
    offset?: number;
  } = {}
): Promise<Record<string, unknown>> {
  if (!mainDb.hasTable("whatsapps")) {
    return { error: "whatsapps table not found in main DB" };
  }
  if (!mainDb.hasTable("users")) {
    return { error: "users table not found in main DB" };
  }

  // Ambil semua device non-deleted + join user info + connect_url.
  // Definisi paid: membership_date > today (paid_user flag tidak pernah di-set).
  const b: { clauses: string[]; params: unknown[] } = { clauses: [], params: [] };
  b.clauses.push("(w.delete_time IS NULL OR w.delete_time = 0)");
  if (opts.paidOnly === true) b.clauses.push(PAID_CLAUSE);
  if (opts.freeOnly === true) b.clauses.push(FREE_CLAUSE);

  // Detect schema: trial_sent_count and cap_reached_at may not exist (e.g. dripsender)
  const waCols = mainDb.query<{ name: string }>("PRAGMA table_info(whatsapps)");
  const hasTrialSent = waCols.some((c) => c.name === "trial_sent_count");
  const hasCapReached = waCols.some((c) => c.name === "cap_reached_at");

  const whereSql = `WHERE ${b.clauses.join(" AND ")}`;
  const devices = mainDb.query<{
    id: string;
    user_id: string;
    phone: string;
    status: string;
    port: number | null;
    connect_url: string | null;
    user_name: string;
    user_email: string;
    membership_date: string | null;
    plan_id: string | null;
    total_sent_count: number;
    chat_ai_sent_count: number;
    trial_sent_count: number;
    cap_reached_at: number | null;
  }>(
    `SELECT w.id, w.user_id, w.phone, w.status, w.port, w.connect_url,
            u.name AS user_name, u.email AS user_email,
            u.membership_date, u.plan_id,
            COALESCE(w.total_sent_count, 0) AS total_sent_count,
            COALESCE(w.chat_ai_sent_count, 0) AS chat_ai_sent_count,
            ${hasTrialSent ? "COALESCE(w.trial_sent_count, 0)" : "0"} AS trial_sent_count,
            ${hasCapReached ? "w.cap_reached_at" : "NULL"} AS cap_reached_at
       FROM whatsapps w
       INNER JOIN users u ON u.id = w.user_id
      ${whereSql}
      ORDER BY u.created_at DESC`,
    ...b.params
  );

  // Fetch queue stats from WA server instances via HTTP (batch, parallel).
  const devicesWithUrl = devices
    .filter((d) => d.connect_url)
    .map((d) => ({ id: d.id, connect_url: d.connect_url! }));
  const queueStatsMap = await fetchQueueStatsBatch(devicesWithUrl, {
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
  });

  // Build per-device results.
  const perDevice: DeviceMessageCount[] = [];
  for (const d of devices) {
    const stats = queueStatsMap.get(d.id);
    let counts = { sent: 0, read: 0, failed: 0, waiting: 0, total: 0 };
    let dbFound = false;

    if (stats) {
      dbFound = true;
      counts = {
        sent: stats.by_status["sent"] || 0,
        read: stats.by_status["read"] || 0,
        failed: (stats.by_status["failed"] || 0) + (stats.by_status["stop"] || 0),
        waiting: (stats.by_status["waiting"] || 0) + (stats.by_status["sending"] || 0),
        total: stats.total || 0,
      };
    }

    perDevice.push({
      whatsapp_id: d.id,
      user_id: d.user_id,
      user_name: d.user_name,
      user_email: d.user_email,
      phone: d.phone,
      status: d.status,
      port: d.port,
      connect_url: d.connect_url,
      paid_user: isPaid(d.membership_date),
      membership_date: d.membership_date,
      plan_id: d.plan_id,
      sent_count: counts.sent,
      read_count: counts.read,
      failed_count: counts.failed,
      waiting_count: counts.waiting,
      total_queue: counts.total,
      db_found: dbFound,
      portal_total_sent: d.total_sent_count,
      portal_chat_ai_sent: d.chat_ai_sent_count,
      portal_trial_sent: d.trial_sent_count,
      cap_reached_at: d.cap_reached_at,
    });
  }

  // Group per user.
  const byUser = new Map<string, {
    user_id: string;
    user_name: string;
    user_email: string;
    paid_user: boolean;
    membership_date: string | null;
    plan_id: string | null;
    device_count: number;
    devices_with_db: number;
    sent_count: number;
    read_count: number;
    failed_count: number;
    waiting_count: number;
    total_queue: number;
    portal_total_sent: number;
    portal_chat_ai_sent: number;
    portal_trial_sent: number;
    cap_reached_at: number | null;
  }>();

  for (const d of perDevice) {
    let u = byUser.get(d.user_id);
    if (!u) {
      u = {
        user_id: d.user_id,
        user_name: d.user_name,
        user_email: d.user_email,
        paid_user: d.paid_user,
        membership_date: d.membership_date,
        plan_id: d.plan_id,
        device_count: 0,
        devices_with_db: 0,
        sent_count: 0,
        read_count: 0,
        failed_count: 0,
        waiting_count: 0,
        total_queue: 0,
        portal_total_sent: 0,
        portal_chat_ai_sent: 0,
        portal_trial_sent: 0,
        cap_reached_at: null,
      };
      byUser.set(d.user_id, u);
    }
    u.device_count++;
    if (d.db_found) u.devices_with_db++;
    u.sent_count += d.sent_count;
    u.read_count += d.read_count;
    u.failed_count += d.failed_count;
    u.waiting_count += d.waiting_count;
    u.total_queue += d.total_queue;
    u.portal_total_sent += d.portal_total_sent;
    u.portal_chat_ai_sent += d.portal_chat_ai_sent;
    u.portal_trial_sent += d.portal_trial_sent;
    if (d.cap_reached_at && (!u.cap_reached_at || d.cap_reached_at < u.cap_reached_at)) {
      u.cap_reached_at = d.cap_reached_at;
    }
  }

  let users = Array.from(byUser.values()).sort((a, b) => b.total_queue - a.total_queue);

  // Pagination.
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  const offset = Math.max(0, opts.offset ?? 0);
  const paged = users.slice(offset, offset + limit);

  // Summary: paid vs free, with free split into never_paid vs expired.
  // NOTE: avg_*_messages uses portal_total_sent (persistent counters from backfill
  // + increment), NOT queue scan. Queue scan only covers devices reachable via
  // HTTP (often <20% of devices), so using it for averages would massively
  // undercount. Portal counters cover ALL devices regardless of HTTP reachability.
  //
  // "free" is split because membership_date <= today includes EXPIRED paid users
  // who accumulated thousands of messages while active. Mixing them with true
  // trial users (never paid) skews the free average up significantly.
  const paidUsers = users.filter((u) => u.paid_user);
  const freeUsers = users.filter((u) => !u.paid_user);
  // free = never_paid (no membership_date) + expired (membership_date in past)
  const today = new Date().toISOString().slice(0, 10);
  const neverPaidUsers = freeUsers.filter((u) => !u.membership_date || u.membership_date === "");
  const expiredUsers = freeUsers.filter((u) => u.membership_date && u.membership_date !== "" && u.membership_date <= today);
  const summary = {
    total_users: users.length,
    paid_users: paidUsers.length,
    free_users: freeUsers.length,
    never_paid_users: neverPaidUsers.length,
    expired_users: expiredUsers.length,
    devices_total: perDevice.length,
    devices_with_db: perDevice.filter((d) => d.db_found).length,
    devices_missing_db: perDevice.filter((d) => !d.db_found).length,
    // Queue-scan counts (current queue only, may be cleared by admin, partial coverage).
    paid_sent: paidUsers.reduce((s, u) => s + u.sent_count, 0),
    paid_read: paidUsers.reduce((s, u) => s + u.read_count, 0),
    paid_total: paidUsers.reduce((s, u) => s + u.total_queue, 0),
    free_sent: freeUsers.reduce((s, u) => s + u.sent_count, 0),
    free_read: freeUsers.reduce((s, u) => s + u.read_count, 0),
    free_total: freeUsers.reduce((s, u) => s + u.total_queue, 0),
    // Portal running totals (persistent, not affected by queue clearing, full coverage).
    portal_total_sent: users.reduce((s, u) => s + u.portal_total_sent, 0),
    portal_chat_ai_sent: users.reduce((s, u) => s + u.portal_chat_ai_sent, 0),
    portal_trial_sent: users.reduce((s, u) => s + u.portal_trial_sent, 0),
    cap_reached_users: users.filter((u) => u.cap_reached_at !== null).length,
    // Averages based on portal_total_sent (full coverage), not queue scan (partial).
    avg_paid_messages: 0,
    avg_free_messages: 0,
    avg_never_paid_messages: 0,
    avg_expired_messages: 0,
    // Chat AI averages (subset of total_sent).
    avg_paid_chat_ai: 0,
    avg_free_chat_ai: 0,
  };
  const paidCount = summary.paid_users || 1;
  const freeCount = summary.free_users || 1;
  const neverPaidCount = summary.never_paid_users || 1;
  const expiredCount = summary.expired_users || 1;
  const paidPortalSent = paidUsers.reduce((s, u) => s + u.portal_total_sent, 0);
  const freePortalSent = freeUsers.reduce((s, u) => s + u.portal_total_sent, 0);
  const neverPaidSent = neverPaidUsers.reduce((s, u) => s + u.portal_total_sent, 0);
  const expiredSent = expiredUsers.reduce((s, u) => s + u.portal_total_sent, 0);
  const paidChatAi = paidUsers.reduce((s, u) => s + u.portal_chat_ai_sent, 0);
  const freeChatAi = freeUsers.reduce((s, u) => s + u.portal_chat_ai_sent, 0);
  summary.avg_paid_messages = +(paidPortalSent / paidCount).toFixed(2);
  summary.avg_free_messages = +(freePortalSent / freeCount).toFixed(2);
  summary.avg_never_paid_messages = +(neverPaidSent / neverPaidCount).toFixed(2);
  summary.avg_expired_messages = +(expiredSent / expiredCount).toFixed(2);
  summary.avg_paid_chat_ai = +(paidChatAi / paidCount).toFixed(2);
  summary.avg_free_chat_ai = +(freeChatAi / freeCount).toFixed(2);

  return { summary, users: paged, devices: perDevice.length };
}

/**
 * Per-device message breakdown by status.
 *
 * Hit WA server HTTP API untuk device tertentu, return breakdown
 * by status + source + daily counts + recent messages.
 */
export async function deviceMessageStats(
  mainDb: SqlDatabase,
  _waServerDbDir: string, // kept for backward compat, unused (HTTP mode)
  whatsappId: string,
  opts: {
    dateFrom?: string | null;
    dateTo?: string | null;
    recentLimit?: number;
  } = {}
): Promise<Record<string, unknown>> {
  if (!mainDb.hasTable("whatsapps")) {
    return { error: "whatsapps table not found" };
  }

  // Detect schema: trial_sent_count and cap_reached_at may not exist (e.g. dripsender)
  const waCols2 = mainDb.query<{ name: string }>("PRAGMA table_info(whatsapps)");
  const hasTrialSent2 = waCols2.some((c) => c.name === "trial_sent_count");
  const hasCapReached2 = waCols2.some((c) => c.name === "cap_reached_at");

  const wa = mainDb.queryOne<{
    id: string;
    user_id: string;
    phone: string;
    status: string;
    port: number | null;
    connect_url: string | null;
    name: string;
    total_sent_count: number;
    chat_ai_sent_count: number;
    trial_sent_count: number;
    cap_reached_at: number | null;
  }>(
    `SELECT id, user_id, phone, status, port, connect_url, name,
            COALESCE(total_sent_count, 0) AS total_sent_count,
            COALESCE(chat_ai_sent_count, 0) AS chat_ai_sent_count,
            ${hasTrialSent2 ? "COALESCE(trial_sent_count, 0)" : "0"} AS trial_sent_count,
            ${hasCapReached2 ? "cap_reached_at" : "NULL"} AS cap_reached_at
       FROM whatsapps WHERE id = ?`,
    whatsappId
  );
  if (!wa) return { error: "whatsapp device not found" };

  const user = mainDb.queryOne<{ name: string; email: string; membership_date: string | null; plan_id: string | null }>(
    "SELECT name, email, membership_date, plan_id FROM users WHERE id = ?",
    wa.user_id
  );

  if (!wa.connect_url) {
    return {
      whatsapp: stripPii([{ ...wa }], "whatsapps")[0],
      user: user ? stripPii([user], "users")[0] : null,
      port: wa.port,
      connect_url: null,
      db_found: false,
      error: "Device has no connect_url — cannot reach WA server instance.",
      portal_counters: {
        total_sent_count: wa.total_sent_count,
        chat_ai_sent_count: wa.chat_ai_sent_count,
        trial_sent_count: wa.trial_sent_count,
        cap_reached_at: wa.cap_reached_at,
      },
    };
  }

  const stats = await fetchQueueStats(wa.connect_url, {
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
  });

  if (!stats) {
    return {
      whatsapp: stripPii([{ ...wa }], "whatsapps")[0],
      user: user ? stripPii([user], "users")[0] : null,
      port: wa.port,
      connect_url: wa.connect_url,
      db_found: false,
      error: "WA server instance unreachable (offline, sleep, or timeout).",
      portal_counters: {
        total_sent_count: wa.total_sent_count,
        chat_ai_sent_count: wa.chat_ai_sent_count,
        trial_sent_count: wa.trial_sent_count,
        cap_reached_at: wa.cap_reached_at,
      },
    };
  }

  // Limit recent messages to requested count.
  const recentLimit = Math.max(1, Math.min(opts.recentLimit ?? 20, 100));
  const recent = (stats.recent || []).slice(0, recentLimit).map((r) => ({
    ...r,
    send_at: epochMsToIso(r.send_at),
  }));

  return {
    whatsapp: stripPii([{ ...wa }], "whatsapps")[0],
    user: user ? stripPii([user], "users")[0] : null,
    port: wa.port,
    connect_url: wa.connect_url,
    db_found: true,
    by_status: stats.by_status,
    by_source: stats.by_source,
    total: stats.total,
    delivered: stats.delivered,
    chat_ai_count: stats.chat_ai_count,
    daily: stats.daily,
    recent_messages: recent,
    portal_counters: {
      total_sent_count: wa.total_sent_count,
      chat_ai_sent_count: wa.chat_ai_sent_count,
      trial_sent_count: wa.trial_sent_count,
      cap_reached_at: epochMsToIso(wa.cap_reached_at),
    },
  };
}
