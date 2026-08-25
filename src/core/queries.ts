/**
 * Shared query builders for Wajom/Dripsender.
 * Returns plain objects ready for MCP tool output: PII-stripped, epoch-ms
 * timestamps converted to ISO-8601 strings.
 */

import { SqlDatabase } from "./db.ts";
import { stripPii } from "./pii.ts";
import { convertEpochs, parseDateRange, epochMsToIso } from "./time.ts";

type Row = Record<string, unknown>;

interface WhereBuilder {
  clauses: string[];
  params: unknown[];
}

function where(
  b: WhereBuilder,
  db: SqlDatabase,
  table: string,
  col: string,
  op: string,
  value: unknown
): void {
  if (db.hasColumn(table, col) && value !== null && value !== undefined) {
    b.clauses.push(`${col} ${op} ?`);
    b.params.push(value);
  }
}

function paginate(sql: string, limit: number, offset: number): [string, number, number] {
  limit = Math.max(1, Math.min(limit, 200));
  offset = Math.max(0, offset);
  return [`${sql} LIMIT ? OFFSET ?`, limit, offset];
}

// --------------------------------------------------------------------- users

export function listUsers(
  db: SqlDatabase,
  opts: {
    search?: string | null;
    paidOnly?: boolean;
    suspended?: boolean | null;
    planId?: string | null;
    isAdmin?: boolean | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    limit?: number;
    offset?: number;
  } = {}
): Row[] {
  const b: WhereBuilder = { clauses: [], params: [] };
  if (opts.search) {
    b.clauses.push("(name LIKE ? OR email LIKE ? OR phone LIKE ?)");
    const like = `%${opts.search}%`;
    b.params.push(like, like, like);
  }
  if (opts.paidOnly) b.clauses.push("paid_user = 1");
  if (opts.suspended === true) b.clauses.push("is_suspended = 1");
  else if (opts.suspended === false)
    b.clauses.push("(is_suspended = 0 OR is_suspended IS NULL)");
  where(b, db, "users", "plan_id", "=", opts.planId);
  if (opts.isAdmin !== null && opts.isAdmin !== undefined) {
    where(b, db, "users", "is_admin", "=", opts.isAdmin ? 1 : 0);
  }
  const [startMs, endMs] = parseDateRange(opts.dateFrom, opts.dateTo);
  where(b, db, "users", "created_at", ">=", startMs);
  where(b, db, "users", "created_at", "<=", endMs);
  const whereSql = b.clauses.length ? `WHERE ${b.clauses.join(" AND ")}` : "";
  const [sql, lim, off] = paginate(
    `SELECT * FROM users ${whereSql} ORDER BY created_at DESC`,
    opts.limit ?? 50,
    opts.offset ?? 0
  );
  b.params.push(lim, off);
  return convertEpochs(stripPii(db.query<Row>(sql, ...b.params), "users"));
}

export function getUserDetail(
  db: SqlDatabase,
  userId?: string | null,
  email?: string | null
): Row | undefined {
  if (!userId && !email) return undefined;
  const b: WhereBuilder = { clauses: [], params: [] };
  if (userId) {
    b.clauses.push("id = ?");
    b.params.push(userId);
  }
  if (email) {
    b.clauses.push("email = ?");
    b.params.push(email);
  }
  let user = db.queryOne<Row>(
    `SELECT * FROM users WHERE ${b.clauses.join(" AND ")} LIMIT 1`,
    ...b.params
  );
  if (!user) return undefined;
  user = stripPii([user], "users")[0];
  convertEpochs([user]);

  const planId = user.plan_id as string | undefined;
  if (planId && db.hasTable("plans")) {
    const plan = db.queryOne<Row>("SELECT * FROM plans WHERE id = ?", planId);
    if (plan) {
      user.plan = convertEpochs(stripPii([plan], "plans"))[0];
    }
  }
  if (db.hasTable("whatsapps")) {
    const r = db.queryOne<{ c: number }>(
      "SELECT COUNT(*) AS c FROM whatsapps WHERE user_id = ?",
      user.id
    );
    user.whatsapp_count = r?.c ?? 0;
  }
  if (db.hasTable("sales")) {
    const stats = db.queryOne<{ count: number; total_spent: number; last_order_at: number | null }>(
      "SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total_spent, MAX(created_at) AS last_order_at FROM sales WHERE user_id = ? AND status IN ('Purchase','Complete')",
      user.id
    );
    user.purchase_stats = {
      count: stats?.count ?? 0,
      total_spent: stats?.total_spent ?? 0,
      last_order_at: epochMsToIso(stats?.last_order_at ?? null),
    };
  }
  if (user.affiliate_id && db.hasTable("sales")) {
    const aff = db.queryOne<{ referrals: number; commission: number }>(
      "SELECT COUNT(*) AS referrals, COALESCE(SUM(affiliate_fee),0) AS commission FROM sales WHERE affiliate_id = ?",
      user.affiliate_id
    );
    user.affiliate_stats = aff;
  }
  return user;
}

// --------------------------------------------------------------------- sales

export function listOrders(
  db: SqlDatabase,
  opts: {
    status?: string | null;
    orderType?: string | null;
    userId?: string | null;
    affiliateId?: string | null;
    paymentGateway?: string | null;
    couponCode?: string | null;
    product?: string | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    limit?: number;
    offset?: number;
  } = {}
): Row[] {
  const b: WhereBuilder = { clauses: [], params: [] };
  where(b, db, "sales", "status", "=", opts.status);
  where(b, db, "sales", "order_type", "=", opts.orderType);
  where(b, db, "sales", "user_id", "=", opts.userId);
  where(b, db, "sales", "affiliate_id", "=", opts.affiliateId);
  where(b, db, "sales", "payment_gateway", "=", opts.paymentGateway);
  where(b, db, "sales", "coupon_code", "=", opts.couponCode);
  where(b, db, "sales", "product", "=", opts.product);
  const [startMs, endMs] = parseDateRange(opts.dateFrom, opts.dateTo);
  // Match admin portal: filter by updated_at (payment/fulfillment date),
  // not created_at (checkout date). See wajom SaleController.loadMoreSales.
  where(b, db, "sales", "updated_at", ">=", startMs);
  where(b, db, "sales", "updated_at", "<=", endMs);
  const whereSql = b.clauses.length ? `WHERE ${b.clauses.join(" AND ")}` : "";
  const [sql, lim, off] = paginate(
    `SELECT * FROM sales ${whereSql} ORDER BY created_at DESC`,
    opts.limit ?? 50,
    opts.offset ?? 0
  );
  b.params.push(lim, off);
  return convertEpochs(
    stripPii(db.query<Row>(sql, ...b.params), "sales"),
    ["created_at", "updated_at", "expired_time"]
  );
}

export function getOrder(db: SqlDatabase, orderId: string): Row | undefined {
  let order = db.queryOne<Row>("SELECT * FROM sales WHERE id = ?", orderId);
  if (!order) return undefined;
  order = stripPii([order], "sales")[0];
  convertEpochs([order], ["created_at", "updated_at", "expired_time"]);
  if (order.user_id && db.hasTable("users")) {
    const u = getUserDetail(db, (order.user_id as string) ?? null);
    if (u) {
      order.user = { id: u.id, name: u.name, email: u.email, phone: u.phone, plan_id: u.plan_id };
    }
  }
  if (order.plan_id && db.hasTable("plans")) {
    const p = db.queryOne<Row>("SELECT * FROM plans WHERE id = ?", order.plan_id);
    if (p) order.plan = convertEpochs(stripPii([p], "plans"))[0];
  }
  if (order.coupon_id && db.hasTable("coupon_usage")) {
    const cu = db.queryOne<Row>(
      "SELECT * FROM coupon_usage WHERE order_id = ?",
      orderId
    );
    if (cu) order.coupon_usage = convertEpochs(stripPii([cu], "coupon_usage"), ["used_at"])[0];
  }
  return order;
}

export function orderStats(
  db: SqlDatabase,
  opts: { groupBy?: string; dateFrom?: string | null; dateTo?: string | null } = {}
): Record<string, unknown> {
  const b: WhereBuilder = { clauses: [], params: [] };
  const [startMs, endMs] = parseDateRange(opts.dateFrom, opts.dateTo);
  // Match admin portal: filter by updated_at (payment/fulfillment date).
  where(b, db, "sales", "updated_at", ">=", startMs);
  where(b, db, "sales", "updated_at", "<=", endMs);
  const whereSql = b.clauses.length ? `WHERE ${b.clauses.join(" AND ")}` : "";
  const groupBy = opts.groupBy ?? "status";

  const groupCol: Record<string, string> = {
    status: "status",
    product: "product",
    gateway: "payment_gateway",
    order_type: "order_type",
  };
  if (groupBy in groupCol && db.hasColumn("sales", groupCol[groupBy])) {
    const col = groupCol[groupBy];
    const rows = db.query<{ key: string; count: number; revenue: number }>(
      `SELECT ${col} AS key, COUNT(*) AS count, COALESCE(SUM(total),0) AS revenue FROM sales ${whereSql} GROUP BY ${col} ORDER BY count DESC`,
      ...b.params
    );
    return { group_by: groupBy, buckets: rows };
  }
  if (groupBy === "day" || groupBy === "month") {
    const fmt = groupBy === "day" ? "%Y-%m-%d" : "%Y-%m";
    const rows = db.query<{ key: string; count: number; revenue: number }>(
      `SELECT strftime('${fmt}', datetime(updated_at/1000, 'unixepoch')) AS key, COUNT(*) AS count, COALESCE(SUM(total),0) AS revenue FROM sales ${whereSql} GROUP BY key ORDER BY key`,
      ...b.params
    );
    return { group_by: groupBy, buckets: rows };
  }
  const funnel = db.query<{ status: string; count: number; revenue: number }>(
    `SELECT status, COUNT(*) AS count, COALESCE(SUM(total),0) AS revenue FROM sales ${whereSql} GROUP BY status`,
    ...b.params
  );
  const total = db.queryOne<{ count: number; revenue: number }>(
    `SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS revenue FROM sales ${whereSql}`,
    ...b.params
  );
  return { group_by: "status", buckets: funnel, totals: total };
}

export function listAbandonedCheckouts(
  db: SqlDatabase,
  opts: { hours?: number; limit?: number; offset?: number } = {}
): Row[] {
  const cutoffMs = Date.now() - (opts.hours ?? 24) * 3600 * 1000;
  const [sql, lim, off] = paginate(
    "SELECT * FROM sales WHERE status IN ('InitiateCheckout','AddPaymentInfo') AND created_at < ? AND user_id IS NOT NULL AND user_id NOT IN (SELECT user_id FROM sales WHERE status IN ('Purchase','Complete')) ORDER BY created_at DESC",
    opts.limit ?? 50,
    opts.offset ?? 0
  );
  return convertEpochs(
    stripPii(db.query<Row>(sql, cutoffMs, lim, off), "sales"),
    ["created_at", "updated_at", "expired_time"]
  );
}

// --------------------------------------------------------------------- plans

export function listPlans(db: SqlDatabase, activeOnly = true): Row[] {
  const whereSql =
    activeOnly && db.hasColumn("plans", "active_plan") ? "WHERE active_plan = 1" : "";
  return convertEpochs(stripPii(db.query<Row>(`SELECT * FROM plans ${whereSql} ORDER BY price`), "plans"));
}

export function getPlan(db: SqlDatabase, planId: string): Row | undefined {
  let plan = db.queryOne<Row>("SELECT * FROM plans WHERE id = ?", planId);
  if (!plan) return undefined;
  plan = stripPii([plan], "plans")[0];
  convertEpochs([plan]);
  if (db.hasTable("sales")) {
    const sub = db.queryOne<{ subscribers: number; revenue: number }>(
      "SELECT COUNT(*) AS subscribers, COALESCE(SUM(total),0) AS revenue FROM sales WHERE plan_id = ? AND status IN ('Purchase','Complete')",
      planId
    );
    plan.stats = sub;
  }
  return plan;
}

// ------------------------------------------------------------------- coupons

export function listCoupons(
  db: SqlDatabase,
  opts: {
    status?: string | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    limit?: number;
    offset?: number;
  } = {}
): Row[] {
  const b: WhereBuilder = { clauses: [], params: [] };
  where(b, db, "coupons", "status", "=", opts.status);
  const [startMs, endMs] = parseDateRange(opts.dateFrom, opts.dateTo);
  where(b, db, "coupons", "valid_from", ">=", startMs);
  where(b, db, "coupons", "valid_until", "<=", endMs);
  const whereSql = b.clauses.length ? `WHERE ${b.clauses.join(" AND ")}` : "";
  const [sql, lim, off] = paginate(
    `SELECT * FROM coupons ${whereSql} ORDER BY created_at DESC`,
    opts.limit ?? 50,
    opts.offset ?? 0
  );
  b.params.push(lim, off);
  return convertEpochs(
    stripPii(db.query<Row>(sql, ...b.params), "coupons"),
    ["created_at", "updated_at", "valid_from", "valid_until"]
  );
}

export function getCoupon(
  db: SqlDatabase,
  opts: { code?: string | null; couponId?: string | null }
): Row | undefined {
  let c: Row | undefined;
  if (opts.code) c = db.queryOne<Row>("SELECT * FROM coupons WHERE code = ?", opts.code);
  else if (opts.couponId) c = db.queryOne<Row>("SELECT * FROM coupons WHERE id = ?", opts.couponId);
  if (!c) return undefined;
  c = stripPii([c], "coupons")[0];
  convertEpochs([c], ["created_at", "updated_at", "valid_from", "valid_until"]);
  if (db.hasTable("coupon_usage")) {
    const usage = db.query<Row>(
      "SELECT order_id, user_id, discount_amount, used_at FROM coupon_usage WHERE coupon_id = ? ORDER BY used_at DESC LIMIT 50",
      c.id
    );
    c.recent_usage = convertEpochs(usage, ["used_at"]);
    const agg = db.queryOne<{ uses: number; total_discount: number }>(
      "SELECT COUNT(*) AS uses, COALESCE(SUM(discount_amount),0) AS total_discount FROM coupon_usage WHERE coupon_id = ?",
      c.id
    );
    c.usage_summary = agg;
  }
  return c;
}

// ----------------------------------------------------------------- whatsapps

export function listWhatsapps(
  db: SqlDatabase,
  opts: {
    userId?: string | null;
    status?: string | null;
    serverId?: string | null;
    includeDeleted?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Row[] {
  const b: WhereBuilder = { clauses: [], params: [] };
  where(b, db, "whatsapps", "user_id", "=", opts.userId);
  where(b, db, "whatsapps", "status", "=", opts.status);
  where(b, db, "whatsapps", "server_id", "=", opts.serverId);
  if (!opts.includeDeleted && db.hasColumn("whatsapps", "delete_time")) {
    b.clauses.push("(delete_time IS NULL OR delete_time = 0)");
  }
  const whereSql = b.clauses.length ? `WHERE ${b.clauses.join(" AND ")}` : "";
  const [sql, lim, off] = paginate(
    `SELECT * FROM whatsapps ${whereSql} ORDER BY updated_at DESC`,
    opts.limit ?? 50,
    opts.offset ?? 0
  );
  b.params.push(lim, off);
  return convertEpochs(stripPii(db.query<Row>(sql, ...b.params), "whatsapps"));
}

export function getWhatsappDetail(db: SqlDatabase, whatsappId: string): Row | undefined {
  let wa = db.queryOne<Row>("SELECT * FROM whatsapps WHERE id = ?", whatsappId);
  if (!wa) return undefined;
  wa = stripPii([wa], "whatsapps")[0];
  convertEpochs([wa]);
  if (db.hasTable("whatsapp_user_permissions")) {
    wa.permissions = db.query<Row>(
      "SELECT feature_id, granted FROM whatsapp_user_permissions WHERE whatsapp_id = ?",
      whatsappId
    );
  }
  if (db.hasTable("whatsapp_google_connections")) {
    wa.google_connections = convertEpochs(
      db.query<Row>(
        "SELECT google_email, scopes, created_at FROM whatsapp_google_connections WHERE whatsapp_id = ?",
        whatsappId
      )
    );
  }
  if (db.hasTable("chat_ai_integrations")) {
    wa.ai_integrations = db.query<Row>(
      "SELECT type, name, tool_name, enabled FROM chat_ai_integrations WHERE whatsapp_id = ?",
      whatsappId
    );
  }
  return wa;
}

export function whatsappHealth(db: SqlDatabase): Row[] {
  if (!db.hasTable("servers")) return [];
  const servers = stripPii(db.query<Row>("SELECT * FROM servers ORDER BY available DESC"), "servers");
  if (db.hasTable("whatsapps")) {
    for (const s of servers) {
      const dist = db.query<{ status: string; count: number }>(
        "SELECT status, COUNT(*) AS count FROM whatsapps WHERE server_id = ? GROUP BY status",
        s.id
      );
      s.device_status = Object.fromEntries(dist.map((d) => [d.status, d.count]));
    }
  }
  return servers;
}

// ----------------------------------------------------------------- affiliate

export function listAffiliates(
  db: SqlDatabase,
  opts: { limit?: number; offset?: number } = {}
): Row[] {
  const [sql, lim, off] = paginate(
    "SELECT * FROM users WHERE affiliate_id IS NOT NULL AND affiliate_id != '' ORDER BY created_at DESC",
    opts.limit ?? 50,
    opts.offset ?? 0
  );
  const users = convertEpochs(stripPii(db.query<Row>(sql, lim, off), "users"));
  if (db.hasTable("sales")) {
    for (const u of users) {
      const agg = db.queryOne<{ referrals: number; commission: number }>(
        "SELECT COUNT(*) AS referrals, COALESCE(SUM(affiliate_fee),0) AS commission FROM sales WHERE affiliate_id = ?",
        u.affiliate_id
      );
      u.affiliate_stats = agg;
    }
  }
  return users;
}

export function getAffiliateDetail(db: SqlDatabase, affiliateId: string): Row | undefined {
  let user = db.queryOne<Row>("SELECT * FROM users WHERE affiliate_id = ?", affiliateId);
  if (!user) return undefined;
  user = stripPii([user], "users")[0];
  convertEpochs([user]);
  if (db.hasTable("sales")) {
    user.referral_sales = convertEpochs(
      db.query<Row>(
        "SELECT id, user_name, user_email, status, total, affiliate_fee, created_at FROM sales WHERE affiliate_id = ? ORDER BY created_at DESC LIMIT 100",
        affiliateId
      )
    );
  }
  if (db.hasTable("withdraw")) {
    user.withdrawals = convertEpochs(
      stripPii(
        db.query<Row>("SELECT * FROM withdraw WHERE user_id = ? ORDER BY created_at DESC", user.id),
        "withdraw"
      )
    );
  }
  if (db.hasTable("merchant_payouts")) {
    user.payouts = convertEpochs(
      stripPii(
        db.query<Row>("SELECT * FROM merchant_payouts WHERE user_id = ? ORDER BY created_at DESC", user.id),
        "merchant_payouts"
      ),
      ["created_at", "updated_at", "processed_at"]
    );
  }
  return user;
}

// ----------------------------------------------------------------- feedbacks

export function listFeedbacks(
  db: SqlDatabase,
  opts: {
    type?: string | null;
    minRating?: number | null;
    maxRating?: number | null;
    limit?: number;
    offset?: number;
  } = {}
): Row[] {
  const b: WhereBuilder = { clauses: [], params: [] };
  where(b, db, "feedbacks", "type", "=", opts.type);
  where(b, db, "feedbacks", "rating", ">=", opts.minRating);
  where(b, db, "feedbacks", "rating", "<=", opts.maxRating);
  const whereSql = b.clauses.length ? `WHERE ${b.clauses.join(" AND ")}` : "";
  const [sql, lim, off] = paginate(
    `SELECT * FROM feedbacks ${whereSql} ORDER BY created_at DESC`,
    opts.limit ?? 50,
    opts.offset ?? 0
  );
  b.params.push(lim, off);
  return stripPii(db.query<Row>(sql, ...b.params), "feedbacks");
}

// ------------------------------------------------------------------ activity

export function userActivity(
  db: SqlDatabase,
  userId: string,
  events = true
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (db.hasTable("activity_tracking")) {
    out.tracking = convertEpochs(
      db.query<Row>(
        "SELECT activity_type, counter, created_at, updated_at FROM activity_tracking WHERE user_id = ?",
        userId
      ),
      ["created_at", "updated_at"]
    );
  }
  if (events && db.hasTable("activity_tracking_events")) {
    out.events = convertEpochs(
      db.query<Row>(
        "SELECT activity_type, created_at FROM activity_tracking_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 200",
        userId
      )
    );
  }
  return out;
}
